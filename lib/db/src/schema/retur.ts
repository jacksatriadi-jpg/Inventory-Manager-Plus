import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { isNotNull } from "drizzle-orm";
import { usersTable } from "./users";
import { materialsTable } from "./materials";

// ─── Modul Retur Material (TUG10 + ceklist 2 tahap) — terpisah dari materialBekas ─
// status: 'checked_supervisor' | 'completed'

export const returDokumenTable = pgTable("retur_dokumen", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id),
  tug10FileId: text("tug10_file_id").notNull(), // Google Drive Retur file id (bukan bytes)
  tug10Link: text("tug10_link"),
  folderFileId: text("folder_file_id"), // id folder Drive dokumen (RETUR-...); NULL = dokumen lama
  status: text("status").notNull().default("checked_supervisor"),
  catatan: text("catatan"),
  gudangCatatan: text("gudang_catatan"),
  pengawasId: integer("pengawas_id").notNull().references(() => usersTable.id),
  gudangId: integer("gudang_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type ReturDokumen = typeof returDokumenTable.$inferSelect;

// ─── Unit fisik dalam satu dokumen retur; sn = nomor seri MIMS (diisi gudang) ─────
export const returUnitTable = pgTable("retur_unit", {
  id: serial("id").primaryKey(),
  dokumenId: integer("dokumen_id").notNull().references(() => returDokumenTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  // keputusan = disposisi gudang per unit (diisi saat verifikasi): 'layak_pakai' | 'usul_hapus'; NULL = belum diverifikasi.
  keputusan: text("keputusan"), // CHECK di DDL runtime app.ts
  sn: text("sn"),
  folderFileId: text("folder_file_id"), // id folder Drive unit ("Unit n - label"); NULL = lama
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("retur_unit_sn_unique").on(table.sn).where(isNotNull(table.sn)),
]);

export type ReturUnit = typeof returUnitTable.$inferSelect;

// ─── Template daftar komponen ceklist per material ────────────────────────────────
export const returTemplateItemTable = pgTable("retur_template_item", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  urut: integer("urut").notNull().default(0),
});

export type ReturTemplateItem = typeof returTemplateItemTable.$inferSelect;

// ─── Hasil ceklist per item per unit per tahap ────────────────────────────────────
// stage: 'pengawas' | 'gudang' ; hasil: 'ada' | 'hilang' | 'rusak'
export const returItemCekTable = pgTable("retur_item_cek", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull().references(() => returUnitTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  itemLabel: text("item_label").notNull(),
  hasil: text("hasil").notNull(),
  catatan: text("catatan"),
  fotoFileId: text("foto_file_id").notNull(), // Google Drive Retur file id
  fotoLink: text("foto_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReturItemCek = typeof returItemCekTable.$inferSelect;

// ─── Notifikasi in-app (bell) untuk petugas gudang ────────────────────────────────
export const returNotifikasiTable = pgTable("retur_notifikasi", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  dokumenId: integer("dokumen_id").notNull().references(() => returDokumenTable.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReturNotifikasi = typeof returNotifikasiTable.$inferSelect;

// ─── Akun Google Drive KEDUA khusus foto retur (terpisah dari backup_config) ──────
export const returGdriveConfigTable = pgTable("retur_gdrive_config", {
  id: serial("id").primaryKey(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
  accountEmail: text("account_email"),
  folderId: text("folder_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type ReturGdriveConfig = typeof returGdriveConfigTable.$inferSelect;
