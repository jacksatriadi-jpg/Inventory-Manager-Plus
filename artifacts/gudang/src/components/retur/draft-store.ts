// Draft form "Buat Retur" disimpan per username di IndexedDB supaya refresh halaman /
// pindah tab tidak menghapus isian. Foto & lampiran (data URL, bisa puluhan MB total)
// melebihi kuota localStorage (~5MB), jadi pakai IndexedDB. Semua operasi best-effort:
// gagal simpan (private mode, kuota) tidak boleh mengganggu form.
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
