import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /api/kas/transaksi — daftar transaksi (filter: tipe, search) ─────
router.get("/kas/transaksi", async (req, res): Promise<void> => {
  const tipe   = typeof req.query.tipe   === "string" && ["masuk", "keluar"].includes(req.query.tipe as string) ? req.query.tipe as string : null;
  const search = typeof req.query.search === "string" ? (req.query.search as string).trim() : "";

  const args: any[] = [];
  const conds: string[] = [];
  if (tipe)   { args.push(tipe); conds.push(`k.tipe = $${args.length}`); }
  if (search) { args.push(`%${search}%`); conds.push(`(k.keterangan ILIKE $${args.length} OR u.username ILIKE $${args.length})`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";

  const result = await pool.query(
    `SELECT k.id, k.tipe, k.metode, k.jumlah, k.keterangan,
            (k.bukti_image IS NOT NULL) AS has_bukti,
            k.user_id, u.username, k.created_at
     FROM kas_transaksi k
     JOIN users u ON u.id = k.user_id
     ${where}
     ORDER BY k.created_at DESC, k.id DESC
     LIMIT 1000`,
    args,
  );

  res.json(result.rows.map(r => ({
    id: r.id,
    tipe: r.tipe,
    metode: r.metode,
    jumlah: Number(r.jumlah),
    keterangan: r.keterangan ?? null,
    hasBukti: r.has_bukti,
    userId: r.user_id,
    userName: r.username,
    createdAt: new Date(r.created_at).toISOString(),
  })));
});

// ─── GET /api/kas/transaksi/:id — detail (termasuk foto bukti) ────────────
router.get("/kas/transaksi/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const result = await pool.query(
    `SELECT k.id, k.tipe, k.metode, k.jumlah, k.keterangan, k.bukti_image,
            k.user_id, u.username, k.created_at
     FROM kas_transaksi k JOIN users u ON u.id = k.user_id WHERE k.id = $1`,
    [id],
  );
  if (result.rowCount === 0) { res.status(404).json({ error: "Transaksi tidak ditemukan" }); return; }
  const r = result.rows[0];
  res.json({
    id: r.id, tipe: r.tipe, metode: r.metode, jumlah: Number(r.jumlah),
    keterangan: r.keterangan ?? null, buktiImage: r.bukti_image ?? null,
    userId: r.user_id, userName: r.username,
    createdAt: new Date(r.created_at).toISOString(),
  });
});

// ─── GET /api/kas/summary — total masuk, keluar, saldo ────────────────────
router.get("/kas/summary", async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'masuk'), 0)::bigint  AS total_masuk,
       COALESCE(SUM(jumlah) FILTER (WHERE tipe = 'keluar'), 0)::bigint AS total_keluar,
       COUNT(*)::int AS jumlah_transaksi
     FROM kas_transaksi`,
  );
  const r = result.rows[0];
  const totalMasuk   = Number(r.total_masuk);
  const totalKeluar  = Number(r.total_keluar);
  res.json({ totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar, jumlahTransaksi: r.jumlah_transaksi });
});

// ─── POST /api/kas/transaksi — buat transaksi manual / OCR ────────────────
router.post("/kas/transaksi", async (req, res): Promise<void> => {
  const { tipe, metode, jumlah, keterangan, buktiImage, userId } = req.body ?? {};

  if (!["masuk", "keluar"].includes(tipe)) { res.status(400).json({ error: "Tipe harus 'masuk' atau 'keluar'" }); return; }
  if (!["manual", "ocr"].includes(metode)) { res.status(400).json({ error: "Metode harus 'manual' atau 'ocr'" }); return; }
  const amt = Number(jumlah);
  if (!Number.isFinite(amt) || amt <= 0)        { res.status(400).json({ error: "Nominal harus angka positif" }); return; }
  if (!Number.isInteger(userId))                { res.status(400).json({ error: "userId tidak valid" }); return; }
  if (buktiImage && typeof buktiImage === "string" && buktiImage.length > 8_000_000) {
    res.status(400).json({ error: "Foto bukti terlalu besar" }); return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO kas_transaksi (tipe, metode, jumlah, keterangan, bukti_image, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tipe, metode, Math.round(amt), (typeof keterangan === "string" ? keterangan.trim() : null) || null,
       (typeof buktiImage === "string" ? buktiImage : null), userId],
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, "Kas: gagal menyimpan transaksi");
    res.status(500).json({ error: "Gagal menyimpan transaksi" });
  }
});

// ─── DELETE /api/kas/transaksi/:id ────────────────────────────────────────
router.delete("/kas/transaksi/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const result = await pool.query("DELETE FROM kas_transaksi WHERE id = $1 RETURNING id", [id]);
  if (result.rowCount && result.rowCount > 0) { res.sendStatus(204); return; }
  res.status(404).json({ error: "Transaksi tidak ditemukan" });
});

export default router;
