import { pgTable, text, serial, bigint, integer, timestamp } from "drizzle-orm/pg-core";
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
  buktiImage: text("bukti_image"), // data URL base64 (foto bukti)
  userId: integer("user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KasTransaksi = typeof kasTransaksiTable.$inferSelect;

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
