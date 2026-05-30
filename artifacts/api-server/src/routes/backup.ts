import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db, usersTable, materialsTable, scanInTable, scanItemsTable, scanOutTable, nonScanMasukTable, nonScanKeluarTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { parseToken } from "../lib/auth";
import { runBackupToFile, listBackupFiles, getBackupFilePath, ensureBackupDir } from "../lib/backup-scheduler";

const router: IRouter = Router();

function toDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

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

// ─── Manual Backup / Restore ─────────────────────────────────────────────────

router.get("/backup", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;

  try {
    const [users, materials, scanIns, scanItems, scanOuts, nonScanMasuk, nonScanKeluar] = await Promise.all([
      db.select().from(usersTable),
      db.select().from(materialsTable),
      db.select().from(scanInTable),
      db.select().from(scanItemsTable),
      db.select().from(scanOutTable),
      db.select().from(nonScanMasukTable),
      db.select().from(nonScanKeluarTable),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      version: 2,
      data: { users, materials, scanIns, scanItems, scanOuts, nonScanMasuk, nonScanKeluar },
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="backup_${Date.now()}.json"`);
    res.json(backup);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Backup failed" });
  }
});

router.post("/restore", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;

  try {
    const { data } = req.body;
    if (!data) {
      res.status(400).json({ error: "Invalid backup file: missing data field" });
      return;
    }

    const { users = [], materials = [], scanIns = [], scanItems = [], scanOuts = [], nonScanMasuk = [], nonScanKeluar = [] } = data;

    await db.delete(nonScanKeluarTable);
    await db.delete(nonScanMasukTable);
    await db.delete(scanItemsTable);
    await db.delete(scanOutTable);
    await db.delete(scanInTable);
    await db.delete(materialsTable);
    await db.delete(usersTable);

    let insertedUsers = 0, insertedMaterials = 0, insertedScanIns = 0;
    let insertedScanItems = 0, insertedScanOuts = 0, insertedNonScanMasuk = 0, insertedNonScanKeluar = 0;

    if (users.length > 0) {
      const rows = users.map((u: any) => ({ ...u, createdAt: toDate(u.createdAt) }));
      await db.insert(usersTable).values(rows);
      insertedUsers = rows.length;
    }
    if (materials.length > 0) {
      const rows = materials.map((m: any) => ({ ...m, kategori: m.kategori ?? "scan", createdAt: toDate(m.createdAt) }));
      await db.insert(materialsTable).values(rows);
      insertedMaterials = rows.length;
    }
    if (scanIns.length > 0) {
      const rows = scanIns.map((s: any) => ({ ...s, createdAt: toDate(s.createdAt), completedAt: toDate(s.completedAt) }));
      await db.insert(scanInTable).values(rows);
      insertedScanIns = rows.length;
    }
    if (scanItems.length > 0) {
      const rows = scanItems.map((i: any) => ({ ...i, createdAt: toDate(i.createdAt) }));
      await db.insert(scanItemsTable).values(rows);
      insertedScanItems = rows.length;
    }
    if (scanOuts.length > 0) {
      const rows = scanOuts.map((o: any) => ({ ...o, createdAt: toDate(o.createdAt) }));
      await db.insert(scanOutTable).values(rows);
      insertedScanOuts = rows.length;
    }
    if (nonScanMasuk.length > 0) {
      const rows = nonScanMasuk.map((nm: any) => ({ ...nm, createdAt: toDate(nm.createdAt) }));
      await db.insert(nonScanMasukTable).values(rows);
      insertedNonScanMasuk = rows.length;
    }
    if (nonScanKeluar.length > 0) {
      const rows = nonScanKeluar.map((nk: any) => ({ ...nk, createdAt: toDate(nk.createdAt) }));
      await db.insert(nonScanKeluarTable).values(rows);
      insertedNonScanKeluar = rows.length;
    }

    await db.execute(sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('materials_id_seq', COALESCE((SELECT MAX(id) FROM materials), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('scan_in_id_seq', COALESCE((SELECT MAX(id) FROM scan_in), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('scan_items_id_seq', COALESCE((SELECT MAX(id) FROM scan_items), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('scan_out_id_seq', COALESCE((SELECT MAX(id) FROM scan_out), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('non_scan_masuk_id_seq', COALESCE((SELECT MAX(id) FROM non_scan_masuk), 0) + 1, false)`);
    await db.execute(sql`SELECT setval('non_scan_keluar_id_seq', COALESCE((SELECT MAX(id) FROM non_scan_keluar), 0) + 1, false)`);

    res.json({
      success: true,
      restored: {
        users: insertedUsers, materials: insertedMaterials, scanIns: insertedScanIns,
        scanItems: insertedScanItems, scanOuts: insertedScanOuts,
        nonScanMasuk: insertedNonScanMasuk, nonScanKeluar: insertedNonScanKeluar,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Restore failed" });
  }
});

// ─── Auto Backup Config ───────────────────────────────────────────────────────

router.get("/auto-backup/config", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const result = await pool.query("SELECT * FROM backup_config LIMIT 1");
    res.json(result.rows[0] ?? { enabled: false, interval: "daily", hour: 2, minute: 0, keep_count: 7, last_run_at: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-backup/config", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const { enabled, interval, hour, minute, keep_count } = req.body;
    const validIntervals = ["daily", "weekly", "monthly"];
    if (!validIntervals.includes(interval)) {
      res.status(400).json({ error: "Invalid interval" });
      return;
    }
    const h = Math.max(0, Math.min(23, Number(hour) || 0));
    const m = Math.max(0, Math.min(59, Number(minute) || 0));
    const k = Math.max(1, Math.min(30, Number(keep_count) || 7));

    await pool.query(
      `UPDATE backup_config SET enabled=$1, interval=$2, hour=$3, minute=$4, keep_count=$5`,
      [Boolean(enabled), interval, h, m, k]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auto Backup Files ────────────────────────────────────────────────────────

router.get("/auto-backup/list", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    ensureBackupDir();
    const files = listBackupFiles();
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-backup/run-now", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const filename = await runBackupToFile();
    await pool.query("UPDATE backup_config SET last_run_at = NOW()");
    res.json({ success: true, filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auto-backup/download/:filename", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const filename = path.basename(req.params.filename);
    const filepath = getBackupFilePath(filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(filepath);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/auto-backup/file/:filename", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const filename = path.basename(req.params.filename);
    const filepath = getBackupFilePath(filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    fs.unlinkSync(filepath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
