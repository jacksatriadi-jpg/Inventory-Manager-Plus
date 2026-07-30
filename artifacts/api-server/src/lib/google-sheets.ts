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
): Promise<{ stockMap: Map<string, number>; fetchTimestamp: string | null }> {
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
  const dataRange = sheetName ? `${sheetName}!C9:J1000` : "C9:J1000";
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: dataRange,
  });

  // Read timestamp from cell J7
  const tsRange = sheetName ? `${sheetName}!J7:J7` : "J7:J7";
  const tsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tsRange,
  });
  const tsRows = tsResponse.data.values;
  const fetchTimestamp = tsRows?.[0]?.[0] ?? null;

  const rows = dataResponse.data.values;
  if (!rows || rows.length === 0) {
    return { stockMap: new Map<string, number>(), fetchTimestamp };
  }

  const stockMap = new Map<string, number>();

  for (const row of rows) {
    // Column C = index 0 (material name), Column J = index 6 (stock value)
    const materialName = row[0]?.trim();
    const stockValue = row[6];

    if (materialName && stockValue !== undefined && stockValue !== null && stockValue !== "") {
      // Handle Indonesian number format: "1.500" → 1500
      // Google Sheets may return string with dot as thousand separator
      let stock: number;
      const raw = String(stockValue);
      if (raw.includes(".") && !raw.includes(",")) {
        // Likely thousand separator (e.g. "1.500"), strip dots
        stock = parseFloat(raw.replace(/\./g, ""));
      } else {
        stock = parseFloat(raw);
      }
      if (!isNaN(stock)) {
        stockMap.set(materialName, stock);
      }
    }
  }

  logger.info(
    { spreadsheetId, sheetName, rowCount: stockMap.size, fetchTimestamp },
    "Google Sheets: stock fetched successfully"
  );

  return { stockMap, fetchTimestamp };
}
