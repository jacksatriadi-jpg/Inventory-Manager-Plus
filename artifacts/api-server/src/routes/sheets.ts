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

    const { stockMap, fetchTimestamp } = await getSheetStockMap(spreadsheetId, sheetName);

    const stock = Array.from(stockMap.entries()).map(([materialName, stockExcel]) => ({
      materialName,
      stockExcel,
    }));

    res.json({ stock, spreadsheetId, sheetName, fetchTimestamp });
  } catch (err: any) {
    // Return the full error message so the frontend can show it
    res.status(500).json({ error: err.message ?? "Terjadi kesalahan saat membaca spreadsheet." });
  }
});

// ─── Diagnose ─────────────────────────────────────────────────────────────────

/**
 * GET /api/sheets/diagnose
 * Returns a diagnostic checklist — useful to figure out why Sheets fetch fails.
 */
router.get("/sheets/diagnose", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const checks: Record<string, { ok: boolean; detail: string }> = {};

    // 1. googleapis installed?
    try {
      require("googleapis");
      checks.googleapis = { ok: true, detail: "googleapis package terinstall" };
    } catch {
      checks.googleapis = { ok: false, detail: "googleapis belum terinstall. Jalankan: pnpm add googleapis --filter @workspace/api-server" };
    }

    // 2. Env vars set?
    const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
    const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
    checks.env_vars = {
      ok: hasClientId && hasClientSecret,
      detail: hasClientId && hasClientSecret
        ? "GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET sudah diset"
        : `Missing: ${!hasClientId ? "GOOGLE_CLIENT_ID " : ""}${!hasClientSecret ? "GOOGLE_CLIENT_SECRET" : ""}`,
    };

    // 3. Google account connected?
    const bcResult = await pool.query("SELECT gdrive_access_token, gdrive_refresh_token, gdrive_account_email FROM backup_config LIMIT 1");
    const bc = bcResult.rows[0];
    const hasTokens = !!(bc?.gdrive_access_token && bc?.gdrive_refresh_token);
    checks.google_account = {
      ok: hasTokens,
      detail: hasTokens
        ? `Terhubung: ${bc?.gdrive_account_email ?? "unknown"}`
        : "Google account belum terkoneksi. Buka Master → Backup → Hubungkan Akun Google",
    };

    // 4. Spreadsheet configured?
    const scResult = await pool.query("SELECT spreadsheet_id, sheet_name FROM spreadsheet_config LIMIT 1");
    const sc = scResult.rows[0];
    checks.spreadsheet_config = {
      ok: !!sc?.spreadsheet_id,
      detail: sc?.spreadsheet_id
        ? `ID: ${sc.spreadsheet_id}${sc.sheet_name ? ` | Tab: ${sc.sheet_name}` : " | Tab: (default)"}`
        : "Spreadsheet ID belum dikonfigurasi. Buka Master → Spreadsheet",
    };

    const allOk = Object.values(checks).every(c => c.ok);
    res.json({ allOk, checks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
