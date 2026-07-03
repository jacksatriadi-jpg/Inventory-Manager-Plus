import { Router } from "express";
import type { IRouter } from "express";
import { pool } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetMaterialStatsQueryParams,
  GetMaterialStatsResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const [scanInRes, nonScanInRes, scanOutRes, nonScanOutRes, matRes, userRes] = await Promise.all([
    pool.query(`
      SELECT COUNT(si_items.id)::int AS total
      FROM scan_in si
      LEFT JOIN scan_items si_items ON si_items.scan_in_id = si.id
      WHERE si.status = 'completed'
    `),
    pool.query(`SELECT COALESCE(SUM(jumlah), 0)::int AS total FROM non_scan_masuk`),
    pool.query(`SELECT COUNT(id)::int AS total FROM scan_items WHERE scan_out_id IS NOT NULL`),
    pool.query(`SELECT COALESCE(SUM(jumlah), 0)::int AS total FROM non_scan_keluar`),
    pool.query(`SELECT COUNT(*)::int AS total FROM materials`),
    pool.query(`SELECT COUNT(*)::int AS total FROM users`),
  ]);

  const totalIn  = scanInRes.rows[0].total  + nonScanInRes.rows[0].total;
  const totalOut = scanOutRes.rows[0].total + nonScanOutRes.rows[0].total;

  res.json(GetDashboardSummaryResponse.parse({
    totalMaterialIn:  totalIn,
    totalMaterialOut: totalOut,
    totalStock:       totalIn - totalOut,
    totalMaterials:   matRes.rows[0].total,
    totalUsers:       userRes.rows[0].total,
  }));
});

router.get("/dashboard/material-stats", async (req, res): Promise<void> => {
  const params = GetMaterialStatsQueryParams.safeParse(req.query);
  const filterMaterialId = params.success && params.data.materialId ? Number(params.data.materialId) : null;

  const result = await pool.query(
    `SELECT
       m.id,
       m.code,
       m.name,
       COALESCE(si_stats.item_count,      0)::int AS total_scan_in,
       COALESCE(nsm_stats.total,          0)::int AS total_non_scan_in,
       COALESCE(so_stats.out_count,       0)::int AS total_scan_out,
       COALESCE(nsk_stats.total,          0)::int AS total_non_scan_out
     FROM materials m
     LEFT JOIN (
       SELECT si.material_id, COUNT(items.id) AS item_count
       FROM scan_in si
       JOIN scan_items items ON items.scan_in_id = si.id
       WHERE si.status = 'completed'
       GROUP BY si.material_id
     ) si_stats  ON si_stats.material_id  = m.id
     LEFT JOIN (
       SELECT material_id, SUM(jumlah) AS total FROM non_scan_masuk GROUP BY material_id
     ) nsm_stats ON nsm_stats.material_id = m.id
     LEFT JOIN (
       SELECT si2.material_id, COUNT(items2.id) AS out_count
       FROM scan_items items2
       JOIN scan_in si2 ON items2.scan_in_id = si2.id
       WHERE items2.scan_out_id IS NOT NULL
       GROUP BY si2.material_id
     ) so_stats  ON so_stats.material_id  = m.id
     LEFT JOIN (
       SELECT material_id, SUM(jumlah) AS total FROM non_scan_keluar GROUP BY material_id
     ) nsk_stats ON nsk_stats.material_id = m.id
     WHERE ($1::int IS NULL OR m.id = $1::int)
     ORDER BY m.name`,
    [filterMaterialId],
  );

  const stats = result.rows.map((row) => ({
    materialId:   row.id,
    materialCode: row.code,
    materialName: row.name,
    totalIn:      row.total_scan_in    + row.total_non_scan_in,
    totalOut:     row.total_scan_out   + row.total_non_scan_out,
    currentStock: (row.total_scan_in   + row.total_non_scan_in)
                - (row.total_scan_out  + row.total_non_scan_out),
  }));

  res.json(GetMaterialStatsResponse.parse(stats));
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = params.success && params.data.limit ? Number(params.data.limit) : 20;

  const [siRes, soRes, nsmRes, nskRes] = await Promise.all([
    pool.query(
      `SELECT si.id, si.box_label, si.created_at, m.name AS material_name,
              u.username, COUNT(items.id)::int AS item_count
       FROM scan_in si
       JOIN materials m ON m.id = si.material_id
       JOIN users     u ON u.id = si.user_id
       LEFT JOIN scan_items items ON items.scan_in_id = si.id
       WHERE si.status = 'completed'
       GROUP BY si.id, si.box_label, si.created_at, m.name, u.username
       ORDER BY si.created_at DESC LIMIT $1`,
      [limit],
    ),
    pool.query(
      `SELECT so.id, so.created_at, u.username,
              COUNT(items.id)::int AS item_count,
              MIN(si.box_label)    AS box_label,
              MIN(m.name)          AS material_name
       FROM scan_out so
       JOIN users      u ON u.id = so.user_id
       JOIN scan_items items ON items.scan_out_id = so.id
       LEFT JOIN scan_in  si ON si.id = items.scan_in_id
       LEFT JOIN materials m ON m.id  = si.material_id
       GROUP BY so.id, so.created_at, u.username
       HAVING COUNT(items.id) > 0
       ORDER BY so.created_at DESC LIMIT $1`,
      [limit],
    ),
    pool.query(
      `SELECT nm.id, nm.created_at, nm.jumlah, nm.satuan,
              m.name AS material_name, u.username
       FROM non_scan_masuk nm
       JOIN materials m ON m.id = nm.material_id
       JOIN users     u ON u.id = nm.user_id
       ORDER BY nm.created_at DESC LIMIT $1`,
      [limit],
    ),
    pool.query(
      `SELECT nk.id, nk.created_at, nk.jumlah,
              m.name AS material_name, u.username,
              (SELECT satuan FROM non_scan_masuk
               WHERE material_id = nk.material_id ORDER BY id DESC LIMIT 1) AS satuan
       FROM non_scan_keluar nk
       JOIN materials m ON m.id = nk.material_id
       JOIN users     u ON u.id = nk.user_id
       ORDER BY nk.created_at DESC LIMIT $1`,
      [limit],
    ),
  ]);

  const activities: any[] = [
    ...siRes.rows.map((r) => ({
      id: r.id, type: "in" as const, source: "scan" as const,
      materialName: r.material_name, boxLabel: r.box_label,
      userName: r.username, count: r.item_count,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    ...soRes.rows.map((r) => ({
      id: r.id, type: "out" as const, source: "scan" as const,
      materialName: r.material_name ?? null, boxLabel: r.box_label ?? null,
      userName: r.username, count: r.item_count,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    ...nsmRes.rows.map((r) => ({
      id: r.id + 1000000, type: "in" as const, source: "non-scan" as const,
      materialName: r.material_name, boxLabel: null,
      userName: r.username, count: r.jumlah, satuan: r.satuan,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    ...nskRes.rows.map((r) => ({
      id: r.id + 2000000, type: "out" as const, source: "non-scan" as const,
      materialName: r.material_name, boxLabel: null,
      userName: r.username, count: r.jumlah, satuan: r.satuan ?? "",
      createdAt: new Date(r.created_at).toISOString(),
    })),
  ];

  activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(GetRecentActivityResponse.parse(activities.slice(0, limit)));
});

export default router;
