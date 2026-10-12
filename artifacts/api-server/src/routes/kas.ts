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

// ═══ LEMBUR: karyawan ═══════════════════════════════════════════════════
router.get("/kas/lembur/karyawan", async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT id, nama FROM lembur_karyawan ORDER BY id`);
  res.json(result.rows);
});

router.post("/kas/lembur/karyawan", async (req, res): Promise<void> => {
  const nama = typeof req.body?.nama === "string" ? req.body.nama.trim() : "";
  if (!nama) { res.status(400).json({ error: "Nama karyawan wajib diisi" }); return; }
  const result = await pool.query("INSERT INTO lembur_karyawan (nama) VALUES ($1) RETURNING id, nama", [nama]);
  res.status(201).json(result.rows[0]);
});

router.put("/kas/lembur/karyawan/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const nama = typeof req.body?.nama === "string" ? req.body.nama.trim() : "";
  if (!Number.isInteger(id) || !nama) { res.status(400).json({ error: "Data tidak valid" }); return; }
  const result = await pool.query("UPDATE lembur_karyawan SET nama = $1 WHERE id = $2 RETURNING id, nama", [nama, id]);
  if (result.rowCount === 0) { res.status(404).json({ error: "Karyawan tidak ditemukan" }); return; }
  res.json(result.rows[0]);
});

router.delete("/kas/lembur/karyawan/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  try {
    const result = await pool.query("DELETE FROM lembur_karyawan WHERE id = $1 RETURNING id", [id]);
    if (result.rowCount && result.rowCount > 0) { res.sendStatus(204); return; }
    res.status(404).json({ error: "Karyawan tidak ditemukan" });
  } catch {
    res.status(400).json({ error: "Tidak bisa dihapus — masih punya riwayat absensi lembur" });
  }
});

// ═══ LEMBUR: absensi ════════════════════════════════════════════════════
router.get("/kas/lembur/absensi", async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to   = typeof req.query.to   === "string" ? req.query.to   : null;
  const args: any[] = [];
  const conds: string[] = [];
  if (from) { args.push(from); conds.push(`la.tanggal >= $${args.length}`); }
  if (to)   { args.push(to);   conds.push(`la.tanggal <= $${args.length}`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const result = await pool.query(
    `SELECT la.id, la.karyawan_id, lk.nama AS karyawan, la.tanggal, la.jenis,
            la.fee, la.kas_transaksi_id, la.created_at
     FROM lembur_absensi la
     JOIN lembur_karyawan lk ON lk.id = la.karyawan_id
     ${where}
     ORDER BY la.tanggal DESC, lk.nama
     LIMIT 1000`,
    args,
  );
  res.json(result.rows.map(r => ({
    id: r.id, karyawanId: r.karyawan_id, karyawan: r.nama, tanggal: r.tanggal,
    jenis: r.jenis, fee: r.fee === null ? null : Number(r.fee),
    kasTransaksiId: r.kas_transaksi_id,
    createdAt: new Date(r.created_at).toISOString(),
  })));
});

router.post("/kas/lembur/absensi", async (req, res): Promise<void> => {
  const { karyawanId, tanggal, jenis } = req.body ?? {};
  if (!Number.isInteger(karyawanId)) { res.status(400).json({ error: "Karyawan tidak valid" }); return; }
  if (typeof tanggal !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) { res.status(400).json({ error: "Tanggal tidak valid (YYYY-MM-DD)" }); return; }
  if (!["gps", "wajah"].includes(jenis)) { res.status(400).json({ error: "Jenis absensi harus 'gps' atau 'wajah'" }); return; }
  try {
    const result = await pool.query(
      `INSERT INTO lembur_absensi (karyawan_id, tanggal, jenis) VALUES ($1, $2, $3)
       ON CONFLICT (karyawan_id, tanggal) DO NOTHING RETURNING id`,
      [karyawanId, tanggal, jenis],
    );
    if (result.rowCount === 0) { res.status(409).json({ error: "Karyawan ini sudah tercatat absen pada tanggal tersebut" }); return; }
    res.status(201).json({ id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, "Lembur: gagal mencatat absensi");
    res.status(500).json({ error: "Gagal mencatat absensi" });
  }
});

// Input/ubah fee → otomatis jadi kas keluar (dibuat/di-update)
router.put("/kas/lembur/absensi/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const feeRaw = req.body?.fee;
  const fee = feeRaw === null || feeRaw === "" || feeRaw === undefined ? null : Number(feeRaw);
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) { res.status(400).json({ error: "Fee tidak valid" }); return; }

  const cur = await pool.query(
    `SELECT la.*, lk.nama AS karyawan FROM lembur_absensi la
     JOIN lembur_karyawan lk ON lk.id = la.karyawan_id WHERE la.id = $1`, [id]);
  if (cur.rowCount === 0) { res.status(404).json({ error: "Absensi tidak ditemukan" }); return; }
  const row = cur.rows[0];

  try {
    if (fee === null) {
      // fee dihapus → hapus kas keluar terkait
      if (row.kas_transaksi_id) await pool.query("DELETE FROM kas_transaksi WHERE id = $1", [row.kas_transaksi_id]);
      await pool.query("UPDATE lembur_absensi SET fee = NULL, kas_transaksi_id = NULL WHERE id = $1", [id]);
      res.json({ id, fee: null }); return;
    }
    const ket = `Fee lembur ${row.nama} (${row.tanggal})`;
    if (row.kas_transaksi_id) {
      await pool.query("UPDATE kas_transaksi SET jumlah = $1, keterangan = $2 WHERE id = $3", [Math.round(fee), ket, row.kas_transaksi_id]);
    } else {
      const ins = await pool.query(
        `INSERT INTO kas_transaksi (tipe, metode, jumlah, keterangan, user_id)
         VALUES ('keluar', 'manual', $1, $2, $3) RETURNING id`,
        [Math.round(fee), ket, Number.isInteger(Number(req.body?.userId)) ? Number(req.body.userId) : 1]);
      await pool.query("UPDATE lembur_absensi SET fee = $1, kas_transaksi_id = $2 WHERE id = $3", [Math.round(fee), ins.rows[0].id, id]);
    }
    res.json({ id, fee: Math.round(fee) });
  } catch (err) {
    logger.error({ err }, "Lembur: gagal menyimpan fee");
    res.status(500).json({ error: "Gagal menyimpan fee" });
  }
});

router.delete("/kas/lembur/absensi/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }
  const cur = await pool.query("SELECT kas_transaksi_id FROM lembur_absensi WHERE id = $1", [id]);
  if (cur.rowCount === 0) { res.status(404).json({ error: "Absensi tidak ditemukan" }); return; }
  if (cur.rows[0].kas_transaksi_id) await pool.query("DELETE FROM kas_transaksi WHERE id = $1", [cur.rows[0].kas_transaksi_id]);
  await pool.query("DELETE FROM lembur_absensi WHERE id = $1", [id]);
  res.sendStatus(204);
});

export default router;
