import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { parseToken } from "./auth";

// Guard akses utk modul Scan Material / Riwayat (sebelumnya endpoint scan-in,
// scan-out, dan history sama sekali tidak membutuhkan login).
// Pola token sama dengan modul Retur: header Bearer -> parseToken -> lookup users.
export interface ScanActor { id: number; username: string; role: string }

async function loadActor(req: Request, res: Response): Promise<ScanActor | null> {
  const auth = req.headers.authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return null; }
  const parsed = parseToken(token);
  if (!parsed) { res.status(401).json({ error: "Invalid token" }); return null; }
  const result = await pool.query("SELECT id, username, role FROM users WHERE id = $1", [parsed.userId]);
  if (result.rows.length === 0) { res.status(401).json({ error: "User tidak ditemukan" }); return null; }
  const row = result.rows[0] as { id: number; username: string; role: string };
  return { id: Number(row.id), username: String(row.username), role: String(row.role) };
}

// Membaca (list/detail): semua akun login, termasuk guest (halaman Riwayat read-only utk guest).
export async function requireActor(req: Request, res: Response): Promise<ScanActor | null> {
  return await loadActor(req, res);
}

// Menulis (buat/ubah/hapus sesi & item scan): hanya role user/master.
export async function requireScanWrite(req: Request, res: Response): Promise<ScanActor | null> {
  const actor = await loadActor(req, res);
  if (!actor) return null;
  if (actor.role === "guest") { res.status(403).json({ error: "Akun tamu tidak dapat mengubah data scan" }); return null; }
  return actor;
}

// Hapus record riwayat: master saja (sama dengan gerbang tombol Aksi di UI riwayat).
export async function requireMaster(req: Request, res: Response): Promise<ScanActor | null> {
  const actor = await loadActor(req, res);
  if (!actor) return null;
  if (actor.role !== "master") { res.status(403).json({ error: "Hanya master yang dapat menghapus riwayat" }); return null; }
  return actor;
}
