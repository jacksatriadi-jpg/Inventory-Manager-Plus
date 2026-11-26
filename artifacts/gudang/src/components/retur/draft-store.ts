// Draft form "Buat Retur" disimpan per username di IndexedDB supaya refresh halaman /
// pindah tab tidak menghapus isian. Foto & lampiran (data URL, bisa puluhan MB total)
// melebihi kuota localStorage (~5MB), jadi pakai IndexedDB. Semua operasi best-effort:
// gagal simpan (private mode, kuota) tidak boleh mengganggu form.
// Selain itu draft disinkronkan ke server (returApi /draft) supaya device lain bisa
// memuat draft yang sama (permintaan Jack, Nov 2026).
import { returApi } from "./shared";

export interface DraftItem { label: string; hasil: string; catatan: string; foto: string }
export interface DraftUnit { label: string; items: DraftItem[]; formData: Record<string, string> }
export interface DraftGroup {
  materialId: string;
  units: DraftUnit[];
  jumlahUnit: string;
  lampiranFiles: { name: string; dataUrl: string }[];
}
export interface ReturDraft { savedAt: number; tug10: string; catatan: string; groups: DraftGroup[] }

const DB_NAME = "retur-draft";
const STORE = "drafts";
const keyOf = (username: string) => `draft:${username}`;

let dbPromise: Promise<IDBDatabase> | null = null;
function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await getDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadReturDraft(username: string): Promise<ReturDraft | null> {
  try {
    const v = await withStore<ReturDraft | undefined>("readonly", (s) => s.get(keyOf(username)));
    return v && Array.isArray(v.groups) ? v : null;
  } catch {
    return null;
  }
}

export async function saveReturDraft(username: string, draft: ReturDraft): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(draft, keyOf(username)));
  } catch {
    /* kuota penuh / storage diblokir: draft bersifat best-effort */
  }
}

export async function clearReturDraft(username: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(keyOf(username)));
  } catch {
    /* abaikan */
  }
}

// ---------- Sinkronisasi ke server (lintas perangkat) ----------
// Semua best-effort: server tidak reachable / draft terlalu besar => draft lokal tetap jalan.

export async function fetchServerDraft(): Promise<ReturDraft | null> {
  try {
    const r = await returApi<{ payload: ReturDraft | null }>("/draft");
    return r.payload && Array.isArray(r.payload.groups) ? r.payload : null;
  } catch {
    return null;
  }
}

export async function pushServerDraft(draft: ReturDraft, mergePhotos: boolean): Promise<boolean> {
  try {
    await returApi("/draft", { method: "PUT", body: JSON.stringify({ payload: draft, mergePhotos }) });
    return true;
  } catch {
    return false;
  }
}

export async function deleteServerDraft(): Promise<void> {
  try {
    await returApi("/draft", { method: "DELETE" });
  } catch {
    /* abaikan */
  }
}

// Signature susunan foto/lampiran (jumlah + panjang data URL). Selama signature sama,
// push "lite" (tanpa data URL) aman: server mengisi kembali foto dari salinan tersimpan
// pada posisi yang identik. Perubahan foto apa pun => signature beda => push penuh.
export function photoSignature(d: ReturDraft): string {
  const parts: string[] = [String((d.tug10 ?? "").length)];
  for (const g of d.groups ?? []) {
    parts.push("L" + (g.lampiranFiles ?? []).map((f) => `${f.name}:${f.dataUrl.length}`).join(","));
    for (const u of g.units ?? []) {
      parts.push("U" + (u.items ?? []).map((it) => String((it.foto ?? "").length)).join(","));
    }
  }
  return parts.join("|");
}

// Salinan ringan untuk lite push: semua data URL dikosongkan (struktur tetap identik).
export function liteDraft(d: ReturDraft): ReturDraft {
  return {
    ...d,
    tug10: "",
    groups: (d.groups ?? []).map((g) => ({
      ...g,
      lampiranFiles: (g.lampiranFiles ?? []).map((f) => ({ ...f, dataUrl: "" })),
      units: (g.units ?? []).map((u) => ({
        ...u,
        items: (u.items ?? []).map((it) => ({ ...it, foto: "" })),
      })),
    })),
  };
}

// Draft dianggap berisi bila ada minimal satu isian nyata (foto, nomor TUG10, material,
// hasil ceklist, catatan, data material, jumlah unit, atau lampiran).
export function draftHasContent(d: ReturDraft): boolean {
  if ((d.tug10 ?? "") !== "" || (d.catatan ?? "").trim() !== "") return true;
  return (d.groups ?? []).some((g) =>
    (g.materialId ?? "") !== "" ||
    (g.jumlahUnit ?? "").trim() !== "" ||
    (g.lampiranFiles ?? []).length > 0 ||
    (g.units ?? []).some((u) =>
      Object.values(u.formData ?? {}).some((v) => (v ?? "").trim() !== "") ||
      (u.items ?? []).some((it) => (it.hasil ?? "") !== "" || (it.catatan ?? "").trim() !== "" || (it.foto ?? "") !== "")));
}
