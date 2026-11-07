import { Router } from "express";
import type { IRouter } from "express";
import { db, pool, scanInTable, scanItemsTable, scanOutTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireActor, requireMaster } from "../lib/request-auth";
import {
  ListHistoryQueryParams,
  ListHistoryResponse,
  DeleteHistoryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/history", async (req, res): Promise<void> => {
  if (!(await requireActor(req, res))) return;
  const params = ListHistoryQueryParams.safeParse(req.query);
  const filterType       = params.success ? params.data.type       : undefined;
  const filterMaterialId = params.success && params.data.materialId ? Number(params.data.materialId) : null;
  const filterUserId     = params.success && params.data.userId     ? Number(params.data.userId)     : null;
  const filterFrom       = params.success ? params.data.from : undefined;
  const filterTo         = params.success ? params.data.to   : undefined;
  const filterStockOnly  = params.success ? params.data.stockOnly === true : false;

  // ─── build query fragments ────────────────────────────────────────────────

  const buildScanInQuery = () => {
    const args: any[] = [];
    const conds: string[] = ["si.status = 'completed'"];
    if (filterMaterialId) { args.push(filterMaterialId); conds.push(`si.material_id = $${args.length}`); }
    if (filterUserId)     { args.push(filterUserId);     conds.push(`si.user_id = $${args.length}`); }
    if (filterFrom)       { args.push(filterFrom);       conds.push(`si.created_at >= $${args.length}::date`); }
    if (filterTo)         { args.push(filterTo);         conds.push(`si.created_at <= $${args.length}::date + interval '1 day' - interval '1 second'`); }
    const where = conds.join(" AND ");
    // stockOnly: only join scan_items that have NOT been scanned out yet
    const itemJoinCond = filterStockOnly
      ? "items.scan_in_id = si.id AND items.scan_out_id IS NULL"
      : "items.scan_in_id = si.id";
    const having = filterStockOnly ? "HAVING COUNT(items.id) > 0" : "";
    return pool.query(
      `SELECT
         si.id, si.box_label, si.created_at,
         si.material_id, m.code AS material_code, m.name AS material_name,
         si.user_id, u.username,
         array_remove(array_agg(items.serial_number ORDER BY items.id), NULL) AS serial_numbers
       FROM scan_in si
       JOIN materials m ON m.id = si.material_id
       JOIN users     u ON u.id = si.user_id
       LEFT JOIN scan_items items ON ${itemJoinCond}
       WHERE ${where}
       GROUP BY si.id, si.box_label, si.created_at, si.material_id, m.code, m.name, si.user_id, u.username
       ${having}`,
      args,
    );
  };

  const buildScanOutQuery = () => {
    // Material ditentukan PER ITEM (scan_items -> scan_in -> materials), bukan dari box
    // "pertama" saja: satu sesi dispatch bisa mencampur beberapa box/material. Kalau hanya
    // material pertama yang dipakai, sesi campuran salah label DAN hilang saat difilter per material.
    const args: any[] = [];
    const conds: string[] = [];
    if (filterMaterialId) { args.push(filterMaterialId); conds.push(`si.material_id = $${args.length}`); }
    if (filterUserId) { args.push(filterUserId); conds.push(`so.user_id = $${args.length}`); }
    if (filterFrom)   { args.push(filterFrom);   conds.push(`so.created_at >= $${args.length}::date`); }
    if (filterTo)     { args.push(filterTo);     conds.push(`so.created_at <= $${args.length}::date + interval '1 day' - interval '1 second'`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return pool.query(
      `SELECT
         so.id, so.created_at, so.user_id, u.username,
         MIN(si.material_id) AS material_id,
         string_agg(DISTINCT m.code, ' + ') AS material_code,
         string_agg(DISTINCT m.name, ' + ') AS material_name,
         string_agg(DISTINCT si.box_label, ' + ') AS box_label,
         array_remove(array_agg(items.serial_number ORDER BY items.id), NULL) AS serial_numbers
       FROM scan_out so
       JOIN users      u ON u.id = so.user_id
       JOIN scan_items items ON items.scan_out_id = so.id
       LEFT JOIN scan_in  si ON si.id = items.scan_in_id
       LEFT JOIN materials m ON m.id  = si.material_id
       ${where}
       GROUP BY so.id, so.created_at, so.user_id, u.username
       HAVING COUNT(items.id) > 0`,
      args,
    );
  };

  const buildNonScanMasukQuery = () => {
    const args: any[] = [];
    const conds: string[] = [];
    if (filterMaterialId) { args.push(filterMaterialId); conds.push(`nm.material_id = $${args.length}`); }
    if (filterUserId)     { args.push(filterUserId);     conds.push(`nm.user_id = $${args.length}`); }
    if (filterFrom)       { args.push(filterFrom);       conds.push(`nm.created_at >= $${args.length}::date`); }
    if (filterTo)         { args.push(filterTo);         conds.push(`nm.created_at <= $${args.length}::date + interval '1 day' - interval '1 second'`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return pool.query(
      `SELECT nm.id, nm.created_at, nm.material_id, m.code AS material_code, m.name AS material_name,
              nm.user_id, u.username, nm.jumlah, nm.satuan
       FROM non_scan_masuk nm
       JOIN materials m ON m.id = nm.material_id
       JOIN users     u ON u.id = nm.user_id
       ${where}`,
      args,
    );
  };

  const buildNonScanKeluarQuery = () => {
    const args: any[] = [];
    const conds: string[] = [];
    if (filterMaterialId) { args.push(filterMaterialId); conds.push(`nk.material_id = $${args.length}`); }
    if (filterUserId)     { args.push(filterUserId);     conds.push(`nk.user_id = $${args.length}`); }
    if (filterFrom)       { args.push(filterFrom);       conds.push(`nk.created_at >= $${args.length}::date`); }
    if (filterTo)         { args.push(filterTo);         conds.push(`nk.created_at <= $${args.length}::date + interval '1 day' - interval '1 second'`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return pool.query(
      `SELECT nk.id, nk.created_at, nk.material_id, m.code AS material_code, m.name AS material_name,
              nk.user_id, u.username, nk.jumlah,
              COALESCE(
                (SELECT satuan FROM non_scan_masuk nm2
                 WHERE nm2.material_id = nk.material_id AND nm2.created_at <= nk.created_at
                 ORDER BY nm2.created_at DESC LIMIT 1),
                (SELECT satuan FROM non_scan_masuk nm3
                 WHERE nm3.material_id = nk.material_id
                 ORDER BY nm3.created_at ASC LIMIT 1)
              ) AS satuan
       FROM non_scan_keluar nk
       JOIN materials m ON m.id = nk.material_id
       JOIN users     u ON u.id = nk.user_id
       ${where}`,
      args,
    );
  };

  // ─── run queries in parallel based on type filter ────────────────────────
  // When stockOnly=true we only want scan-in records that still have remaining
  // items in the warehouse.  Scan-out and non-scan records are irrelevant for
  // a "remaining stock" view — including them would add already-gone SNs to
  // the result (and to exports), inflating the count incorrectly.
  const doIn  = (!filterType || filterType === "in");
  const doOut = !filterStockOnly && (!filterType || filterType === "out");

  const [siResult, soResult, nsmResult, nskResult] = await Promise.all([
    doIn  ? buildScanInQuery()                                           : Promise.resolve({ rows: [] }),
    doOut ? buildScanOutQuery()                                          : Promise.resolve({ rows: [] }),
    doIn  && !filterStockOnly ? buildNonScanMasukQuery()                 : Promise.resolve({ rows: [] }),
    doOut && !filterStockOnly ? buildNonScanKeluarQuery()                : Promise.resolve({ rows: [] }),
  ]);

  const records: any[] = [];

  for (const r of siResult.rows) {
    records.push({
      id: r.id,
      type: "in",
      source: "scan",
      materialId:   r.material_id,
      materialCode: r.material_code ?? null,
      materialName: r.material_name ?? "Unknown",
      boxLabel:     r.box_label,
      userId:       r.user_id,
      userName:     r.username ?? "Unknown",
      serialNumbers: r.serial_numbers ?? [],
      count:         (r.serial_numbers ?? []).length,
      createdAt:     new Date(r.created_at).toISOString(),
    });
  }

  for (const r of soResult.rows) {
    records.push({
      id: r.id,
      type: "out",
      source: "scan",
      materialId:   r.material_id ?? null,
      materialCode: r.material_code ?? null,
      materialName: r.material_name ?? null,
      boxLabel:     r.box_label ?? null,
      userId:       r.user_id,
      userName:     r.username ?? "Unknown",
      serialNumbers: r.serial_numbers ?? [],
      count:         (r.serial_numbers ?? []).length,
      createdAt:     new Date(r.created_at).toISOString(),
    });
  }

  for (const r of nsmResult.rows) {
    records.push({
      id: r.id + 1000000,
      type: "in",
      source: "non-scan",
      materialId:   r.material_id,
      materialCode: r.material_code ?? null,
      materialName: r.material_name ?? "Unknown",
      boxLabel:     null,
      userId:       r.user_id,
      userName:     r.username ?? "Unknown",
      serialNumbers: [],
      count:         r.jumlah,
      satuan:        r.satuan,
      createdAt:     new Date(r.created_at).toISOString(),
    });
  }

  for (const r of nskResult.rows) {
    records.push({
      id: r.id + 2000000,
      type: "out",
      source: "non-scan",
      materialId:   r.material_id,
      materialCode: r.material_code ?? null,
      materialName: r.material_name ?? "Unknown",
      boxLabel:     null,
      userId:       r.user_id,
      userName:     r.username ?? "Unknown",
      serialNumbers: [],
      count:         r.jumlah,
      satuan:        r.satuan ?? "",
      createdAt:     new Date(r.created_at).toISOString(),
    });
  }

  records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(ListHistoryResponse.parse(records));
});

router.delete("/history/:id", async (req, res): Promise<void> => {
  if (!(await requireMaster(req, res))) return;
  const params = DeleteHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const id = params.data.id;

  if (id > 2000000) {
    const realId = id - 2000000;
    const result = await pool.query("DELETE FROM non_scan_keluar WHERE id = $1 RETURNING id", [realId]);
    if (result.rowCount && result.rowCount > 0) { res.sendStatus(204); return; }
  }

  if (id > 1000000) {
    const realId = id - 1000000;
    const result = await pool.query("DELETE FROM non_scan_masuk WHERE id = $1 RETURNING id", [realId]);
    if (result.rowCount && result.rowCount > 0) { res.sendStatus(204); return; }
  }

  // Hapus sesi scan masuk: SN yang SUDAH discan-out tidak boleh ikut hilang —
  // item dispatch hanya di-LEPAS (scan_in_id = NULL) supaya riwayat keluar tetap utuh;
  // hanya item yang belum pernah keluar yang dihapus. Semua dalam satu transaksi.
  const deletedScanIn = await db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: scanInTable.id }).from(scanInTable).where(eq(scanInTable.id, id));
    if (!exists) return false;
    await tx.update(scanItemsTable).set({ scanInId: null })
      .where(and(eq(scanItemsTable.scanInId, id), sql`${scanItemsTable.scanOutId} is not null`));
    await tx.delete(scanItemsTable)
      .where(and(eq(scanItemsTable.scanInId, id), sql`${scanItemsTable.scanOutId} is null`));
    await tx.delete(scanInTable).where(eq(scanInTable.id, id));
    return true;
  });
  if (deletedScanIn) { res.sendStatus(204); return; }

  // Hapus sesi scan keluar: item (SN) tetap hidup, hanya di-unlink.
  const deletedScanOut = await db.transaction(async (tx) => {
    const [exists] = await tx.select({ id: scanOutTable.id }).from(scanOutTable).where(eq(scanOutTable.id, id));
    if (!exists) return false;
    await tx.update(scanItemsTable).set({ scanOutId: null }).where(eq(scanItemsTable.scanOutId, id));
    await tx.delete(scanOutTable).where(eq(scanOutTable.id, id));
    return true;
  });
  if (deletedScanOut) { res.sendStatus(204); return; }

  res.status(404).json({ error: "History record not found" });
});

export default router;
