import { google } from "googleapis";
import { Readable } from "stream";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// Google Drive AKUN KEDUA khusus modul Retur Material (terpisah dari backup).
// Config disimpan di tabel retur_gdrive_config (1 baris).

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_RETUR_REDIRECT_URI || "http://localhost:3001/api/retur/google/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

const FOLDER_NAME = "Retur Gudang Pemaron";

function getReturClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google Drive Retur integration requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
    );
  }
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
  return oauth2Client;
}

interface ReturGdriveRow {
  id: number;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: Date | null;
  account_email: string | null;
  folder_id: string | null;
}

async function getReturConfigRow(): Promise<ReturGdriveRow | null> {
  const result = await pool.query("SELECT * FROM retur_gdrive_config LIMIT 1");
  return result.rows[0] ?? null;
}

// Client Drive utk akun retur. Access token Google berumur ~1 jam dan googleapis
// TIDAK me-refresh otomatis utk client Drive biasa (header disisipkan apa adanya),
// jadi tiap ~1 jam setelah connect semua upload/gagal 401 "Invalid Credentials"
// (gejala di frontend: simpan retur -> 502). Dengan expiry_date di credentials,
// getAccessToken() me-refresh otomatis saat token lewat; token baru disimpan ke DB.
async function driveAuthed(config: ReturGdriveRow) {
  const client = getReturClient();
  client.setCredentials({
    access_token: config.access_token ?? undefined,
    refresh_token: config.refresh_token ?? undefined,
    expiry_date: config.token_expiry ? new Date(config.token_expiry).getTime() : undefined,
  });
  const { token } = await client.getAccessToken();
  const access = token ?? config.access_token;
  if (access && access !== config.access_token) {
    const expiryMs = client.credentials.expiry_date;
    await pool.query(
      "UPDATE retur_gdrive_config SET access_token = $1, refresh_token = $2, token_expiry = $3, updated_at = now() WHERE id = $4",
      [
        access,
        client.credentials.refresh_token ?? config.refresh_token,
        expiryMs ? new Date(expiryMs) : null,
        config.id,
      ]
    );
    logger.info({ account: config.account_email }, "Retur Drive: access token di-refresh");
  }
  return google.drive({ version: "v3", auth: client });
}

export function getReturAuthUrl(): string {
  const client = getReturClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeReturCodeAndSave(code: string): Promise<{ email: string }> {
  const client = getReturClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get account email from OAuth2 info
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email ?? "";

  // Save tokens to retur_gdrive_config
  await pool.query(
    `UPDATE retur_gdrive_config SET
      access_token = $1,
      refresh_token = $2,
      token_expiry = $3,
      account_email = $4,
      updated_at = NOW()
    WHERE id = (SELECT id FROM retur_gdrive_config LIMIT 1)`,
    [
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email,
    ]
  );

  logger.info({ email }, "Google Drive Retur: account connected");
  return { email };
}

export async function disconnectReturDrive(): Promise<void> {
  await pool.query(
    `UPDATE retur_gdrive_config SET
      access_token = NULL,
      refresh_token = NULL,
      token_expiry = NULL,
      account_email = NULL,
      folder_id = NULL,
      updated_at = NOW()
    WHERE id = (SELECT id FROM retur_gdrive_config LIMIT 1)`
  );
  logger.info("Google Drive Retur: account disconnected");
}

export async function getReturDriveStatus(): Promise<{
  connected: boolean;
  email: string | null;
}> {
  try {
    const result = await pool.query(
      "SELECT account_email, access_token FROM retur_gdrive_config LIMIT 1"
    );
    const row = result.rows[0];
    if (!row) return { connected: false, email: null };
    return {
      connected: !!row.access_token,
      email: row.account_email ?? null,
    };
  } catch {
    return { connected: false, email: null };
  }
}

// Cari atau buat folder Drive "Retur Gudang Pemaron"; id disimpan di config.
export async function ensureReturFolder(): Promise<string> {
  const config = await getReturConfigRow();
  if (!config?.access_token) {
    throw new Error("Akun Google Drive Retur belum terhubung");
  }
  if (config.folder_id) return config.folder_id;

  const drive = await driveAuthed(config);

  const folderRes = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
    fields: "files(id, name)",
  });
  const found = folderRes.data.files ?? [];
  let folderId: string | null | undefined = found[0]?.id;
  if (!folderId) {
    const folder = await drive.files.create({
      requestBody: {
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    folderId = folder.data.id;
  }
  if (!folderId) throw new Error("Gagal menyiapkan folder Drive Retur");

  // Save folder ID for future use
  await pool.query(
    `UPDATE retur_gdrive_config SET folder_id = $1, updated_at = NOW() WHERE id = (SELECT id FROM retur_gdrive_config LIMIT 1)`,
    [folderId]
  );
  return folderId;
}

// Upload gambar (dataURL) ke folder Retur → { fileId, webViewLink }
export async function uploadReturDataUrl(
  dataUrl: string,
  name: string
): Promise<{ fileId: string; webViewLink: string }> {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Format data URL tidak valid");
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");

  const config = await getReturConfigRow();
  if (!config?.access_token) {
    throw new Error("Akun Google Drive Retur belum terhubung");
  }
  const drive = await driveAuthed(config);
  const folderId = await ensureReturFolder();

  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, webViewLink",
  });

  logger.info({ fileId: response.data.id, name }, "Google Drive Retur: foto uploaded");

  const fileId = response.data.id;
  if (!fileId) throw new Error("Upload foto Retur ke Drive gagal");
  return {
    fileId,
    webViewLink: response.data.webViewLink || "",
  };
}

// Unduh bytes file dari folder Retur (untuk stream ke frontend)
export async function downloadReturFile(
  fileId: string
): Promise<{ contentType: string; buffer: Buffer }> {
  const config = await getReturConfigRow();
  if (!config?.access_token) {
    throw new Error("Akun Google Drive Retur belum terhubung");
  }
  const drive = await driveAuthed(config);

  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  const chunks: Buffer[] = [];
  // googleapis types stream response bodies loosely; alt=media yields byte chunks
  const stream = response.data as unknown as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return {
    contentType: response.headers["content-type"] || "application/octet-stream",
    buffer: Buffer.concat(chunks),
  };
}

// Hapus satu file dari folder Retur. 404 dianggap sudah terhapus (pangilan best-effort
// dari penghapusan dokumen: foto bisa saja sudah dipindah/dihapus manual di Drive).
export async function deleteReturFile(fileId: string): Promise<void> {
  const config = await getReturConfigRow();
  if (!config?.access_token) {
    throw new Error("Akun Google Drive Retur belum terhubung");
  }
  const drive = await driveAuthed(config);
  try {
    await drive.files.delete({ fileId });
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err && typeof err.code === "number"
        ? err.code
        : undefined;
    if (code === 404) return;
    throw err;
  }
}
