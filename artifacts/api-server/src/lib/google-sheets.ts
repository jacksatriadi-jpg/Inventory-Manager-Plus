// Google Sheets integration is disabled.

export async function getSheetStockMap(
  _spreadsheetId: string,
  _sheetName?: string | null
): Promise<Map<string, number>> {
  throw new Error("Google Sheets integration is disabled.");
}
