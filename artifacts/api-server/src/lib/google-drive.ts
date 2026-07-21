import { pool } from "@workspace/db";
import { logger } from "./logger";

// Google Drive integration is disabled.

export function getOAuthClient(): never {
  throw new Error("Google Drive integration is disabled.");
}

export function getAuthUrl(): string {
  throw new Error("Google Drive integration is disabled.");
}

export async function exchangeCodeAndSave(_code: string): Promise<{ email: string }> {
  throw new Error("Google Drive integration is disabled.");
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
  _filepath: string,
  _filename: string,
  _config: any
): Promise<{ fileId: string; webViewLink: string }> {
  throw new Error("Google Drive integration is disabled.");
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
