import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startBackupScheduler } from "./lib/backup-scheduler";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function setupDatabase() {
  try {
    const { pool } = await import("@workspace/db");

    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        description TEXT,
        kategori TEXT NOT NULL DEFAULT 'scan',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scan_in (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        box_label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scanning',
        user_id INTEGER NOT NULL REFERENCES users(id),
        qr_code_data TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS scan_items (
        id SERIAL PRIMARY KEY,
        serial_number TEXT NOT NULL UNIQUE,
        scan_in_id INTEGER REFERENCES scan_in(id),
        scan_out_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scan_out (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS non_scan_masuk (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        kode_material TEXT NOT NULL,
        jumlah INTEGER NOT NULL,
        satuan TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS non_scan_keluar (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        jumlah INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Migrate: tambah kolom baru jika belum ada (aman untuk database lama)
    await pool.query(`
      ALTER TABLE materials ADD COLUMN IF NOT EXISTS kategori TEXT NOT NULL DEFAULT 'scan';
    `);

    // Auto backup config table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backup_config (
        id SERIAL PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        interval TEXT NOT NULL DEFAULT 'daily',
        hour INTEGER NOT NULL DEFAULT 2,
        minute INTEGER NOT NULL DEFAULT 0,
        keep_count INTEGER NOT NULL DEFAULT 7,
        last_run_at TIMESTAMPTZ
      );
    `);
    const bcRows = await pool.query("SELECT id FROM backup_config LIMIT 1");
    if (bcRows.rows.length === 0) {
      await pool.query("INSERT INTO backup_config (enabled) VALUES (false)");
    }

    logger.info("Database tables ready");

    // Seed admin user if no users exist
    const existing = await pool.query("SELECT id FROM users LIMIT 1");
    if (existing.rows.length === 0) {
      const hash = crypto.createHash("sha256").update("admin123" + "gudang_salt_2024").digest("hex");
      await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)",
        ["admin", hash, "master"]
      );
      logger.info("Admin user seeded: admin / admin123");
    }
  } catch (err) {
    logger.error({ err }, "Database setup failed");
  }
}

setupDatabase().then(() => {
  startBackupScheduler();
});

app.use("/api", router);

// Serve frontend static files
const frontendPath = path.resolve(__dirname, "../../gudang/dist/public");
app.use(express.static(frontendPath));
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

export default app;
