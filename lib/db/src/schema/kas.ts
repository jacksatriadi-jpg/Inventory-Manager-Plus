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
