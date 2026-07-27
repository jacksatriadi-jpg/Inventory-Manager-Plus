import { google } from "googleapis";
import fs from "fs";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/auto-backup/google/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

function getClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google Drive integration requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
    );
  }
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
  return oauth2Client;
}

export function getOAuthClient(): google.auth.OAuth2 {
  return getClient();
}

export function getAuthUrl(): string {
  const client = getClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeAndSave(code: string): Promise<{ email: string }> {
  const client = getClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get account email from OAuth2 info
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;

  // Save tokens to backup_config
  await pool.query(
    `UPDATE backup_config SET
      gdrive_access_token = $1,
      gdrive_refresh_token = $2,
      gdrive_token_expiry = $3,
      gdrive_account_email = $4
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

export async function uploadBackupToDrive(
  filepath: string,
  filename: string,
  config: any
): Promise<{ fileId: string; webViewLink: string }> {
  const client = getClient();
  client.setCredentials({
    access_token: config.gdrive_access_token,
    refresh_token: config.gdrive_refresh_token,
  });

  const drive = google.drive({ version: "v3", auth: client });

  // Find or create the Inventory Manager backup folder
  let folderId = config.gdrive_folder_id;
  if (!folderId) {
    const folderRes = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and name='Inventory Backups' and trashed=false",
      fields: "files(id, name)",
    });
    if (folderRes.data.files.length > 0) {
      folderId = folderRes.data.files[0].id;
    } else {
      const folder = await drive.files.create({
        requestBody: {
          name: "Inventory Backups",
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      folderId = folder.data.id;
    }
    // Save folder ID for future use
    await pool.query(
      `UPDATE backup_config SET gdrive_folder_id = $1 WHERE id = (SELECT id FROM backup_config LIMIT 1)`,
      [folderId]
    );
  }

  // Upload the backup file
  const fileMetadata = {
    name: filename,
    parents: [folderId],
  };

  const response = await drive.files.create({
    media: {
      mimeType: "application/json",
      body: fs.createReadStream(filepath),
    },
    requestBody: fileMetadata,
    fields: "id, webViewLink, webContentLink",
  });

  logger.info(
    { fileId: response.data.id, filename },
    "Google Drive: backup uploaded"
  );

  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink || "",
  };
}

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
