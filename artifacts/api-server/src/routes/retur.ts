import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { parseToken } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  getReturAuthUrl,
  exchangeReturCodeAndSave,
  disconnectReturDrive,
  getReturDriveStatus,
  uploadReturDataUrl,
  downloadReturFile,
  deleteReturFile,
  ensureReturFolder,
  ensureChildFolder,
  sanitizeFolderName,
} from "../lib/retur-drive";

const router: IRouter = Router();

// ─── Modul Retur Material (TUG10 + ceklist 2 tahap) ─────────────────────────────
// Retur user  : role master ATAU menuAccess memuat "/retur" / "retur:gudang"
// Gudang      : role master ATAU menuAccess memuat "retur:gudang"
// role guest selalu ditolak.

const DRIVE_NOT_CONNECTED_MSG = "Akun Google Drive Retur belum terhubung. Hubungkan akun Drive di tab Pengaturan.";

interface ReturActor {
  id: number;
  username: string;
  role: string;
  menuAccess: string[];
}

interface UserRow {
  id: number;
  username: string;
  role: string;
  menu_access: string[] | null;
}

async function loadActor(req: Request, res: Response): Promise<ReturActor | null> {
  const auth = req.headers.authorization;
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const parsed = parseToken(token);
  if (!parsed) {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
  const result = await pool.query(
    "SELECT id, username, role, menu_access FROM users WHERE id = $1",
    [parsed.userId],
  );
  if (result.rows.length === 0) {
    res.status(401).json({ error: "User tidak ditemukan" });
    return null;
  }
  const row = result.rows[0] as UserRow; // pg melonggarkan tipe rows; kolom sesuai SELECT
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    menuAccess: Array.isArray(row.menu_access) ? row.menu_access : [],
  };
}

// null = respons sudah dikirim helper
async function requireReturUser(req: Request, res: Response): Promise<ReturActor | null> {
  const actor = await loadActor(req, res);
  if (!actor) return null;
  if (actor.role === "guest") { res.status(403).json({ error: "Akses ditolak" }); return null; }
  const isReturUser =
    actor.role === "master" ||
    actor.menuAccess.includes("/retur") ||
    actor.menuAccess.includes("retur:gudang");
  if (!isReturUser) {
    res.status(403).json({ error: "Akun Anda tidak memiliki akses modul Retur" });
    return null;
  }
  return actor;
}

async function requireGudang(req: Request, res: Response): Promise<ReturActor | null> {
  const actor = await loadActor(req, res);
  if (!actor) return null;
  if (actor.role === "guest") { res.status(403).json({ error: "Akses ditolak" }); return null; }
  if (actor.role !== "master" && !actor.menuAccess.includes("retur:gudang")) {
    res.status(403).json({ error: "Hanya petugas gudang retur yang dapat melakukan ini" });
    return null;
  }
  return actor;
}

async function requireReturMaster(req: Request, res: Response): Promise<ReturActor | null> {
  const actor = await loadActor(req, res);
  if (!actor) return null;
  if (actor.role !== "master") {
    res.status(403).json({ error: "Hanya master yang dapat melakukan ini" });
    return null;
  }
  return actor;
}

function bodyObject(req: Request): Record<string, unknown> {
  const body: Record<string, unknown> =
    req.body && typeof req.body === "object" ? req.body : {};
  return body;
}

// ─── Validasi ───────────────────────────────────────────────────────────────────

function isImageDataUrl(v: unknown): v is string {
  return typeof v === "string" && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(v);
}

function extFromDataUrl(dataUrl: string): string {
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const sub = (mime.split("/")[1] || "jpeg").replace(/[^a-z0-9]/gi, "");
  return sub === "jpeg" ? "jpg" : sub;
}

export const DEFAULT_RESULT_OPTIONS = ["Lengkap", "Hilang", "Rusak"];
const HASIL_CODE_TO_LABEL: Record<string, string> = { ada: "Lengkap", hilang: "Hilang", rusak: "Rusak" };
const HASIL_LABEL_TO_CODE: Record<string, string> = { lengkap: "ada", hilang: "hilang", rusak: "rusak" };


interface ValidItem {
  label: string;
  hasil: string;
  catatan: string | null;
  foto: string;
}

type ItemsResult = { ok: true; items: ValidItem[] } | { ok: false; error: string };

// Config per komponen (label -> opsi hasil + flag wajib foto per tahap). Material tanpa template = map kosong -> semua default.
interface ItemCfg {
  options: string[] | null; // null = default Lengkap/Hilang/Rusak (kode lama dipakai apa adanya)
  tipeInput: "opsi" | "teks"; // "teks" = input bebas (input form), bukan pilihan opsi
  fotoWajibPengawas: boolean;
  fotoWajibGudang: boolean;
}
const DEFAULT_ITEM_CFG: ItemCfg = { options: null, tipeInput: "opsi", fotoWajibPengawas: true, fotoWajibGudang: true };

async function getTemplateConfig(materialId: number): Promise<Map<string, ItemCfg>> {
  const r = await pool.query(
    "SELECT label, options, tipe_input, foto_wajib_pengawas, foto_wajib_gudang FROM retur_template_item WHERE material_id = $1",
    [materialId],
  );
  const map = new Map<string, ItemCfg>();
  for (const row of r.rows as { label: string; options: unknown; tipe_input: string | null; foto_wajib_pengawas: boolean; foto_wajib_gudang: boolean }[]) {
    const opts = Array.isArray(row.options)
      ? (row.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim() !== "")
      : null;
    // kompatibilitas data lama: opsi tunggal "ISI DI KOLOM CATATAN" = input form
    const legacyTeks = opts !== null && opts.length === 1 && /^isi\s+di\s+kolom\s+catatan$/i.test(opts[0]);
    map.set(row.label, {
      options: legacyTeks ? null : opts && opts.length > 0 ? opts : null,
      tipeInput: row.tipe_input === "teks" || legacyTeks ? "teks" : "opsi",
      fotoWajibPengawas: row.foto_wajib_pengawas !== false,
      fotoWajibGudang: row.foto_wajib_gudang !== false,
    });
  }
  return map;
}

function cfgFor(cfg: Map<string, ItemCfg>, label: string): ItemCfg {
  return cfg.get(label) ?? DEFAULT_ITEM_CFG;
}

// Validasi nilai hasil thd opsi komponen; default = terima label bawaan ATAU kode lama, simpan kode lama.
// tipeInput "teks" = input form bebas (nilai diketik), hanya dibatasi panjang.
function validateHasil(label: string, hasil: string, options: string[] | null, tipeInput: "opsi" | "teks" = "opsi"): { ok: true; value: string } | { ok: false; error: string } {
  if (tipeInput === "teks") {
    if (!hasil) return { ok: false, error: `Nilai untuk item "${label}" wajib diisi` };
    if (hasil.length > 100) return { ok: false, error: `Nilai untuk item "${label}" maksimal 100 karakter` };
    return { ok: true, value: hasil };
  }
  if (options === null) {
    const code = HASIL_LABEL_TO_CODE[hasil.toLowerCase()] ?? hasil;
    if (!(code in HASIL_CODE_TO_LABEL)) {
      return { ok: false, error: `Hasil untuk item "${label}" harus salah satu: ${DEFAULT_RESULT_OPTIONS.join(", ")}` };
    }
    return { ok: true, value: code };
  }
  if (!options.includes(hasil)) {
    return { ok: false, error: `Hasil untuk item "${label}" harus salah satu: ${options.join(", ")}` };
  }
  return { ok: true, value: hasil };
}

function validateCekItems(itemsRaw: unknown, cfg: Map<string, ItemCfg>, stage: "pengawas" | "gudang"): ItemsResult {
  if (!Array.isArray(itemsRaw)) return { ok: true, items: [] };
  const items: ValidItem[] = [];
  for (const entry of itemsRaw as unknown[]) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "Item ceklist tidak valid" };
    }
    const it = entry as Record<string, unknown>; // fields parsed via typeof guards below
    const label = typeof it.label === "string" ? it.label.trim() : "";
    if (!label) return { ok: false, error: "Label item ceklist wajib diisi" };
    const hasil = typeof it.hasil === "string" ? it.hasil.trim() : "";
    const c = cfgFor(cfg, label);
    const hv = validateHasil(label, hasil, c.options, c.tipeInput);
    if (!hv.ok) return { ok: false, error: hv.error };
    const foto = isImageDataUrl(it.foto) ? (it.foto as string) : "";
    if (!foto && (stage === "pengawas" ? c.fotoWajibPengawas : c.fotoWajibGudang)) {
      return { ok: false, error: `Foto wajib untuk item "${label}" (format image)` };
    }
    items.push({
      label,
      hasil: hv.value,
      catatan: typeof it.catatan === "string" && it.catatan.trim() ? it.catatan.trim() : null,
      foto,
    });
  }
  return { ok: true, items };
}

// ─── Bentuk respons ─────────────────────────────────────────────────────────────

interface ReturDetail {
  id: number;
  materialId: number;
  materialName: string;
  status: string;
  tug10FileId: string;
  tug10Link: string | null;
  catatan: string | null;
  gudangCatatan: string | null;
  pengawasId: number;
  pengawasName: string;
  gudangId: number | null;
  gudangName: string | null;
  unitCount: number;
  createdAt: string;
  checkedAt: string;
  completedAt: string | null;
  units: ReturUnitDetail[];
}

interface ReturUnitDetail {
  id: number;
  label: string;
  sn: string | null;
  keputusan: "layak_pakai" | "usul_hapus" | null; // disposisi gudang, diisi saat verifikasi
  items: ReturItemDetail[];
}

interface ReturItemDetail {
  stage: string;
  itemLabel: string;
  hasil: string;
  catatan: string | null;
  fotoFileId: string | null;
  fotoLink: string | null;
}

interface DocJoinedRow {
  id: number;
  material_id: number;
  material_name: string;
  status: string;
  tug10_file_id: string;
  tug10_link: string | null;
  catatan: string | null;
  gudang_catatan: string | null;
  pengawas_id: number;
  pengawas_name: string;
  gudang_id: number | null;
  gudang_name: string | null;
  created_at: Date;
  checked_at: Date;
  completed_at: Date | null;
  unit_count?: number;
  keputusan_values?: string[] | null;
}

interface UnitRow {
  id: number;
  label: string;
  sn: string | null;
  keputusan: "layak_pakai" | "usul_hapus" | null; // dicegah CHECK constraint di DB
}

interface ItemCekRow {
  unit_id: number;
  stage: string;
  item_label: string;
  hasil: string;
  catatan: string | null;
  foto_file_id: string | null;
  foto_link: string | null;
}

async function buildReturDetail(dokumenId: number): Promise<ReturDetail | null> {
  const docRes = await pool.query(
    `SELECT d.id, d.material_id, m.name AS material_name, d.status,
            d.tug10_file_id, d.tug10_link, d.catatan, d.gudang_catatan,
            d.pengawas_id, p.username AS pengawas_name,
            d.gudang_id, g.username AS gudang_name,
            d.created_at, d.checked_at, d.completed_at
     FROM retur_dokumen d
     JOIN materials m ON m.id = d.material_id
     JOIN users p ON p.id = d.pengawas_id
     LEFT JOIN users g ON g.id = d.gudang_id
     WHERE d.id = $1`,
    [dokumenId],
  );
  if (docRes.rows.length === 0) return null;
  const d = docRes.rows[0] as DocJoinedRow; // kolom sesuai SELECT

  const unitsRes = await pool.query(
    "SELECT id, label, sn, keputusan FROM retur_unit WHERE dokumen_id = $1 ORDER BY id",
    [dokumenId],
  );
  const unitRows = unitsRes.rows as UnitRow[];

  let itemRows: ItemCekRow[] = [];
  if (unitRows.length > 0) {
    const itemsRes = await pool.query(
      `SELECT unit_id, stage, item_label, hasil, catatan, foto_file_id, foto_link
       FROM retur_item_cek WHERE unit_id = ANY($1::int[]) ORDER BY id`,
      [unitRows.map((u) => u.id)],
    );
    itemRows = itemsRes.rows as ItemCekRow[];
  }

  const units: ReturUnitDetail[] = unitRows.map((u) => ({
    id: u.id,
    label: u.label,
    sn: u.sn,
    keputusan: u.keputusan,
    items: itemRows
      .filter((it) => it.unit_id === u.id)
      .map((it) => ({
        stage: it.stage,
        itemLabel: it.item_label,
        hasil: it.hasil,
        catatan: it.catatan,
        fotoFileId: it.foto_file_id,
        fotoLink: it.foto_link,
      })),
  }));

  return {
    id: d.id,
    materialId: d.material_id,
    materialName: d.material_name,
    status: d.status,
    tug10FileId: d.tug10_file_id,
    tug10Link: d.tug10_link,
    catatan: d.catatan,
    gudangCatatan: d.gudang_catatan,
    pengawasId: d.pengawas_id,
    pengawasName: d.pengawas_name,
    gudangId: d.gudang_id,
    gudangName: d.gudang_name,
    unitCount: unitRows.length,
    createdAt: new Date(d.created_at).toISOString(),
    checkedAt: new Date(d.checked_at).toISOString(),
    completedAt: d.completed_at ? new Date(d.completed_at).toISOString() : null,
    units,
  };
}

// ─── Preset template ────────────────────────────────────────────────────────────

const PRESET_2LINE = [
  "MCB utama (incoming)",
  "MCB line 1",
  "MCB line 2",
  "Busbar tembaga",
  "Bar Netral (N)",
  "Bar Arde/Ground",
  "Sekrup terminal lengkap",
  "Cover/pemisah terminal",
  "Bracket dudukan tiang + clamp",
  "Sticker bahaya listrik & label line",
  "Kabel Netral terpasang",
  "Kabel Arde terpasang",
];

const PRESET_4LINE = [
  "MCB utama (incoming)",
  "MCB line 1",
  "MCB line 2",
  "MCB line 3",
  "MCB line 4",
  "Jumper antar-line utuh",
  "Busbar tembaga",
  "Bar Netral (N)",
  "Bar Arde/Ground",
  "Sekrup terminal lengkap",
  "Cover/pemisah terminal",
  "Bracket dudukan tiang + clamp",
  "Sticker bahaya listrik & label line",
  "Kabel Netral terpasang",
  "Kabel Arde terpasang",
];

const PRESET_UMUM = [
  "Fisik unit utuh (tidak penyok/terbakar)",
  "Nameplate terbaca",
  "Aksesori/komponen internal lengkap",
  "Kabel/terminal lengkap",
];

function presetForMaterialName(name: string): string[] {
  if (/4\s*-?\s*line/i.test(name)) return PRESET_4LINE;
  if (/2\s*-?\s*line/i.test(name)) return PRESET_2LINE;
  return PRESET_UMUM;
}

interface TemplateRow {
  id: number;
  label: string;
  options: unknown;
  tipe_input: string | null;
  foto_wajib_pengawas: boolean;
  foto_wajib_gudang: boolean;
}

function mapTemplateRow(r: TemplateRow) {
  const opts = Array.isArray(r.options)
    ? (r.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim() !== "")
    : null;
  const legacyTeks = opts !== null && opts.length === 1 && /^isi\s+di\s+kolom\s+catatan$/i.test(opts[0]);
  return {
    id: r.id,
    label: r.label,
    options: legacyTeks ? null : opts && opts.length > 0 ? opts : null,
    tipeInput: ((r.tipe_input === "teks" || legacyTeks) ? "teks" : "opsi") as "teks" | "opsi",
    fotoWajibPengawas: r.foto_wajib_pengawas !== false,
    fotoWajibGudang: r.foto_wajib_gudang !== false,
  };
}

// ═══ ROUTE STATIS DULU — Express 5: sebelum "/retur/:id" ═══════════════════════

// ─── GET /api/retur/google/status — status akun Drive Retur ─────────────────────
router.get("/retur/google/status", async (req, res): Promise<void> => {
  if (!(await requireReturUser(req, res))) return;
  res.json(await getReturDriveStatus());
});

// ─── GET /api/retur/google/auth-url (master) ────────────────────────────────────
router.get("/retur/google/auth-url", async (req, res): Promise<void> => {
  if (!(await requireReturMaster(req, res))) return;
  try {
    res.json({ url: getReturAuthUrl() });
  } catch (err: unknown) {
    logger.error({ err }, "Retur Drive: gagal membuat URL autorisasi");
    res.status(500).json({ error: "Google Drive Retur memerlukan GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET" });
  }
});

// ─── GET /api/retur/google/callback — redirect Google (tanpa auth) ──────────────
router.get("/retur/google/callback", async (req, res): Promise<void> => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) { res.status(400).json({ error: "Kode autorisasi Google tidak ada" }); return; }
  try {
    await exchangeReturCodeAndSave(code);
    res.redirect("/retur?drive=connected");
  } catch (err: unknown) {
    logger.error({ err }, "Retur Drive: tukar kode gagal");
    res.redirect("/retur?drive=error");
  }
});

// ─── POST /api/retur/google/disconnect (master) ─────────────────────────────────
router.post("/retur/google/disconnect", async (req, res): Promise<void> => {
  if (!(await requireReturMaster(req, res))) return;
  await disconnectReturDrive();
  res.json({ ok: true });
});

// ─── GET /api/retur/template/:materialId — daftar item ceklist ──────────────────
router.get("/retur/template/:materialId", async (req, res): Promise<void> => {
  if (!(await requireReturUser(req, res))) return;
  const materialId = Number(req.params.materialId);
  if (!Number.isInteger(materialId)) { res.status(400).json({ error: "materialId tidak valid" }); return; }

  const rows = await pool.query(
    "SELECT id, label, options, tipe_input, foto_wajib_pengawas, foto_wajib_gudang FROM retur_template_item WHERE material_id = $1 ORDER BY urut, id",
    [materialId],
  );
  if (rows.rows.length > 0) {
    res.json({ items: (rows.rows as TemplateRow[]).map(mapTemplateRow) });
    return;
  }

  const mat = await pool.query("SELECT name FROM materials WHERE id = $1", [materialId]);
  const matRow = mat.rows[0] as { name: string } | undefined; // kolom sesuai SELECT
  const name = matRow ? matRow.name : "";
  res.json({
    items: presetForMaterialName(name).map((label) => ({ id: null, label, options: null, tipeInput: "opsi" as const, fotoWajibPengawas: true, fotoWajibGudang: true })),
  });
});

// ─── PUT /api/retur/template/:materialId (gudang) — replace template ────────────
router.put("/retur/template/:materialId", async (req, res): Promise<void> => {
  if (!(await requireGudang(req, res))) return;
  const materialId = Number(req.params.materialId);
  if (!Number.isInteger(materialId)) { res.status(400).json({ error: "materialId tidak valid" }); return; }

  const body = bodyObject(req);
  const itemsRaw = body.items;
  if (!Array.isArray(itemsRaw)) { res.status(400).json({ error: "items harus array" }); return; }
  const cleaned: { label: string; options: string[] | null; tipeInput: "opsi" | "teks"; fwP: boolean; fwG: boolean }[] = [];
  for (const entry of itemsRaw as unknown[]) {
    if (!entry || typeof entry !== "object") { res.status(400).json({ error: "Setiap item harus objek" }); return; }
    const it = entry as Record<string, unknown>; // fields parsed via typeof guards below
    const label = typeof it.label === "string" ? it.label.trim() : "";
    if (!label) { res.status(400).json({ error: "Setiap label harus string tidak kosong" }); return; }
    const tipeInput: "opsi" | "teks" = it.tipeInput === "teks" ? "teks" : "opsi";
    // options: tidak dikirim/kosong = default; kalau isinya == set bawaan -> simpan null.
    let options: string[] | null = null;
    const optionsRaw = it.options;
    if (Array.isArray(optionsRaw) && optionsRaw.length > 0) {
      if (optionsRaw.length > 30) { res.status(400).json({ error: `options untuk item "${label}" maksimal 30` }); return; }
      const opts: string[] = [];
      const seen = new Set<string>();
      for (const o of optionsRaw) {
        if (typeof o !== "string" || !o.trim()) { res.status(400).json({ error: "Setiap opsi harus string tidak kosong" }); return; }
        const t = o.trim();
        if (t.length > 30) { res.status(400).json({ error: "Setiap opsi maksimal 30 karakter" }); return; }
        if (t in HASIL_CODE_TO_LABEL) { res.status(400).json({ error: `Opsi tidak boleh memakai kode bawaan: "${t}"` }); return; }
        if (seen.has(t.toLowerCase())) { res.status(400).json({ error: `Opsi duplikat: "${t}"` }); return; }
        seen.add(t.toLowerCase());
        opts.push(t);
      }
      const norm = opts.map((o) => HASIL_LABEL_TO_CODE[o.toLowerCase()] ?? o);
      const isDefaultSet = opts.length === DEFAULT_RESULT_OPTIONS.length
        && norm.every((n) => n in HASIL_CODE_TO_LABEL) && new Set(norm).size === norm.length;
      options = isDefaultSet ? null : opts;
    }
    // tipe "teks" = input form bebas; opsi tidak relevan -> paksa null.
    cleaned.push({ label, options: tipeInput === "teks" ? null : options, tipeInput, fwP: it.fotoWajibPengawas !== false, fwG: it.fotoWajibGudang !== false });
  }

  const mat = await pool.query("SELECT id FROM materials WHERE id = $1", [materialId]);
  if (mat.rows.length === 0) { res.status(404).json({ error: "Material tidak ditemukan" }); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM retur_template_item WHERE material_id = $1", [materialId]);
    for (let i = 0; i < cleaned.length; i++) {
      await client.query(
        `INSERT INTO retur_template_item (material_id, label, urut, options, tipe_input, foto_wajib_pengawas, foto_wajib_gudang)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [materialId, cleaned[i].label, i, cleaned[i].options === null ? null : JSON.stringify(cleaned[i].options), cleaned[i].tipeInput, cleaned[i].fwP, cleaned[i].fwG],
      );
    }
    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Retur template: simpan gagal");
    res.status(500).json({ error: "Gagal menyimpan template" });
    return;
  } finally {
    client.release();
  }

  const rows = await pool.query(
    "SELECT id, label, options, tipe_input, foto_wajib_pengawas, foto_wajib_gudang FROM retur_template_item WHERE material_id = $1 ORDER BY urut, id",
    [materialId],
  );
  res.json({ items: (rows.rows as TemplateRow[]).map(mapTemplateRow) });
});

// ─── GET /api/retur/notifications — notifikasi unread milik user ────────────────
interface NotifRow {
  id: number;
  dokumen_id: number;
  message: string;
  created_at: Date;
}

router.get("/retur/notifications", async (req, res): Promise<void> => {
  const actor = await requireReturUser(req, res);
  if (!actor) return;
  const rows = await pool.query(
    `SELECT id, dokumen_id, message, created_at
     FROM retur_notifikasi
     WHERE user_id = $1 AND read_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [actor.id],
  );
  const items = rows.rows as NotifRow[];
  res.json({
    count: items.length,
    items: items.map((n) => ({
      id: n.id,
      dokumenId: n.dokumen_id,
      message: n.message,
      createdAt: new Date(n.created_at).toISOString(),
    })),
  });
});

// ─── POST /api/retur/notifications/read — tandai dibaca ─────────────────────────
router.post("/retur/notifications/read", async (req, res): Promise<void> => {
  const actor = await requireReturUser(req, res);
  if (!actor) return;
  const body = bodyObject(req);
  const all = body.all === true;
  const idsRaw = body.ids;

  if (all) {
    await pool.query(
      "UPDATE retur_notifikasi SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL",
      [actor.id],
    );
    res.json({ ok: true });
    return;
  }

  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    res.json({ ok: true });
    return;
  }
  const ids = (idsRaw as unknown[]).filter((v): v is number => Number.isInteger(v));
  if (ids.length === 0) { res.json({ ok: true }); return; }
  await pool.query(
    "UPDATE retur_notifikasi SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::int[])",
    [actor.id, ids],
  );
  res.json({ ok: true });
});

// ─── GET /api/retur/file/:fileId — stream bytes foto dari Drive Retur ───────────
router.get("/retur/file/:fileId", async (req, res): Promise<void> => {
  if (!(await requireReturUser(req, res))) return;
  const fileId = req.params.fileId;
  if (!fileId) { res.status(404).json({ error: "File tidak ditemukan" }); return; }
  try {
    const { contentType, buffer } = await downloadReturFile(fileId);
    res.setHeader("Content-Type", contentType);
    res.send(buffer);
  } catch (err: unknown) {
    logger.error({ err, fileId }, "Retur Drive: unduh file gagal");
    res.status(404).json({ error: "File tidak ditemukan" });
  }
});

// ─── POST /api/retur — buat dokumen retur (pengawas selesai ceklist) ────────────
interface ValidUnit {
  label: string;
  items: ValidItem[];
}

interface DriveFile {
  fileId: string;
  webViewLink: string;
}

// Stempel nama folder Drive dokumen: yyyyMMdd-HHmm (waktu server) — urut & terbaca manusia.
const formatFolderStamp = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

router.post("/retur", async (req, res): Promise<void> => {
  const actor = await requireReturUser(req, res);
  if (!actor) return;

  const body = bodyObject(req);
  const materialId = body.materialId;
  const tug10Photo = body.tug10Photo;
  const catatan = body.catatan;
  const unitsRaw = body.units;

  if (!Number.isInteger(materialId)) { res.status(400).json({ error: "materialId tidak valid" }); return; }
  if (!isImageDataUrl(tug10Photo)) { res.status(400).json({ error: "Foto TUG10 wajib diunggah (format image)" }); return; }
  if (!Array.isArray(unitsRaw) || unitsRaw.length === 0) { res.status(400).json({ error: "Minimal 1 unit harus diisi" }); return; }

  const mat = await pool.query("SELECT id, name FROM materials WHERE id = $1", [materialId]);
  if (mat.rows.length === 0) { res.status(400).json({ error: "Material tidak ditemukan" }); return; }
  const matRow = mat.rows[0] as { id: number; name: string }; // kolom sesuai SELECT
  const materialName = matRow.name;

  const cfg = await getTemplateConfig(materialId as number); // sudah lolos guard Number.isInteger
  const units: ValidUnit[] = [];
  for (let i = 0; i < unitsRaw.length; i++) {
    const entry = unitsRaw[i];
    if (!entry || typeof entry !== "object") { res.status(400).json({ error: `Unit ${i + 1} tidak valid` }); return; }
    const u = entry as Record<string, unknown>; // fields parsed via typeof guards below
    const label = typeof u.label === "string" && u.label.trim() ? u.label.trim() : `Unit ${i + 1}`;
    const v = validateCekItems(u.items, cfg, "pengawas");
    if (!v.ok) { res.status(400).json({ error: `Unit "${label}": ${v.error}` }); return; }
    units.push({ label, items: v.items });
  }

  const drive = await getReturDriveStatus();
  if (!drive.connected) { res.status(400).json({ error: DRIVE_NOT_CONNECTED_MSG }); return; }

  // Foto ditata per folder: Retur/RETUR-<tanggal>-<material>/Unit <n> - <label>/.
  // Gagal upload → 502; tidak ada baris DB yang ditulis sebelum upload selesai.
  const stamp = Date.now();
  let docFolderId = "";
  let tug10File: DriveFile;
  const unitFiles: (DriveFile | null)[][] = [];
  const unitFolderIds: string[] = [];
  try {
    const root = await ensureReturFolder();
    docFolderId = await ensureChildFolder(
      `RETUR-${formatFolderStamp(new Date())}-${sanitizeFolderName(materialName)}`,
      root,
    );
    tug10File = await uploadReturDataUrl(tug10Photo, `TUG10.${extFromDataUrl(tug10Photo)}`, docFolderId);
    for (let ui = 0; ui < units.length; ui++) {
      const unitFolder = await ensureChildFolder(
        `Unit ${ui + 1} - ${sanitizeFolderName(units[ui].label)}`,
        docFolderId,
      );
      unitFolderIds.push(unitFolder);
      const files: (DriveFile | null)[] = [];
      for (let ii = 0; ii < units[ui].items.length; ii++) {
        const it = units[ui].items[ii];
        // Item tanpa foto (komponen tidak wajib foto) -> tidak ada file Drive, fileId null.
        files.push(it.foto
          ? await uploadReturDataUrl(it.foto, `U${ui + 1}-I${ii + 1}-${stamp}.${extFromDataUrl(it.foto)}`, unitFolder)
          : null);
      }
      unitFiles.push(files);
    }
  } catch (err: unknown) {
    logger.error({ err }, "Retur: upload foto ke Drive gagal");
    res.status(502).json({ error: "Gagal upload foto ke Google Drive" });
    return;
  }

  const client = await pool.connect();
  let dokumenId = 0;
  try {
    await client.query("BEGIN");
    const docRes = await client.query(
      `INSERT INTO retur_dokumen (material_id, tug10_file_id, tug10_link, folder_file_id, catatan, pengawas_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        materialId,
        tug10File.fileId,
        tug10File.webViewLink || null,
        docFolderId,
        typeof catatan === "string" && catatan.trim() ? catatan.trim() : null,
        actor.id,
      ],
    );
    const docRow = docRes.rows[0] as { id: number }; // RETURNING id
    dokumenId = docRow.id;

    for (let ui = 0; ui < units.length; ui++) {
      const unitRes = await client.query(
        "INSERT INTO retur_unit (dokumen_id, label, folder_file_id) VALUES ($1, $2, $3) RETURNING id",
        [dokumenId, units[ui].label, unitFolderIds[ui]],
      );
      const unitRow = unitRes.rows[0] as { id: number }; // RETURNING id
      const unitId = unitRow.id;
      for (let ii = 0; ii < units[ui].items.length; ii++) {
        const it = units[ui].items[ii];
        await client.query(
          `INSERT INTO retur_item_cek (unit_id, stage, item_label, hasil, catatan, foto_file_id, foto_link)
           VALUES ($1, 'pengawas', $2, $3, $4, $5, $6)`,
          [unitId, it.label, it.hasil, it.catatan, unitFiles[ui][ii]?.fileId ?? null, unitFiles[ui][ii]?.webViewLink ?? null],
        );
      }
    }

    const message = `Retur ${materialName} (${units.length} unit) oleh ${actor.username} selesai diceklist — menunggu verifikasi gudang.`;
    await client.query(
      `INSERT INTO retur_notifikasi (user_id, dokumen_id, message)
       SELECT u.id, $1, $2
       FROM users u
       WHERE (u.role = 'master' OR u.menu_access @> '["retur:gudang"]'::jsonb)
         AND u.id <> $3`,
      [dokumenId, message, actor.id],
    );
    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Retur: simpan dokumen gagal");
    res.status(500).json({ error: "Gagal menyimpan dokumen retur" });
    return;
  } finally {
    client.release();
  }

  const detail = await buildReturDetail(dokumenId);
  res.status(201).json(detail);
});

// ─── GET /api/retur — daftar dokumen (gudang: semua; selain gudang: milik sendiri)
router.get("/retur", async (req, res): Promise<void> => {
  const actor = await requireReturUser(req, res);
  if (!actor) return;
  const isGudang = actor.role === "master" || actor.menuAccess.includes("retur:gudang");

  const qRaw = req.query.q;
  const statusRaw = req.query.status;
  const keputusanRawQ = req.query.keputusan;
  const q = typeof qRaw === "string" ? qRaw.trim() : "";
  const statusF = statusRaw === "checked_supervisor" || statusRaw === "completed" ? statusRaw : "";
  const keputusanF = keputusanRawQ === "layak_pakai" || keputusanRawQ === "usul_hapus" ? keputusanRawQ : "";

  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (!isGudang) { args.push(actor.id); conds.push(`d.pengawas_id = $${args.length}`); }
  if (statusF) { args.push(statusF); conds.push(`d.status = $${args.length}`); }
  if (q) { args.push(`%${q}%`); conds.push(`(m.name ILIKE $${args.length} OR m.code ILIKE $${args.length})`); }
  if (keputusanF) { args.push(keputusanF); conds.push(`EXISTS (SELECT 1 FROM retur_unit fu WHERE fu.dokumen_id = d.id AND fu.keputusan = $${args.length})`); }

  const result = await pool.query(
    `SELECT d.id, d.material_id, m.name AS material_name, d.status,
            d.tug10_file_id, d.tug10_link, d.catatan, d.gudang_catatan,
            d.pengawas_id, p.username AS pengawas_name,
            d.gudang_id, g.username AS gudang_name,
            (SELECT COUNT(*)::int FROM retur_unit u WHERE u.dokumen_id = d.id) AS unit_count,
            (SELECT array_agg(DISTINCT u.keputusan) FROM retur_unit u
              WHERE u.dokumen_id = d.id AND u.keputusan IS NOT NULL) AS keputusan_values,
            d.created_at, d.checked_at, d.completed_at
     FROM retur_dokumen d
     JOIN materials m ON m.id = d.material_id
     JOIN users p ON p.id = d.pengawas_id
     LEFT JOIN users g ON g.id = d.gudang_id
     ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
     ORDER BY d.created_at DESC, d.id DESC`,
    args,
  );
  const rows = result.rows as DocJoinedRow[]; // kolom sesuai SELECT
  res.json(
    rows.map((d) => ({
      id: d.id,
      materialId: d.material_id,
      materialName: d.material_name,
      status: d.status,
      tug10FileId: d.tug10_file_id,
      tug10Link: d.tug10_link,
      catatan: d.catatan,
      gudangCatatan: d.gudang_catatan,
      pengawasId: d.pengawas_id,
      pengawasName: d.pengawas_name,
      gudangId: d.gudang_id,
      gudangName: d.gudang_name,
      unitCount: d.unit_count ?? 0,
      keputusan: Array.isArray(d.keputusan_values) ? (d.keputusan_values.length === 1 ? d.keputusan_values[0] : d.keputusan_values.length > 1 ? "campur" : null) : null,
      createdAt: new Date(d.created_at).toISOString(),
      checkedAt: new Date(d.checked_at).toISOString(),
      completedAt: d.completed_at ? new Date(d.completed_at).toISOString() : null,
    })),
  );
});

// ═══ ROUTE DYNAMIC — setelah statis; :id dijaga numerik ════════════════════════

// ─── GET /api/retur/:id — detail penuh (gudang ATAU pengawas pemilik) ───────────
router.get("/retur/:id", async (req, res): Promise<void> => {
  const actor = await requireReturUser(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

  const owner = await pool.query("SELECT pengawas_id FROM retur_dokumen WHERE id = $1", [id]);
  if (owner.rows.length === 0) { res.status(404).json({ error: "Dokumen retur tidak ditemukan" }); return; }
  const ownerRow = owner.rows[0] as { pengawas_id: number }; // kolom sesuai SELECT
  const isGudang = actor.role === "master" || actor.menuAccess.includes("retur:gudang");
  const isOwner = ownerRow.pengawas_id === actor.id;
  if (!isGudang && !isOwner) { res.status(403).json({ error: "Anda tidak berhak melihat dokumen ini" }); return; }

  const detail = await buildReturDetail(id);
  if (!detail) { res.status(404).json({ error: "Dokumen retur tidak ditemukan" }); return; }
  res.json(detail);
});

// ─── DELETE /api/retur/:id (master) — hapus dokumen + unit + ceklist + notifikasi ─
router.delete("/retur/:id", async (req, res): Promise<void> => {
  const actor = await requireReturMaster(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

  const doc = await pool.query("SELECT tug10_file_id, folder_file_id FROM retur_dokumen WHERE id = $1", [id]);
  if (doc.rows.length === 0) { res.status(404).json({ error: "Dokumen retur tidak ditemukan" }); return; }
  const docRow = doc.rows[0] as { tug10_file_id: string | null; folder_file_id: string | null }; // kolom sesuai SELECT

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM retur_notifikasi WHERE dokumen_id = $1", [id]);
    await client.query("DELETE FROM retur_item_cek WHERE unit_id IN (SELECT id FROM retur_unit WHERE dokumen_id = $1)", [id]);
    await client.query("DELETE FROM retur_unit WHERE dokumen_id = $1", [id]);
    await client.query("DELETE FROM retur_dokumen WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, docId: id }, "Retur: gagal hapus dokumen");
    res.status(500).json({ error: "Gagal menghapus dokumen" });
    return;
  } finally {
    client.release();
  }

  // Drive ikut dihapus; best-effort — kegagalan Drive tidak membatalkan penghapusan
  // DB. Dokumen baru: cukup hapus folder dokumennya, Drive otomatis membuang seluruh
  // isi (TUG10 + subfolder unit). Dokumen lama (pra struktur folder): hapus per file.
  if (docRow.folder_file_id) {
    try {
      await deleteReturFile(docRow.folder_file_id);
    } catch (err) {
      logger.warn({ err, fileId: docRow.folder_file_id, docId: id }, "Retur: gagal hapus folder Drive (dokumen sudah dihapus dari DB)");
    }
  } else {
    const fotos = await pool.query(
      "SELECT foto_file_id FROM retur_item_cek WHERE unit_id IN (SELECT id FROM retur_unit WHERE dokumen_id = $1)",
      [id]
    );
    const fotoRows = fotos.rows as { foto_file_id: string | null }[];
    const fileIds = [docRow.tug10_file_id, ...fotoRows.map((r) => r.foto_file_id)]
      .filter((f): f is string => typeof f === "string" && f.length > 0);
    for (const fileId of fileIds) {
      try {
        await deleteReturFile(fileId);
      } catch (err) {
        logger.warn({ err, fileId, docId: id }, "Retur: gagal hapus file Drive (dokumen sudah dihapus dari DB)");
      }
    }
  }

  logger.info({ docId: id, actor: actor.username }, "Retur: dokumen dihapus oleh master");
  res.json({ ok: true, id });
});

// ─── POST /api/retur/:id/verify (gudang) — verifikasi + SN + ceklist gudang ─────
interface VerifyUnit {
  unitId: number;
  sn: string;
  keputusan: "layak_pakai" | "usul_hapus"; // disposisi wajib dari petugas gudang
  items: ValidItem[];
}

router.post("/retur/:id/verify", async (req, res): Promise<void> => {
  const actor = await requireGudang(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

  const doc = await pool.query("SELECT id, status, folder_file_id, material_id FROM retur_dokumen WHERE id = $1", [id]);
  if (doc.rows.length === 0) { res.status(404).json({ error: "Dokumen retur tidak ditemukan" }); return; }
  const docRow = doc.rows[0] as { id: number; status: string; folder_file_id: string | null; material_id: number }; // kolom sesuai SELECT
  if (docRow.status !== "checked_supervisor") {
    res.status(400).json({ error: "Dokumen sudah selesai diverifikasi" });
    return;
  }

  const body = bodyObject(req);
  const gudangCatatan = body.gudangCatatan;
  const unitsRaw = body.units;
  if (!Array.isArray(unitsRaw)) { res.status(400).json({ error: "units harus array" }); return; }

  const docUnitsRes = await pool.query(
    "SELECT id, label, folder_file_id FROM retur_unit WHERE dokumen_id = $1 ORDER BY id",
    [id],
  );
  const docUnits = docUnitsRes.rows as { id: number; label: string; folder_file_id: string | null }[];
  const docUnitIds = new Set<number>(docUnits.map((u) => u.id));

  const cfg = await getTemplateConfig(docRow.material_id);
  const verifyUnits: VerifyUnit[] = [];
  const payloadUnitIds = new Set<number>();
  for (const entry of unitsRaw as unknown[]) {
    if (!entry || typeof entry !== "object") { res.status(400).json({ error: "Unit verifikasi tidak valid" }); return; }
    const u = entry as Record<string, unknown>; // fields parsed via typeof guards below
    const unitId = typeof u.unitId === "number" ? u.unitId : NaN;
    if (!Number.isInteger(unitId) || !docUnitIds.has(unitId)) {
      res.status(400).json({ error: "Unit bukan milik dokumen ini" });
      return;
    }
    if (payloadUnitIds.has(unitId)) {
      res.status(400).json({ error: "Unit ganda dalam payload" });
      return;
    }
    payloadUnitIds.add(unitId);
    const sn = typeof u.sn === "string" ? u.sn.trim() : "";
    if (!sn) { res.status(400).json({ error: "SN wajib diisi" }); return; }
    const keputusanRaw = u.keputusan;
    if (keputusanRaw !== "layak_pakai" && keputusanRaw !== "usul_hapus") {
      res.status(400).json({ error: `Unit "${docUnits.find((du) => du.id === unitId)?.label}" wajib diputuskan: pilih "Layak Pakai (Standby)" atau "Tidak Layak Pakai (Usul Hapus)"` });
      return;
    }
    const v = validateCekItems(u.items, cfg, "gudang");
    if (!v.ok) { res.status(400).json({ error: `SN "${sn}": ${v.error}` }); return; }
    verifyUnits.push({ unitId, sn, keputusan: keputusanRaw, items: v.items });
  }

  // SETIAP unit dokumen wajib hadir di payload
  for (const du of docUnits) {
    if (!payloadUnitIds.has(du.id)) {
      res.status(400).json({ error: `Unit "${du.label}" belum diverifikasi (SN wajib diisi)` });
      return;
    }
  }

  // SN duplikat: duplikat internal payload + precheck terhadap dokumen lain
  const snList = verifyUnits.map((u) => u.sn);
  const seenSn = new Set<string>();
  for (const sn of snList) {
    if (seenSn.has(sn)) { res.status(409).json({ error: `SN sudah digunakan: ${sn}` }); return; }
    seenSn.add(sn);
  }
  const snDup = await pool.query(
    "SELECT sn FROM retur_unit WHERE sn = ANY($1::text[]) AND dokumen_id <> $2 ORDER BY id LIMIT 1",
    [snList, id],
  );
  if (snDup.rows.length > 0) {
    const dupRow = snDup.rows[0] as { sn: string }; // kolom sesuai SELECT
    res.status(409).json({ error: `SN sudah digunakan: ${dupRow.sn}` });
    return;
  }

  const drive = await getReturDriveStatus();
  if (!drive.connected) { res.status(400).json({ error: DRIVE_NOT_CONNECTED_MSG }); return; }

  // Foto gudang masuk ke folder unit yang sama dg foto pengawas (dibuat di verify
  // pertama bila dokumen lama belum punya struktur folder).
  const stamp = Date.now();
  const unitFiles: (DriveFile | null)[][] = [];
  try {
    const root = await ensureReturFolder();
    let docFolder = docRow.folder_file_id;
    if (!docFolder) {
      docFolder = await ensureChildFolder(`RETUR-DOK-${id}`, root);
      await pool.query("UPDATE retur_dokumen SET folder_file_id = $1 WHERE id = $2", [docFolder, id]);
    }
    for (let ui = 0; ui < verifyUnits.length; ui++) {
      const duIndex = docUnits.findIndex((du) => du.id === verifyUnits[ui].unitId);
      const du = docUnits[duIndex];
      let unitFolder = du.folder_file_id;
      if (!unitFolder) {
        unitFolder = await ensureChildFolder(`Unit ${duIndex + 1} - ${sanitizeFolderName(du.label)}`, docFolder);
        await pool.query("UPDATE retur_unit SET folder_file_id = $1 WHERE id = $2", [unitFolder, du.id]);
      }
      const files: (DriveFile | null)[] = [];
      for (let ii = 0; ii < verifyUnits[ui].items.length; ii++) {
        const it = verifyUnits[ui].items[ii];
        files.push(it.foto
          ? await uploadReturDataUrl(it.foto, `GUDANG-U${duIndex + 1}-I${ii + 1}-${stamp}.${extFromDataUrl(it.foto)}`, unitFolder)
          : null);
      }
      unitFiles.push(files);
    }
  } catch (err: unknown) {
    logger.error({ err }, "Retur verify: upload foto ke Drive gagal");
    res.status(502).json({ error: "Gagal upload foto ke Google Drive" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let ui = 0; ui < verifyUnits.length; ui++) {
      await client.query("UPDATE retur_unit SET sn = $1, keputusan = $2 WHERE id = $3 AND dokumen_id = $4", [verifyUnits[ui].sn, verifyUnits[ui].keputusan, verifyUnits[ui].unitId, id]);
      for (let ii = 0; ii < verifyUnits[ui].items.length; ii++) {
        const it = verifyUnits[ui].items[ii];
        await client.query(
          `INSERT INTO retur_item_cek (unit_id, stage, item_label, hasil, catatan, foto_file_id, foto_link)
           VALUES ($1, 'gudang', $2, $3, $4, $5, $6)`,
          [verifyUnits[ui].unitId, it.label, it.hasil, it.catatan, unitFiles[ui][ii]?.fileId ?? null, unitFiles[ui][ii]?.webViewLink ?? null],
        );
      }
    }
    await client.query(
      `UPDATE retur_dokumen
       SET status = 'completed', gudang_id = $2, gudang_catatan = $3, completed_at = NOW()
       WHERE id = $1`,
      [id, actor.id, typeof gudangCatatan === "string" && gudangCatatan.trim() ? gudangCatatan.trim() : null],
    );
    await client.query(
      "UPDATE retur_notifikasi SET read_at = NOW() WHERE dokumen_id = $1 AND read_at IS NULL",
      [id],
    );
    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    const errCode = err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : "";
    if (errCode === "23505") {
      const dup = await pool.query(
        "SELECT sn FROM retur_unit WHERE sn = ANY($1::text[]) AND dokumen_id <> $2 ORDER BY id LIMIT 1",
        [snList, id],
      );
      const dupRow = dup.rows[0] as { sn: string } | undefined; // kolom sesuai SELECT
      res.status(409).json({ error: `SN sudah digunakan: ${dupRow ? dupRow.sn : snList[0]}` });
      return;
    }
    logger.error({ err }, "Retur verify: simpan gagal");
    res.status(500).json({ error: "Gagal menyimpan verifikasi retur" });
    return;
  } finally {
    client.release();
  }

  const detail = await buildReturDetail(id);
  res.json(detail);
});

// ─── PUT /api/retur/:id/verify-items (master) — koreksi hasil cek gudang pada dokumen selesai ──
router.put("/retur/:id/verify-items", async (req, res): Promise<void> => {
  if (!(await requireReturMaster(req, res))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "id tidak valid" }); return; }

  const docRes = await pool.query("SELECT id, status, material_id FROM retur_dokumen WHERE id = $1", [id]);
  const docRow = docRes.rows[0] as { id: number; status: string; material_id: number } | undefined; // kolom sesuai SELECT
  if (!docRow) { res.status(404).json({ error: "Dokumen tidak ditemukan" }); return; }
  if (docRow.status !== "completed") { res.status(400).json({ error: "Dokumen belum selesai — gunakan menu Verifikasi" }); return; }

  const body = bodyObject(req);
  const unitsRaw = body.units;
  if (!Array.isArray(unitsRaw)) { res.status(400).json({ error: "units harus array" }); return; }

  const unitRes = await pool.query("SELECT id FROM retur_unit WHERE dokumen_id = $1", [id]);
  const docUnitIds = new Set<number>((unitRes.rows as { id: number }[]).map((u) => u.id));

  const cfg = await getTemplateConfig(docRow.material_id);

  interface Edit { unitId: number; label: string; hasil: string | null; catatan: string | null }
  const edits: Edit[] = [];
  for (const entry of unitsRaw as unknown[]) {
    if (!entry || typeof entry !== "object") { res.status(400).json({ error: "Unit tidak valid" }); return; }
    const u = entry as Record<string, unknown>; // fields parsed via typeof guards below
    const unitId = typeof u.unitId === "number" ? u.unitId : NaN;
    if (!Number.isInteger(unitId) || !docUnitIds.has(unitId)) { res.status(400).json({ error: "Unit bukan milik dokumen ini" }); return; }
    const itemsRaw = u.items;
    if (!Array.isArray(itemsRaw)) { res.status(400).json({ error: "items harus array" }); return; }
    for (const eRaw of itemsRaw as unknown[]) {
      if (!eRaw || typeof eRaw !== "object") { res.status(400).json({ error: "Item tidak valid" }); return; }
      const e = eRaw as Record<string, unknown>;
      const label = typeof e.itemLabel === "string" ? e.itemLabel.trim() : "";
      if (!label) { res.status(400).json({ error: "itemLabel wajib diisi" }); return; }
      const hasil = typeof e.hasil === "string" ? e.hasil.trim() : "";
      const catatan = typeof e.catatan === "string" && e.catatan.trim() ? e.catatan.trim() : null;
      if (!hasil) { edits.push({ unitId, label, hasil: null, catatan: null }); continue; } // hasil kosong = kosongkan baris gudang
      const hv = validateHasil(label, hasil, cfgFor(cfg, label).options);
      if (!hv.ok) { res.status(400).json({ error: hv.error }); return; }
      edits.push({ unitId, label, hasil: hv.value, catatan });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const ed of edits) {
      if (ed.hasil === null) {
        await client.query("DELETE FROM retur_item_cek WHERE unit_id = $1 AND stage = 'gudang' AND item_label = $2", [ed.unitId, ed.label]);
        continue;
      }
      const up = await client.query(
        "UPDATE retur_item_cek SET hasil = $1, catatan = $2 WHERE unit_id = $3 AND stage = 'gudang' AND item_label = $4",
        [ed.hasil, ed.catatan, ed.unitId, ed.label],
      );
      if (up.rowCount === 0) {
        await client.query(
          `INSERT INTO retur_item_cek (unit_id, stage, item_label, hasil, catatan, foto_file_id, foto_link)
           VALUES ($1, 'gudang', $2, $3, $4, NULL, NULL)`,
          [ed.unitId, ed.label, ed.hasil, ed.catatan],
        );
      }
    }
    await client.query("COMMIT");
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Retur verify-items: koreksi gagal");
    res.status(500).json({ error: "Gagal mengoreksi hasil verifikasi" });
    return;
  } finally {
    client.release();
  }

  const detail = await buildReturDetail(id);
  res.json(detail);
});
export default router;
