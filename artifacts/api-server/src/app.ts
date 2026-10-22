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
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

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

      CREATE TABLE IF NOT EXISTS non_scan_keluar (\n        id SERIAL PRIMARY KEY,\n        material_id INTEGER NOT NULL REFERENCES materials(id),\n        jumlah INTEGER NOT NULL,\n        user_id INTEGER NOT NULL REFERENCES users(id),\n        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n      );

      CREATE TABLE IF NOT EXISTS material_bekas_garansi (\n        id SERIAL PRIMARY KEY,\n        serial_number TEXT NOT NULL,\n        material_name TEXT NOT NULL,\n        tahun INTEGER NOT NULL,\n        bulan INTEGER NOT NULL,\n        user_id INTEGER NOT NULL REFERENCES users(id),\n        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n      );

      CREATE TABLE IF NOT EXISTS material_bekas_usul_hapus (\n        id SERIAL PRIMARY KEY,\n        serial_number TEXT NOT NULL,\n        material_name TEXT NOT NULL,\n        tahun INTEGER NOT NULL,\n        bulan INTEGER NOT NULL,\n        user_id INTEGER NOT NULL REFERENCES users(id),\n        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n      );

      CREATE TABLE IF NOT EXISTS kas_transaksi (
        id SERIAL PRIMARY KEY,
        tipe TEXT NOT NULL,
        metode TEXT NOT NULL DEFAULT 'manual',
        jumlah BIGINT NOT NULL,
        keterangan TEXT,
        bukti_image TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lembur_karyawan (
        id SERIAL PRIMARY KEY,
        nama TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lembur_absensi (
        id SERIAL PRIMARY KEY,
        karyawan_id INTEGER NOT NULL REFERENCES lembur_karyawan(id),
        tanggal TEXT NOT NULL,
        jenis TEXT NOT NULL DEFAULT 'gps',
        fee BIGINT,
        kas_transaksi_id INTEGER,
        lat TEXT,
        lng TEXT,
        jarak_meter INTEGER,
        selfie_image TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (karyawan_id, tanggal)
      );

      CREATE TABLE IF NOT EXISTS lembur_lokasi_config (
        id SERIAL PRIMARY KEY,
        lat TEXT NOT NULL,
        lng TEXT NOT NULL,
        radius_meter INTEGER NOT NULL DEFAULT 100,
        label TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Migrate: tambah kolom baru jika belum ada (aman untuk database lama)
    await pool.query(`
      ALTER TABLE materials ADD COLUMN IF NOT EXISTS kategori TEXT NOT NULL DEFAULT 'scan';
    `);

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS menu_access JSONB DEFAULT '[]'::jsonb;
    `);

    await pool.query(`
      ALTER TABLE material_bekas_garansi
        ADD COLUMN IF NOT EXISTS material_code TEXT,
        ADD COLUMN IF NOT EXISTS merk TEXT;
      ALTER TABLE material_bekas_usul_hapus
        ADD COLUMN IF NOT EXISTS material_code TEXT,
        ADD COLUMN IF NOT EXISTS merk TEXT;
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

    // Migrate: add Google Drive columns if not exist (safe for existing databases)
    await pool.query(`
      ALTER TABLE backup_config
        ADD COLUMN IF NOT EXISTS gdrive_enabled BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS gdrive_access_token TEXT,
        ADD COLUMN IF NOT EXISTS gdrive_refresh_token TEXT,
        ADD COLUMN IF NOT EXISTS gdrive_token_expiry TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS gdrive_account_email TEXT,
        ADD COLUMN IF NOT EXISTS gdrive_folder_id TEXT;
    `);

    // Spreadsheet config table (Google Sheets integration)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS spreadsheet_config (
        id SERIAL PRIMARY KEY,
        spreadsheet_id TEXT,
        sheet_name TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    const scRows = await pool.query("SELECT id FROM spreadsheet_config LIMIT 1");
    if (scRows.rows.length === 0) {
      await pool.query("INSERT INTO spreadsheet_config (spreadsheet_id, sheet_name) VALUES (NULL, NULL)");
    }
    // Migrate: add sheet_name if not exist (safe for existing DB)
    await pool.query(`
      ALTER TABLE spreadsheet_config ADD COLUMN IF NOT EXISTS sheet_name TEXT;
    `);

    // ─── Retur Material (TUG10 + ceklist 2 tahap) ──────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retur_dokumen (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        tug10_file_id TEXT NOT NULL,
        tug10_link TEXT,
        status TEXT NOT NULL DEFAULT 'checked_supervisor',
        catatan TEXT,
        gudang_catatan TEXT,
        pengawas_id INTEGER NOT NULL REFERENCES users(id),
        gudang_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retur_unit (
        id SERIAL PRIMARY KEY,
        dokumen_id INTEGER NOT NULL REFERENCES retur_dokumen(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        sn TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      ALTER TABLE retur_unit ADD COLUMN IF NOT EXISTS keputusan TEXT
        CHECK (keputusan IS NULL OR keputusan IN ('layak_pakai','usul_hapus'));
    `);
    await pool.query(`
      ALTER TABLE retur_dokumen ADD COLUMN IF NOT EXISTS folder_file_id TEXT;
    `);
    await pool.query(`
      ALTER TABLE retur_unit ADD COLUMN IF NOT EXISTS folder_file_id TEXT;
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS retur_item_cek_unit_idx ON retur_item_cek (unit_id);
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS retur_unit_sn_unique ON retur_unit (sn) WHERE sn IS NOT NULL;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retur_template_item (
        id SERIAL PRIMARY KEY,
        material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        urut INTEGER NOT NULL DEFAULT 0
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retur_item_cek (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES retur_unit(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        item_label TEXT NOT NULL,
        hasil TEXT NOT NULL,
        catatan TEXT,
        foto_file_id TEXT,
        foto_link TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Migrasi: opsi hasil + flag wajib foto pindah ke per komponen; opsi per material (tabel terpisah) dihapus.
    await pool.query(`
      ALTER TABLE retur_template_item ADD COLUMN IF NOT EXISTS options JSONB,
        ADD COLUMN IF NOT EXISTS foto_wajib_pengawas BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS foto_wajib_gudang BOOLEAN NOT NULL DEFAULT true;
    `);
    // Migrasi: tipe input per komponen — "opsi" = checklist, "teks" = input form bebas.
    await pool.query(`
      ALTER TABLE retur_template_item ADD COLUMN IF NOT EXISTS tipe_input TEXT NOT NULL DEFAULT 'opsi'
        CHECK (tipe_input IN ('opsi','teks'));
    `);
    await pool.query(`
      UPDATE retur_template_item
      SET tipe_input = 'teks', options = NULL
      WHERE tipe_input = 'opsi'
        AND options @> '["ISI DI KOLOM CATATAN"]'::jsonb
        AND jsonb_array_length(options) = 1;
    `);
    await pool.query(`ALTER TABLE retur_item_cek ALTER COLUMN foto_file_id DROP NOT NULL;`);
    await pool.query(`DROP TABLE IF EXISTS retur_template_option;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retur_notifikasi (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dokumen_id INTEGER NOT NULL REFERENCES retur_dokumen(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS retur_gdrive_config (
        id SERIAL PRIMARY KEY,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TIMESTAMPTZ,
        account_email TEXT,
        folder_id TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    const rgcRows = await pool.query("SELECT id FROM retur_gdrive_config LIMIT 1");
    if (rgcRows.rows.length === 0) {
      await pool.query("INSERT INTO retur_gdrive_config (access_token, refresh_token) VALUES (NULL, NULL)");
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
