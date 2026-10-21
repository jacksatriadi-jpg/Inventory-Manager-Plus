// Shared types, auth fetch helper, dan utilitas untuk modul Retur Material.
// Endpoint: prefix /api/retur, auth Bearer (key localStorage "token", sama dgn lib/auth.tsx).

export interface ReturTemplateItem {
  id: number | null;
  label: string;
}

export interface ReturDokumen {
  id: number;
  materialId: number;
  materialName: string;
  status: "checked_supervisor" | "completed";
  tug10FileId: string;
  tug10Link: string | null;
  catatan: string | null;
  gudangCatatan: string | null;
  pengawasId: number;
  pengawasName: string | null;
  gudangId: number | null;
  gudangName: string | null;
  unitCount: number;
  keputusan: Keputusan | "campur" | null; // ringkasan dokumen: nilai seragam semua unit, 'campur', atau null
  createdAt: string;
  checkedAt: string;
  completedAt: string | null;
}

export interface ReturItemCek {
  stage: "pengawas" | "gudang";
  itemLabel: string;
  hasil: string; // kode bawaan 'ada'/'hilang'/'rusak' atau string opsi kustom
  catatan: string | null;
  fotoFileId: string;
  fotoLink: string | null;
}

export interface ReturUnitDetail {
  id: number;
  label: string;
  sn: string | null;
  keputusan: Keputusan | null; // disposisi gudang per unit; null = belum diverifikasi
  items: ReturItemCek[];
}

export interface ReturDetail extends ReturDokumen {
  units: ReturUnitDetail[];
}

export interface ReturNotifikasi {
  id: number;
  dokumenId: number;
  message: string;
  createdAt: string;
}

export type Hasil = "ada" | "hilang" | "rusak";

export const HASIL_LABEL: Record<Hasil, string> = {
  ada: "Lengkap",
  hilang: "Hilang",
  rusak: "Rusak",
};

export const HASIL_BADGE: Record<Hasil, string> = {
  ada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  hilang: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  rusak: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

// Opsi hasil bawaan; material bisa punya opsi kustom (dari GET /template/:id -> options).
export const DEFAULT_RESULT_OPTIONS = ["Lengkap", "Hilang", "Rusak"];

// Kode bawaan dipetakan ke labelnya; opsi kustom tampil apa adanya.
export function hasilDisplay(h: string): string {
  return HASIL_LABEL[h as Hasil] ?? h;
}

export function hasilBadgeClass(h: string): string {
  return HASIL_BADGE[h as Hasil] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

// Disposisi gudang per unit (wajib dipilih saat verifikasi). 'campur' = ringkasan dokumen
// ber-keputusan beda antar unit — hanya muncul di level dokumen, bukan per unit.
export type Keputusan = "layak_pakai" | "usul_hapus";

export const KEPUTUSAN_LABEL: Record<Keputusan | "campur", string> = {
  layak_pakai: "Layak Pakai (Standby)",
  usul_hapus: "Tidak Layak Pakai (Usul Hapus)",
  campur: "Campur (lihat unit)",
};

export const KEPUTUSAN_BADGE: Record<Keputusan | "campur", string> = {
  layak_pakai: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  usul_hapus: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  campur: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

// "Retur user": role master ATAU menuAccess mengandung "/retur"/"retur:gudang"
// ATAU menuAccess kosong (user reguler punya semua menu non-admin).
export function isReturUser(user: { role?: string; menuAccess?: unknown } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "guest") return false;
  if (user.role === "master") return true;
  const ma = menuAccessList(user);
  if (ma.length === 0) return true;
  return ma.includes("/retur") || ma.includes("retur:gudang");
}

// "Gudang retur": role master ATAU menuAccess mengandung "retur:gudang".
// MenuAccess KOSONG bukan petugas gudang (verifikasi/riwayat khusus penugasan eksplisit).
export function isReturGudang(user: { role?: string; menuAccess?: unknown } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "guest") return false;
  if (user.role === "master") return true;
  const ma = menuAccessList(user);
  return ma.includes("retur:gudang");
}

const menuAccessList = (user: { menuAccess?: unknown }): string[] =>
  Array.isArray(user.menuAccess) ? user.menuAccess.filter((x): x is string => typeof x === "string") : [];

// Material non-scan (kolom `kategori` dikirim API materials; orval tipe belum memuatnya).
export function isNonScanMaterial(m: unknown): boolean {
  return typeof m === "object" && m !== null && "kategori" in m && m.kategori === "non-scan";
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fetch JSON manual dgn Bearer; error server selalu { error: "..." } bahasa Indonesia.
export async function returApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/retur${path}`, {
    ...init,
    headers: { ...authHeaders(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data.error === "string" ? data.error : `Permintaan gagal (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

// Bytes foto dari Drive Retur via server (retur user).
export async function fetchReturFile(fileId: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(`/api/retur/file/${encodeURIComponent(fileId)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("File tidak ditemukan");
  const bytes = await res.arrayBuffer();
  return { bytes, contentType: res.headers.get("content-type") || "image/jpeg" };
}

// Notifikasi bell di layout ikut refresh saat ada aksi retur (verifikasi selesai, dll).
export function notifyReturChanged(): void {
  window.dispatchEvent(new Event("retur-notifications-changed"));
}

// Baca file jadi dataURL lalu kompres (pola compressImage kas-gudang.tsx:
// max sisi 1280px, JPEG q0.72 — cukup terbaca utk arsip, ringan utk upload Drive).
export const compressImage = (dataUrl: string): Promise<string> => {
  const { promise, resolve } = Promise.withResolvers<string>();
  const img = new Image();
  img.onload = () => {
    const MAX = 1280;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { resolve(dataUrl); return; }
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", 0.72);
    resolve(out.length < dataUrl.length ? out : dataUrl);
  };
  img.onerror = () => resolve(dataUrl);
  img.src = dataUrl;
  return promise;
};

export const readFileCompressed = (file: File): Promise<string> => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = async () => resolve(await compressImage(reader.result as string));
  reader.onerror = () => reject(new Error("Gagal membaca file gambar"));
  reader.readAsDataURL(file);
  return promise;
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function fmtTanggal(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "-" : d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
