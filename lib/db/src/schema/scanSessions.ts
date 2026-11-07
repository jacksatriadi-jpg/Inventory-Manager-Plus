import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { materialsTable } from "./materials";

export const scanInTable = pgTable("scan_in", {
  id: serial("id").primaryKey(),
  materialId: integer("material_id").notNull().references(() => materialsTable.id),
  boxLabel: text("box_label").notNull(),
  status: text("status").notNull().default("scanning"), // "scanning" | "completed"
  userId: integer("user_id").notNull().references(() => usersTable.id),
  qrCodeData: text("qr_code_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertScanInSchema = createInsertSchema(scanInTable).omit({ id: true, createdAt: true, completedAt: true });
export type InsertScanIn = z.infer<typeof insertScanInSchema>;
export type ScanIn = typeof scanInTable.$inferSelect;

export const scanItemsTable = pgTable("scan_items", {
  id: serial("id").primaryKey(),
  serialNumber: text("serial_number").notNull().unique(),
  scanInId: integer("scan_in_id").references(() => scanInTable.id),
  scanOutId: integer("scan_out_id").references(() => scanOutTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScanItemSchema = createInsertSchema(scanItemsTable).omit({ id: true, createdAt: true });
export type InsertScanItem = z.infer<typeof insertScanItemSchema>;
export type ScanItem = typeof scanItemsTable.$inferSelect;

export const scanOutTable = pgTable("scan_out", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScanOutSchema = createInsertSchema(scanOutTable).omit({ id: true, createdAt: true });
export type InsertScanOut = z.infer<typeof insertScanOutSchema>;
export type ScanOut = typeof scanOutTable.$inferSelect;
