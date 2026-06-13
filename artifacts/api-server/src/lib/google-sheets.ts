import { google } from "googleapis";
import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Reads material names (column C) and stock values (column J) from the
 * connected Google Spreadsheet, starting at row 9.
 *
 * Does NOT use getOAuthClient() from google-drive.ts (which requires env vars).
 * Instead, builds the OAuth2 client directly from stored tokens so the
 * Sheets fetch works even if GOOGLE_CLIENT_ID/SECRET env vars are not loaded yet.
 *
 * @param spreadsheetId  The Google Spreadsheet ID
 * @param sheetName      Optional sheet/tab name (e.g. "Sheet1", "Data")
 */
export async function getSheetStockMap(
  spreadsheetId: string,
  sheetName?: string | null
): Promise<Map<string, number>> {
  // ── 1. Load stored OAuth tokens from DB ──────────────────────────────────
  const config = await getGdriveConfig();

  if (!config) {
    throw new Error("Tidak ada konfigurasi backup ditemukan di database.");
  }
  if (!config.gdrive_access_token || !config.gdrive_refresh_token) {
    throw new Error(
      "Google account belum terkoneksi. Hubungkan akun Google di Master → Backup → Google Drive terlebih dahulu, lalu coba lagi."
    );
  }

  // ── 2. Build OAuth2 client from env vars ─────────────────────────────────
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "https://app.gudangpemaron.my.id/api/auto-backup/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET belum diset di environment variables. " +
      "Tambahkan ke .env atau ~/.bashrc dan restart server."
    );
  }

  const { google: googleAuth } = await import("googleapis");
  const oauth2Client = new googleAuth.auth.OAuth2(clientId, clientSecret, redirectUri);

  oauth2Client.setCredentials({
    access_token: config.gdrive_access_token,
    refresh_token: config.gdrive_refresh_token,
    expiry_date: config.gdrive_token_expiry
      ? new Date(config.gdrive_token_expiry).getTime()
      : undefined,
  });

  // ── 3. Auto-refresh token if expired or about to expire (within 5 min) ──
  const expiry = config.gdrive_token_expiry
    ? new Date(config.gdrive_token_expiry).getTime()
    : null;
  const isExpired = expiry !== null && Date.now() >= expiry - 5 * 60 * 1000;

  if (isExpired) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      await pool.query(
        `UPDATE backup_config
         SET gdrive_access_token = $1, gdrive_token_expiry = $2
         WHERE id = (SELECT id FROM backup_config LIMIT 1)`,
        [
          credentials.access_token,
          credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        ]
      );
      logger.info("Google Sheets: access token refreshed");
    } catch (refreshErr: any) {
      throw new Error(
        `Token Google kadaluarsa dan gagal diperbarui: ${refreshErr.message}. ` +
        "Coba putus dan sambungkan ulang akun Google di Master → Backup."
      );
    }
  }

  // ── 4. Call Sheets API ────────────────────────────────────────────────────
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  // Build range — qualify with sheet/tab name if provided
  // e.g. "'Sheet1'!C9:J" or just "C9:J" for the default sheet
  const baseRange = "C9:J";
  const range = sheetName?.trim()
    ? `'${sheetName.trim()}'!${baseRange}`
    : baseRange;

  let response: any;
  try {
    response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
  } catch (apiErr: any) {
    const status = apiErr?.response?.status;
    if (status === 403) {
      throw new Error(
        `Akses ditolak (403) ke spreadsheet. Pastikan spreadsheet sudah di-share ke akun Google yang terkoneksi, atau aktifkan "Anyone with the link can view".`
      );
    }
    if (status === 404) {
      throw new Error(
        `Spreadsheet tidak ditemukan (404). Periksa apakah Spreadsheet ID sudah benar: "${spreadsheetId}"`
      );
    }
    throw new Error(`Google Sheets API error: ${apiErr.message}`);
  }

  // ── 5. Parse rows ─────────────────────────────────────────────────────────
  const rows = response.data.values ?? [];
  const stockMap = new Map<string, number>();

  for (const row of rows) {
    // row[0] = col C (material name), row[7] = col J (stock value)
    const materialName = row[0];
    const stockVal = row[7];

    if (!materialName || materialName.toString().trim() === "") continue;

    const key = materialName.toString().trim().toLowerCase();
    
    // UNFORMATTED_VALUE returns actual numbers (or strings if text)
    const numericVal = Number(stockVal);
    stockMap.set(key, isNaN(numericVal) ? 0 : numericVal);
  }

  logger.info(
    { spreadsheetId, sheetName: sheetName ?? "(default)", rowCount: stockMap.size },
    "Google Sheets: stock map fetched"
  );
  return stockMap;
}

async function getGdriveConfig() {
  try {
    const result = await pool.query("SELECT * FROM backup_config LIMIT 1");
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}
