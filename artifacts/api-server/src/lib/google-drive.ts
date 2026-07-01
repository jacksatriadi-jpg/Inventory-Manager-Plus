import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// ─── OAuth2 Client ─────────────────────────────────────────────────────────

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auto-backup/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required for Google Drive integration."
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    ],
  });
}

// ─── Token Exchange & Storage ──────────────────────────────────────────────

export async function exchangeCodeAndSave(code: string): Promise<{ email: string }> {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to obtain tokens from Google. Make sure prompt=consent is set.");
  }

  // Get the connected user's email
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email ?? "unknown@gmail.com";

  // Save to database
  await pool.query(
    `UPDATE backup_config SET
      gdrive_access_token = $1,
      gdrive_refresh_token = $2,
      gdrive_token_expiry = $3,
      gdrive_account_email = $4,
      gdrive_folder_id = NULL,
      gdrive_enabled = true
    WHERE id = (SELECT id FROM backup_config LIMIT 1)`,
    [
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email,
    ]
  );

  logger.info({ email }, "Google Drive: account connected");
  return { email };
}

export async function disconnectGoogleDrive(): Promise<void> {
  await pool.query(
    `UPDATE backup_config SET
      gdrive_enabled = false,
      gdrive_access_token = NULL,
      gdrive_refresh_token = NULL,
      gdrive_token_expiry = NULL,
      gdrive_account_email = NULL,
      gdrive_folder_id = NULL
    WHERE id = (SELECT id FROM backup_config LIMIT 1)`
  );
  logger.info("Google Drive: account disconnected");
}

// ─── Auth Client with Refresh ──────────────────────────────────────────────

async function getAuthorizedClient(config: any) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: config.gdrive_access_token,
    refresh_token: config.gdrive_refresh_token,
    expiry_date: config.gdrive_token_expiry ? new Date(config.gdrive_token_expiry).getTime() : undefined,
  });

  // Auto-refresh if expired or about to expire (within 5 min)
  const now = Date.now();
  const expiry = config.gdrive_token_expiry ? new Date(config.gdrive_token_expiry).getTime() : 0;
  if (!expiry || now >= expiry - 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    // Save refreshed token back to DB
    await pool.query(
      `UPDATE backup_config SET
        gdrive_access_token = $1,
        gdrive_token_expiry = $2
      WHERE id = (SELECT id FROM backup_config LIMIT 1)`,
      [
        credentials.access_token,
        credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      ]
    );
    logger.info("Google Drive: access token refreshed");
  }

  return oauth2Client;
}

// ─── Folder Management ─────────────────────────────────────────────────────

const BACKUP_FOLDER_NAME = "Inventory Backups";

async function ensureDriveFolder(auth: any, storedFolderId: string | null): Promise<string> {
  const drive = google.drive({ version: "v3", auth });

  // Check if stored folder still exists
  if (storedFolderId) {
    try {
      await drive.files.get({ fileId: storedFolderId, fields: "id,trashed" });
      return storedFolderId;
    } catch {
      // Folder not found or deleted, create a new one
    }
  }

  // Search for existing folder by name
  const search = await drive.files.list({
    q: `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (search.data.files && search.data.files.length > 0) {
    const folderId = search.data.files[0].id!;
    await saveFolderId(folderId);
    return folderId;
  }

  // Create the folder
  const folder = await drive.files.create({
    requestBody: {
      name: BACKUP_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  const folderId = folder.data.id!;
  await saveFolderId(folderId);
  logger.info({ folderId }, `Google Drive: created folder "${BACKUP_FOLDER_NAME}"`);
  return folderId;
}

async function saveFolderId(folderId: string) {
  await pool.query(
    "UPDATE backup_config SET gdrive_folder_id = $1 WHERE id = (SELECT id FROM backup_config LIMIT 1)",
    [folderId]
  );
}

// ─── Upload ────────────────────────────────────────────────────────────────

export async function uploadBackupToDrive(
  filepath: string,
  filename: string,
  config: any
): Promise<{ fileId: string; webViewLink: string }> {
  const auth = await getAuthorizedClient(config);
  const drive = google.drive({ version: "v3", auth });

  const folderId = await ensureDriveFolder(auth, config.gdrive_folder_id);

  const fileStream = fs.createReadStream(filepath);
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: "application/json",
      parents: [folderId],
    },
    media: {
      mimeType: "application/json",
      body: fileStream,
    },
    fields: "id,webViewLink",
  });

  logger.info({ filename, fileId: res.data.id }, "Google Drive: backup uploaded");
  return { fileId: res.data.id!, webViewLink: res.data.webViewLink ?? "" };
}

// ─── Status Query ──────────────────────────────────────────────────────────

export async function getGoogleDriveStatus(): Promise<{
  connected: boolean;
  enabled: boolean;
  email: string | null;
}> {
  try {
    const result = await pool.query(
      "SELECT gdrive_enabled, gdrive_account_email, gdrive_access_token FROM backup_config LIMIT 1"
    );
    const row = result.rows[0];
    if (!row) return { connected: false, enabled: false, email: null };

    return {
      connected: !!row.gdrive_access_token,
      enabled: row.gdrive_enabled ?? false,
      email: row.gdrive_account_email ?? null,
    };
  } catch {
    return { connected: false, enabled: false, email: null };
  }
}
