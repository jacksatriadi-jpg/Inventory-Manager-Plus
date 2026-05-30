import fs from "fs";
import path from "path";
import { db, usersTable, materialsTable, scanInTable, scanItemsTable, scanOutTable, nonScanMasukTable, nonScanKeluarTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { logger } from "./logger";

export const BACKUP_DIR = path.resolve(process.cwd(), "backups");

export function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

export async function runBackupToFile(): Promise<string> {
  ensureBackupDir();

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
    autoBackup: true,
    data: { users, materials, scanIns, scanItems, scanOuts, nonScanMasuk, nonScanKeluar },
  };

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `auto_backup_${ts}.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), "utf-8");

  return filename;
}

export function listBackupFiles(): Array<{ filename: string; size: number; createdAt: string }> {
  ensureBackupDir();
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function getBackupFilePath(filename: string): string {
  const safe = path.basename(filename);
  return path.join(BACKUP_DIR, safe);
}

async function pruneOldBackups(keepCount: number) {
  const files = listBackupFiles().filter((f) => f.filename.startsWith("auto_backup_"));
  const toDelete = files.slice(keepCount);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, file.filename));
      logger.info({ file: file.filename }, "Auto backup pruned");
    } catch {}
  }
}

async function getConfig() {
  try {
    const result = await pool.query("SELECT * FROM backup_config LIMIT 1");
    return result.rows[0] ?? null;
  } catch {
    return null;
  }
}

async function updateLastRun() {
  await pool.query("UPDATE backup_config SET last_run_at = NOW()");
}

function shouldRun(config: any, now: Date): boolean {
  if (!config?.enabled) return false;
  if (now.getHours() !== Number(config.hour) || now.getMinutes() !== Number(config.minute)) return false;
  if (!config.last_run_at) return true;

  const last = new Date(config.last_run_at);
  if (config.interval === "daily") return last.toDateString() !== now.toDateString();
  if (config.interval === "weekly") {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return last < weekAgo;
  }
  if (config.interval === "monthly") {
    return last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear();
  }
  return false;
}

export function startBackupScheduler() {
  ensureBackupDir();

  setInterval(async () => {
    try {
      const config = await getConfig();
      if (!shouldRun(config, new Date())) return;

      logger.info("Auto backup: starting scheduled backup");
      const filename = await runBackupToFile();
      await updateLastRun();
      await pruneOldBackups(Number(config.keep_count) || 7);
      logger.info({ filename }, "Auto backup: completed");
    } catch (err) {
      logger.error({ err }, "Auto backup: scheduler error");
    }
  }, 60_000);

  logger.info("Backup scheduler started (checks every minute)");
}
