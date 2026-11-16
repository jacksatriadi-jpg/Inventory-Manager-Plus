import { pgTable, text, serial, bigint, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Kas kecil gudang — transaksi kas masuk/keluar
// tipe   : 'masuk' | 'keluar'
// metode : 'manual' | 'ocr' (foto bukti transfer / nota pembelian)
export const kasTransaksiTable = pgTable("kas_transaksi", {
  id: serial("id").primaryKey(),
  tipe: text("tipe").notNull(),
  metode: text("metode").notNull().default("manual"),
  jumlah: bigint("jumlah", { mode: "number" }).notNull(),
  keterangan: text("keterangan"),
  kategori: text("kategori").notNull().default("Kas Gudang"), // jenis kas (default "Kas Gudang" + kategori custom user)
  buktiImage: text("bukti_image"), // data URL base64 (fallback lama; foto baru → Drive)
  userId: integer("user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KasTransaksi = typeof kasTransaksiTable.$inferSelect;

// ─── Kas: kategori/jenis kas ("Kas Gudang" default + kategori yang ditentukan user) ──
export const kasKategoriTable = pgTable("kas_kategori", {
  id: serial("id").primaryKey(),
  nama: text("nama").notNull().unique(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Lembur: karyawan tetap untuk absensi lembur Sabtu/Minggu ─────────────
export const lemburKaryawanTable = pgTable("lembur_karyawan", {
  id: serial("id").primaryKey(),
  nama: text("nama").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Lembur: absensi lembur per karyawan per tanggal ──────────────────────
// jenis: 'gps' | 'wajah' ; fee diisi bendahara → otomatis jadi kas keluar
export const lemburAbsensiTable = pgTable("lembur_absensi", {
  id: serial("id").primaryKey(),
  karyawanId: integer("karyawan_id").notNull().references(() => lemburKaryawanTable.id),
  tanggal: text("tanggal").notNull(), // YYYY-MM-DD
  jenis: text("jenis").notNull().default("gps"),
  fee: bigint("fee", { mode: "number" }),
  kasTransaksiId: integer("kas_transaksi_id"),
  lat: text("lat"),
  lng: text("lng"),
  jarakMeter: integer("jarak_meter"),
  selfieImage: text("selfie_image"), // data URL foto selfie (fallback lama; foto baru → Drive)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Lokasi kerja lembur yang ditentukan bendahara (radius toleransi dalam meter)
export const lemburLokasiConfigTable = pgTable("lembur_lokasi_config", {
  id: serial("id").primaryKey(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  radiusMeter: integer("radius_meter").notNull().default(100),
  label: text("label"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
