import { google } from "googleapis";
import { pool } from "@workspace/db";
import { getOAuthClient } from "./google-drive";
import { logger } from "./logger";

/**
 * Reads material names (column C) and stock values (column J) from the
 * connected Google Spreadsheet, starting at row 9.
 *
 * @param spreadsheetId  The Google Spreadsheet ID
 * @param sheetName      Optional sheet/tab name (e.g. "Sheet1", "Data"). If omitted, reads the first/default sheet.
 *
 * Returns a Map where key = material name (trimmed, lowercase) from col C,
 * value = numeric stock value from col J.
 */
export async function getSheetStockMap(
  spreadsheetId: string,
  sheetName?: string | null
): Promise<Map<string, number>> {
  const config = await getGdriveConfig();
  if (!config?.gdrive_access_token || !config?.gdrive_refresh_token) {
    throw new Error(
      "Google account not connected. Hubungkan akun Google di Master → Backup terlebih dahulu."
    );
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: config.gdrive_access_token,
    refresh_token: config.gdrive_refresh_token,
    expiry_date: config.gdrive_token_expiry
      ? new Date(config.gdrive_token_expiry).getTime()
      : undefined,
  });

  // Auto-refresh token if needed
  const now = Date.now();
  const expiry = config.gdrive_token_expiry
    ? new Date(config.gdrive_token_expiry).getTime()
    : 0;
  if (!expiry || now >= expiry - 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    await pool.query(
      `UPDATE backup_config SET gdrive_access_token = $1, gdrive_token_expiry = $2
       WHERE id = (SELECT id FROM backup_config LIMIT 1)`,
      [credentials.access_token, credentials.expiry_date ? new Date(credentials.expiry_date) : null]
    );
  }

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  // Build range — qualify with sheet/tab name if provided
  // e.g. "Sheet1!C9:J" or just "C9:J" for the default sheet
  const baseRange = "C9:J";
  const range = sheetName?.trim() ? `'${sheetName.trim()}'!${baseRange}` : baseRange;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values ?? [];
  const stockMap = new Map<string, number>();

  for (const row of rows) {
    // row[0] = col C (material name), row[7] = col J (stock value)
    // Column indices within C9:J: C=0, D=1, E=2, F=3, G=4, H=5, I=6, J=7
    const materialName = row[0];
    const stockVal = row[7];

    if (!materialName || materialName.toString().trim() === "") continue;

    const key = materialName.toString().trim().toLowerCase();
    const numericVal = parseFloat(String(stockVal ?? "").replace(/[^0-9.-]/g, ""));
    stockMap.set(key, isNaN(numericVal) ? 0 : numericVal);
  }

  logger.info({ spreadsheetId, sheetName: sheetName ?? "(default)", rowCount: stockMap.size }, "Google Sheets: stock map fetched");
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
