import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const materialBekasGaransiTable = pgTable("material_bekas_garansi", {
  id: serial("id").primaryKey(),
  serialNumber: text("serial_number").notNull(),
  materialCode: text("material_code"),
  materialName: text("material_name").notNull(),
  merk: text("merk"),
  tahun: integer("tahun").notNull(),
  bulan: integer("bulan").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMaterialBekasGaransiSchema = createInsertSchema(materialBekasGaransiTable).omit({ id: true, createdAt: true });
export type InsertMaterialBekasGaransi = z.infer<typeof insertMaterialBekasGaransiSchema>;
export type MaterialBekasGaransi = typeof materialBekasGaransiTable.$inferSelect;

export const materialBekasUsulHapusTable = pgTable("material_bekas_usul_hapus", {
  id: serial("id").primaryKey(),
  serialNumber: text("serial_number").notNull(),
  materialCode: text("material_code"),
  materialName: text("material_name").notNull(),
  merk: text("merk"),
  tahun: integer("tahun").notNull(),
  bulan: integer("bulan").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMaterialBekasUsulHapusSchema = createInsertSchema(materialBekasUsulHapusTable).omit({ id: true, createdAt: true });
export type InsertMaterialBekasUsulHapus = z.infer<typeof insertMaterialBekasUsulHapusSchema>;
export type MaterialBekasUsulHapus = typeof materialBekasUsulHapusTable.$inferSelect;
