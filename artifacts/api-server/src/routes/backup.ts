import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db, usersTable, materialsTable, scanInTable, scanItemsTable, scanOutTable, nonScanMasukTable, nonScanKeluarTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { parseToken } from "../lib/auth";
import { runBackupToFile, listBackupFiles, getBackupFilePath, ensureBackupDir } from "../lib/backup-scheduler";
import { getAuthUrl, exchangeCodeAndSave, disconnectGoogleDrive, getGoogleDriveStatus } from "../lib/google-drive";

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
      data: {
        users,
        materials,
        scanIns,
        scanItems,
        scanOuts,
        nonScanMasuk,
        nonScanKeluar,
      },
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

    let insertedUsers = 0, insertedMaterials = 0, insertedScanIns = 0;
    let insertedScanItems = 0, insertedScanOuts = 0, insertedNonScanMasuk = 0, insertedNonScanKeluar = 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query("DELETE FROM non_scan_keluar");
      await client.query("DELETE FROM non_scan_masuk");
      await client.query("DELETE FROM scan_items");
      await client.query("DELETE FROM scan_out");
      await client.query("DELETE FROM scan_in");
      await client.query("DELETE FROM materials");
      await client.query("DELETE FROM users");

      if (users.length > 0) {
        for (const u of users) {
          await client.query(
            `INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [u.id, u.username, u.passwordHash ?? u.password_hash, u.role ?? "user", toDate(u.createdAt) ?? toDate(u.created_at) ?? new Date()]
          );
        }
        insertedUsers = users.length;
      }

      if (materials.length > 0) {
        for (const m of materials) {
          await client.query(
            `INSERT INTO materials (id, name, code, description, kategori, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
            [m.id, m.name, m.code, m.description ?? null, m.kategori ?? "scan", toDate(m.createdAt) ?? toDate(m.created_at) ?? new Date()]
          );
        }
        insertedMaterials = materials.length;
      }

      if (scanIns.length > 0) {
        for (const s of scanIns) {
          await client.query(
            `INSERT INTO scan_in (id, material_id, box_label, status, user_id, created_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [s.id, s.materialId ?? s.material_id, s.boxLabel ?? s.box_label, s.status ?? "completed", s.userId ?? s.user_id, toDate(s.createdAt) ?? toDate(s.created_at) ?? new Date(), toDate(s.completedAt) ?? toDate(s.completed_at) ?? null]
          );
        }
        insertedScanIns = scanIns.length;
      }

      if (scanItems.length > 0) {
        for (const i of scanItems) {
          await client.query(
            `INSERT INTO scan_items (id, serial_number, scan_in_id, scan_out_id, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [i.id, i.serialNumber ?? i.serial_number, i.scanInId ?? i.scan_in_id ?? null, i.scanOutId ?? i.scan_out_id ?? null, toDate(i.createdAt) ?? toDate(i.created_at) ?? new Date()]
          );
        }
        insertedScanItems = scanItems.length;
      }

      if (scanOuts.length > 0) {
        for (const o of scanOuts) {
          await client.query(
            `INSERT INTO scan_out (id, user_id, created_at) VALUES ($1,$2,$3)`,
            [o.id, o.userId ?? o.user_id, toDate(o.createdAt) ?? toDate(o.created_at) ?? new Date()]
          );
        }
        insertedScanOuts = scanOuts.length;
      }

      if (nonScanMasuk.length > 0) {
        for (const nm of nonScanMasuk) {
          await client.query(
            `INSERT INTO non_scan_masuk (id, material_id, kode_material, jumlah, satuan, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [nm.id, nm.materialId ?? nm.material_id, nm.kodeMaterial ?? nm.kode_material, nm.jumlah, nm.satuan, nm.userId ?? nm.user_id, toDate(nm.createdAt) ?? toDate(nm.created_at) ?? new Date()]
          );
        }
        insertedNonScanMasuk = nonScanMasuk.length;
      }

      if (nonScanKeluar.length > 0) {
        for (const nk of nonScanKeluar) {
          await client.query(
            `INSERT INTO non_scan_keluar (id, material_id, jumlah, user_id, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [nk.id, nk.materialId ?? nk.material_id, nk.jumlah, nk.userId ?? nk.user_id, toDate(nk.createdAt) ?? toDate(nk.created_at) ?? new Date()]
          );
        }
        insertedNonScanKeluar = nonScanKeluar.length;
      }

      await client.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0) + 1, false)`);
      await client.query(`SELECT setval('materials_id_seq', COALESCE((SELECT MAX(id) FROM materials), 0) + 1, false)`);
      await client.query(`SELECT setval('scan_in_id_seq', COALESCE((SELECT MAX(id) FROM scan_in), 0) + 1, false)`);
      await client.query(`SELECT setval('scan_items_id_seq', COALESCE((SELECT MAX(id) FROM scan_items), 0) + 1, false)`);
      await client.query(`SELECT setval('scan_out_id_seq', COALESCE((SELECT MAX(id) FROM scan_out), 0) + 1, false)`);
      await client.query(`SELECT setval('non_scan_masuk_id_seq', COALESCE((SELECT MAX(id) FROM non_scan_masuk), 0) + 1, false)`);
      await client.query(`SELECT setval('non_scan_keluar_id_seq', COALESCE((SELECT MAX(id) FROM non_scan_keluar), 0) + 1, false)`);

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

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
    res.json(result.rows[0] ?? { enabled: false, interval: "daily", hour: 2, minute: 0, keep_count: 7, last_run_at: null, gdrive_enabled: false, gdrive_account_email: null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-backup/config", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const { enabled, interval, hour, minute, keep_count, gdrive_enabled } = req.body;
    const validIntervals = ["daily", "weekly", "monthly"];
    if (!validIntervals.includes(interval)) {
      res.status(400).json({ error: "Invalid interval" });
      return;
    }
    const h = Math.max(0, Math.min(23, Number(hour) || 0));
    const m = Math.max(0, Math.min(59, Number(minute) || 0));
    const k = Math.max(1, Math.min(30, Number(keep_count) || 7));

    // Only set gdrive_enabled if account is already connected
    const currentConfig = await pool.query("SELECT gdrive_access_token FROM backup_config LIMIT 1");
    const hasToken = !!currentConfig.rows[0]?.gdrive_access_token;
    const gdriveEnabled = hasToken ? Boolean(gdrive_enabled) : false;

    await pool.query(
      `UPDATE backup_config SET enabled=$1, interval=$2, hour=$3, minute=$4, keep_count=$5, gdrive_enabled=$6`,
      [Boolean(enabled), interval, h, m, k, gdriveEnabled]
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

// ─── Google Drive OAuth ───────────────────────────────────────────────────────

/**
 * GET /api/auto-backup/google/auth-url
 * Returns the Google OAuth consent URL for the frontend to open.
 */
router.get("/auto-backup/google/auth-url", (req, res): void => {
  if (!requireMaster(req, res)) return;
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auto-backup/google/callback
 * Google redirects here after the user approves access.
 * Exchanges the code for tokens, stores them, and redirects the browser
 * back to the Master page.
 */
router.get("/auto-backup/google/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.status(400).send("Missing authorization code from Google.");
    return;
  }
  try {
    const { email } = await exchangeCodeAndSave(code);
    // Redirect browser to the Master Backup tab, flagging success
    res.redirect(`/master?tab=backup&gdrive=connected&email=${encodeURIComponent(email)}`);
  } catch (err: any) {
    res.redirect(`/master?tab=backup&gdrive=error&msg=${encodeURIComponent(err.message)}`);
  }
});

/**
 * GET /api/auto-backup/google/status
 * Returns whether a Google account is connected and its email.
 */
router.get("/auto-backup/google/status", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    const status = await getGoogleDriveStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auto-backup/google/disconnect
 * Removes stored tokens and disables Google Drive uploads.
 */
router.post("/auto-backup/google/disconnect", async (req, res): Promise<void> => {
  if (!requireMaster(req, res)) return;
  try {
    await disconnectGoogleDrive();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
