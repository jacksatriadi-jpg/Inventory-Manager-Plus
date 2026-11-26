import type { PoolClient } from "pg";
import { pool } from "@workspace/db";

// ─── Backup/restore generik: SEMUA tabel aplikasi ikut tercakup ───────────────
// URUTAN = induk sebelum anak (untuk INSERT saat restore). Penghapusan memakai
// TRUNCATE ... CASCADE jadi urutan hapus tidak masalah.
// Tabel baru WAJIB ditambahkan ke daftar ini agar ikut ter-backup —
// letakkan setelah tabel induknya (FK).
export const BACKUP_TABLES: readonly string[] = [
  "users",
  "materials",
  "scan_in",
  "scan_out",
  "scan_items",
  "non_scan_masuk",
  "non_scan_keluar",
  "material_bekas_garansi",
  "material_bekas_usul_hapus",
  "kas_kategori",
  "kas_transaksi",
  "lembur_karyawan",
  "lembur_absensi",
  "lembur_lokasi_config",
  "retur_form_template",
  "retur_template_item",
  "retur_dokumen",
  "retur_dokumen_material",
  "retur_unit",
  "retur_item_cek",
  "retur_notifikasi",
  "retur_draft",
  "spreadsheet_config",
  "retur_gdrive_config",
  "backup_config",
];

// Kolom besar yang tidak perlu dibackup (QR mentah per scan-in; bisa dibangun
// ulang dari serial/box label dan dulu pun sudah distrip FE saat restore).
const DROP_COLUMNS: Record<string, string[]> = {
  scan_in: ["qr_code_data"],
};

const quoteId = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Ambil seluruh isi DB sebagai { tabel: rows[] } (raw snake_case). */
export async function collectBackupData(): Promise<Record<string, unknown[]>> {
  const data: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    const r = await pool.query(`SELECT * FROM ${quoteId(t)}`);
    const drop = DROP_COLUMNS[t];
    if (drop) {
      for (const row of r.rows as Record<string, unknown>[]) for (const c of drop) delete row[c];
    }
    data[t] = r.rows;
  }
  return data;
}

/**
 * Pulihkan hasil v3 (hasil collectBackupData) — wipe total semua tabel lalu
 * insert ulang per tabel, lalu sinkronkan sequence. Dalam satu transaksi.
 */
export async function applyBackupData(
  client: PoolClient,
  data: Record<string, unknown[]>,
): Promise<{ perTable: Record<string, number>; totalRows: number }> {
  await client.query(`TRUNCATE ${BACKUP_TABLES.map(quoteId).join(", ")} RESTART IDENTITY CASCADE`);
  const perTable: Record<string, number> = {};
  let totalRows = 0;
  for (const t of BACKUP_TABLES) {
    const rows = (data[t] ?? []) as Record<string, unknown>[];
    let n = 0;
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined);
      if (cols.length === 0) continue;
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
      await client.query(
        `INSERT INTO ${quoteId(t)} (${cols.map(quoteId).join(",")}) VALUES (${placeholders})`,
        // Array dikirim sebagai JSON string: tanpa ini driver pg mengirim literal
        // array PG (`{a,b}`) yang ditolak kolom jsonb (mis. users.menu_access).
        cols.map((c) => (Array.isArray(row[c]) ? JSON.stringify(row[c]) : row[c])),
      );
      n++;
    }
    // Reset sequence utk tabel ber-id serial. Cek eksistensi kolom dulu:
    // pg_get_serial_sequence MELEMPAR utk kolom tak ada, dan error di dalam
    // transaction membatalkan seluruh transaksi.
    const hasId = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id'",
      [t],
    );
    if (hasId.rowCount) {
      const seq = await client.query("SELECT pg_get_serial_sequence($1, 'id') AS s", [t]);
      const seqName = seq.rows[0]?.s as string | null;
      if (seqName) {
        await client.query(
          `SELECT setval($1, (SELECT COALESCE(MAX(id), 0) + 1 FROM ${quoteId(t)}), false)`,
          [seqName],
        );
      }
    }
    perTable[t] = n;
    totalRows += n;
  }
  return { perTable, totalRows };
}

/** True bila file backup format lama (v1/v2, key camelCase drizzle). */
export function isLegacyBackupData(data: Record<string, unknown>): boolean {
  return ["scanIns", "nonScanMasuk", "materialBekasGaransi"].some((k) => k in data);
}

/** Bentuk respons /restore agar FE lama (key legacy) tetap terisi + info total. */
export function legacyShapedResult(perTable: Record<string, number>, totalRows: number) {
  return {
    users: perTable["users"] ?? 0,
    materials: perTable["materials"] ?? 0,
    scanIns: perTable["scan_in"] ?? 0,
    scanItems: perTable["scan_items"] ?? 0,
    scanOuts: perTable["scan_out"] ?? 0,
    nonScanMasuk: perTable["non_scan_masuk"] ?? 0,
    nonScanKeluar: perTable["non_scan_keluar"] ?? 0,
    materialBekasGaransi: perTable["material_bekas_garansi"] ?? 0,
    materialBekasUsulHapus: perTable["material_bekas_usul_hapus"] ?? 0,
    returDokumen: perTable["retur_dokumen"] ?? 0,
    kasTransaksi: perTable["kas_transaksi"] ?? 0,
    lemburAbsensi: perTable["lembur_absensi"] ?? 0,
    tables: Object.keys(perTable).length,
    totalRows,
  };
}
