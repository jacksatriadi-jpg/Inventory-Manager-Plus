import { google } from "googleapis";
import { logger } from "./logger";
import { getFreshOAuthClient } from "./google-drive";

export async function getSheetStockMap(
  spreadsheetId: string,
  sheetName: string | null = null
): Promise<{ stockMap: Map<string, number>; fetchTimestamp: string | null }> {
  const client = await getFreshOAuthClient();

  const sheets = google.sheets({ version: "v4", auth: client });

  // Read columns C (material name) and K (stock value) from row 9 onward
  const dataRange = sheetName ? `${sheetName}!C9:K1000` : "C9:K1000";
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: dataRange,
  });

  // Read timestamp from cell K7
  const tsRange = sheetName ? `${sheetName}!K7:K7` : "K7:K7";
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
    // Column C = index 0 (material name), Column K = index 8 (stock value)
    // Range C:K → C=0, D=1, E=2, F=3, G=4, H=5, I=6, J=7, K=8
    const materialName = row[0]?.trim();
    const stockValue = row[8];

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
