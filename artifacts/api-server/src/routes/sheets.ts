import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { parseToken } from "../lib/auth";
import { getSheetStockMap } from "../lib/google-sheets";

const router: IRouter = Router();

function requireMaster(req: any, res: any): boolean {
  const auth = req.headers.authorization as string | undefined;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const parsed = parseToken(auth.slice(7));
  if (!parsed) {
    res.status(401).json({ error: "Invalid token" });
    return false;
  }
  return true;
}

// ─── Spreadsheet Config ───────────────────────────────────────────────────────

/**
 * GET /api/sheets/config
 * Returns the stored spreadsheet ID.
 */
router.get("/sheets/config", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const result = await pool.query("SELECT spreadsheet_id, sheet_name, updated_at FROM spreadsheet_config LIMIT 1");
    res.json(result.rows[0] ?? { spreadsheet_id: null, sheet_name: null, updated_at: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sheets/config
 * Saves (or updates) the spreadsheet ID.
 * Body: { spreadsheet_id: string }
 */
router.post("/sheets/config", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const { spreadsheet_id, sheet_name } = req.body;
    if (!spreadsheet_id || typeof spreadsheet_id !== "string") {
      res.status(400).json({ error: "spreadsheet_id is required" });
      return;
    }

    const trimmed = spreadsheet_id.trim();

    // Accept both full URLs and bare IDs
    const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const id = urlMatch ? urlMatch[1] : trimmed;

    const sName = typeof sheet_name === "string" && sheet_name.trim() ? sheet_name.trim() : null;

    await pool.query(
      "UPDATE spreadsheet_config SET spreadsheet_id = $1, sheet_name = $2, updated_at = NOW()",
      [id, sName]
    );
    res.json({ success: true, spreadsheet_id: id, sheet_name: sName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fetch Stock from Sheet ───────────────────────────────────────────────────

/**
 * GET /api/sheets/stock
 * Reads column C (material name) and column J (stock value) from row 9 onward
 * in the configured spreadsheet.
 *
 * Returns: { stock: Array<{ materialName: string, stockExcel: number }> }
 */
router.get("/sheets/stock", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const configResult = await pool.query("SELECT spreadsheet_id, sheet_name FROM spreadsheet_config LIMIT 1");
    const spreadsheetId = configResult.rows[0]?.spreadsheet_id;
    const sheetName = configResult.rows[0]?.sheet_name ?? null;

    if (!spreadsheetId) {
      res.status(400).json({ error: "Spreadsheet belum dikonfigurasi. Pergi ke Master → Spreadsheet dan masukkan ID." });
      return;
    }

    const stockMap = await getSheetStockMap(spreadsheetId, sheetName);

    const stock = Array.from(stockMap.entries()).map(([materialName, stockExcel]) => ({
      materialName,
      stockExcel,
    }));

    res.json({ stock, spreadsheetId, sheetName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
