import { google } from "googleapis";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function getSheetsClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google Sheets integration requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/auto-backup/google/callback"
  );

  return oauth2Client;
}

export async function getSheetStockMap(
  spreadsheetId: string,
  sheetName: string | null = null
): Promise<Map<string, number>> {
  const configResult = await pool.query(
    "SELECT gdrive_access_token, gdrive_refresh_token FROM backup_config LIMIT 1"
  );
  const config = configResult.rows[0];

  if (!config?.gdrive_access_token || !config?.gdrive_refresh_token) {
    throw new Error("Google account belum terhubung. Hubungkan akun Google di tab Backup terlebih dahulu.");
  }

  const client = getSheetsClient();
  client.setCredentials({
    access_token: config.gdrive_access_token,
    refresh_token: config.gdrive_refresh_token,
  });

  const sheets = google.sheets({ version: "v4", auth: client });

  // Read columns C (material name) and J (stock value) from row 9 onward
  // Range: C9:J1000 to cover enough rows
  const range = sheetName ? `${sheetName}!C9:J1000` : "C9:J1000";
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    return new Map();
  }

  const stockMap = new Map<string, number>();

  for (const row of rows) {
    // Column C = index 0 (material name), Column J = index 6 (stock value)
    const materialName = row[0]?.trim();
    const stockValue = row[6];

    if (materialName && stockValue !== undefined && stockValue !== null && stockValue !== "") {
      const stock = parseFloat(String(stockValue));
      if (!isNaN(stock)) {
        stockMap.set(materialName, stock);
      }
    }
  }

  logger.info(
    { spreadsheetId, sheetName, rowCount: stockMap.size },
    "Google Sheets: stock fetched successfully"
  );

  return stockMap;
}
