import { Router } from "express";
import type { IRouter } from "express";
import { db, pool, scanInTable, scanItemsTable, scanOutTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListHistoryQueryParams,
  ListHistoryResponse,
  DeleteHistoryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/history", async (req, res): Promise<void> => {
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
    const args: any[] = [];
    const conds: string[] = [];
    if (filterUserId) { args.push(filterUserId); conds.push(`so.user_id = $${args.length}`); }
    if (filterFrom)   { args.push(filterFrom);   conds.push(`so.created_at >= $${args.length}::date`); }
    if (filterTo)     { args.push(filterTo);     conds.push(`so.created_at <= $${args.length}::date + interval '1 day' - interval '1 second'`); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return pool.query(
      `WITH so_first AS (
         SELECT DISTINCT ON (scan_out_id) scan_out_id, scan_in_id
         FROM scan_items WHERE scan_out_id IS NOT NULL
         ORDER BY scan_out_id, id
       )
       SELECT
         so.id, so.created_at, so.user_id, u.username,
         si.material_id, m.code AS material_code, m.name AS material_name, si.box_label,
         array_remove(array_agg(items.serial_number ORDER BY items.id), NULL) AS serial_numbers
       FROM scan_out so
       JOIN users      u ON u.id = so.user_id
       JOIN scan_items items ON items.scan_out_id = so.id
       LEFT JOIN so_first sf ON sf.scan_out_id = so.id
       LEFT JOIN scan_in  si ON si.id = sf.scan_in_id
       LEFT JOIN materials m ON m.id  = si.material_id
       ${where}
       GROUP BY so.id, so.created_at, so.user_id, u.username, si.material_id, m.code, m.name, si.box_label
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
              (SELECT satuan FROM non_scan_masuk
               WHERE material_id = nk.material_id ORDER BY id DESC LIMIT 1) AS satuan
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
    // apply materialId filter (join-side, not WHERE-side for scan_out)
    if (filterMaterialId && r.material_id !== filterMaterialId) continue;
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

  const [siRecord] = await db.select().from(scanInTable).where(eq(scanInTable.id, id));
  if (siRecord) {
    await db.delete(scanItemsTable).where(eq(scanItemsTable.scanInId, id));
    await db.delete(scanInTable).where(eq(scanInTable.id, id));
    res.sendStatus(204);
    return;
  }

  const result = await pool.query(
    "DELETE FROM scan_out WHERE id = $1 RETURNING id", [id]
  );
  if (result.rowCount && result.rowCount > 0) {
    await pool.query("UPDATE scan_items SET scan_out_id = NULL WHERE scan_out_id = $1", [id]);
    res.sendStatus(204);
    return;
  }

  res.status(404).json({ error: "History record not found" });
});

export default router;
