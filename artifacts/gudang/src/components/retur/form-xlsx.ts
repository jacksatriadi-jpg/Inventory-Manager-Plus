// Renderer Cetak Formulir Inspeksi Material Retur — menghasilkan .xlsx yang STRUKTURNYA
// identik dengan contoh user (Formulir 01-A..01-O): header PT PLN/UID BALI/UNIT …,
// judul formulir, kalimat "Pada hari ini…", A. DATA MATERIAL, tabel pemeriksaan
// (NO | MATA UJI | HASIL BAIK/RUSAK | PERSYARATAN | KESESUAIAN | KETERANGAN),
// kesimpulan K6/K7/K8 (dicoret except pilihan), dan blok tanda tangan.
// Satu sheet per unit dokumen. Font Arial 10 + border tipis mengikuti contoh.
import * as exceljsNs from "exceljs";
type ExcelJsModule = typeof exceljsNs & { default?: typeof exceljsNs };
const ExcelJS = (exceljsNs as ExcelJsModule).default ?? exceljsNs;

import type { FormDefinition, FormRowDef, FormSectionDef } from "./shared";
import type { ReturDetail, ReturUnitDetail, ReturItemCek } from "./shared";

// Lebar kolom A..H — sama persis dengan file contoh.
const COL_W = [2.3, 4.6, 30.9, 10.6, 14.0, 20.4, 14.4, 27.4];
const FONT = { name: "Arial", size: 10 } as const;
const BOLD = { name: "Arial", size: 10, bold: true } as const;
const THIN = { style: "thin" as const, color: { argb: "FF000000" } };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };
type Alignment = {
  horizontal?: "left" | "center" | "right" | "justify" | "distributed" | "general";
  vertical?: "top" | "middle" | "bottom" | "justify";
  wrapText?: boolean; shrinkToFit?: boolean; indent?: number; readingOrder?: number; textRotation?: number;
};

const DOTS = "…………………………………………";

const norm = (s: string): string => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

const POS_WORDS = ["baik", "ada", "lengkap", "normal", "berhasil", "sesuai", "layak", "aman"];
const NEG_WORDS = ["rusak", "tidak ada", "hilang", "gagal", "tidak baik", "tidak lengkap", "tidak sesuai", "tidak layak", "cacat", "bocor", "bengkak", "rembes", "longgar", "retak", "karat", "korosi", "pecah"];

function polarity(text: string): "pos" | "neg" | "" {
  const h = norm(text);
  if (!h) return "";
  if (NEG_WORDS.some((w) => h.includes(w))) return "neg";
  if (POS_WORDS.some((w) => h.includes(w))) return "pos";
  return "";
}

// Kelas hasil utk kolom BAIK|RUSAK / Ada|Tidak ada: positif → kolom kiri, negatif → kanan.
function hasilSide(hasil: string, row: FormRowDef, sec: FormSectionDef): "L" | "R" | "" {
  const h = norm(hasil);
  if (!h) return "";
  if (h === norm(sec.colR)) return "R";
  if (h === norm(sec.colL)) return "L";
  return polarity(hasil) === "neg" ? "R" : polarity(hasil) === "pos" ? "L" : "";
}

// Polarity syarat dibaca dari KATA AWAL ("Baik (Tidak Rantas...)" = positif;
// "Tidak ada retak..." = negatif). Fallback ke scan kata hanya bila awal tidak terbaca.
function polarityStart(text: string): "pos" | "neg" | "" {
  const h = norm(text);
  if (!h) return "";
  for (const w of NEG_WORDS) if (h.startsWith(w)) return "neg";
  for (const w of POS_WORDS) if (h.startsWith(w)) return "pos";
  return polarity(text);
}

// ✓/✗ kolom KESESUAIAN: hasil dibandingkan dgn PERSYARATAN baris (bukan posisi kolom).
function kesesuaianMark(hasil: string, row: FormRowDef): "✓" | "✗" | "" {
  const h = norm(hasil);
  if (!h) return "";
  if (row.persyaratan && h === norm(row.persyaratan)) return "✓";
  const reqP = polarityStart(row.persyaratan || "");
  const resP = polarity(hasil);
  if (reqP && resP) return reqP === resP ? "✓" : "✗";
  return "";
}

// Hasil final unit: tahap gudang bila ada (verifikasi akhir), selain itu tahap pengawas.
function finalItems(unit: ReturUnitDetail): Map<string, ReturItemCek> {
  const m = new Map<string, ReturItemCek>();
  for (const it of unit.items) {
    const key = norm(it.itemLabel);
    const prev = m.get(key);
    if (!prev || (prev.stage === "pengawas" && it.stage === "gudang")) m.set(key, it);
  }
  return m;
}

// Levenshtein sederhana utk pencocokan longgar label (typo pada template definisi).
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Label baris definisi ≈ label item checklist: sama persis, salah satu prefix (definisi
// sering diberi catatan "(...)" ), atau beda ringan (typo) utk label panjang.
function labelsClose(rowLabel: string, itemKey: string): boolean {
  const a = norm(rowLabel);
  if (a === itemKey) return true;
  const strip = norm(rowLabel.replace(/\([^)]*\)/g, " "));
  if (strip && (strip === itemKey || (strip.length > 10 && itemKey.startsWith(strip)))) return true;
  if (a.length > 10 && itemKey.length > 10 && (a.startsWith(itemKey) || itemKey.startsWith(a))) return true;
  return Math.min(a.length, itemKey.length) >= 12 && editDistance(a, itemKey) <= 2;
}

// ── Fasa MCB/MCCB — judul sheet & jumlah otomatis ────────────────────────────────
// Material MCB/MCCB berbentuk kode "MCB 3PH 16A" / "MCCB 3PH 100A". Dari sana kita ambil
// fasa (1PH/3PH) → judul formulir + pengelompokan sheet, dan arus (16A) → baris ARUS yang
// diisi dengan jumlah unit dari app (mode sampling).
function parsePhaseMaterial(code: string | null | undefined): { device: string; fasa: number; arus: string } | null {
  if (!code) return null;
  const m = /^\s*(MCB|MCCB)\s+(\d+)\s*PH\s+(\d+)\s*A\s*$/i.exec(code);
  if (!m) return null;
  return { device: m[1].toUpperCase(), fasa: Number(m[2]), arus: `${m[3]}A` };
}

// Kode human-readable material unit (dari detail unit, lalu materials[], lalu dokumen).
function unitMaterialCode(unit: ReturUnitDetail, detail: ReturDetail): string | null {
  if (unit.materialCode) return unit.materialCode;
  const mats = detail.materials ?? [];
  const mat = mats.find((m) => (unit.materialId != null ? m.id === unit.materialId : detail.materialId === m.id));
  if (mat?.code) return mat.code;
  return detail.materialCode ?? null;
}

// Jumlah unit user input (mode sampling) utk material unit ini — null bila non-sampling/legacy.
function unitJumlahUnit(unit: ReturUnitDetail, detail: ReturDetail): number | null {
  const mats = detail.materials ?? [];
  const mat = mats.find((m) => (unit.materialId != null ? m.id === unit.materialId : detail.materialId === m.id));
  const ju = mat?.jumlahUnit ?? detail.jumlahUnit ?? null;
  return typeof ju === "number" && ju >= 1 ? ju : null;
}

function sheetName(label: string, idx: number, prefix?: string): string {
  const base = label || `Unit ${idx + 1}`;
  const raw = prefix ? `${prefix} ${base}` : base;
  const clean = raw.replace(/[\[\]:*?/\\']/g, " ").slice(0, 31);
  return clean || `Unit ${idx + 1}`;
}

function tanggalIndonesia(iso: string): { hari: string; tanggal: string; bulan: string; tahun: string } {
  const d = new Date(iso);
  const hari = d.toLocaleDateString("id-ID", { weekday: "long" });
  return {
    hari,
    tanggal: String(d.getDate()).padStart(2, "0"),
    bulan: d.toLocaleDateString("id-ID", { month: "long" }),
    tahun: String(d.getFullYear()),
  };
}

function put(ws: exceljsNs.Worksheet, addr: string, value: string, opts: { bold?: boolean; border?: boolean; align?: Alignment; strike?: boolean } = {}): void {
  const c = ws.getCell(addr);
  c.value = value;
  c.font = { ...FONT, ...(opts.bold ? { bold: true } : {}), ...(opts.strike ? { strike: true } : {}) };
  if (opts.border) c.border = BORDER;
  if (opts.align) c.alignment = { vertical: "middle", ...opts.align } as unknown as exceljsNs.Alignment;
}

function rowCells(ws: exceljsNs.Worksheet, r: number, from: string, to: string, fn: (addr: string) => void): void {
  const start = ws.getColumn(from).number;
  const end = ws.getColumn(to).number;
  const row = ws.getRow(r);
  for (let col = start; col <= end; col++) row.getCell(col).address && fn(row.getCell(col).address);
}

// defsByMaterial: dokumen multi-material — tiap unit pakai definisi formulir material miliknya.
export function buildFormWorkbook(def: FormDefinition, detail: ReturDetail, defsByMaterial?: Record<number, FormDefinition>) {
  const multi = (detail.materials?.length ?? 0) > 1;
  const units = [...detail.units].sort((a, b) => phaseRank(a, detail) - phaseRank(b, detail));
  const wb = new ExcelJS.Workbook();
  units.forEach((unit, ui) => {
    const d = (unit.materialId != null && defsByMaterial?.[unit.materialId]) || def;
    const phase = parsePhaseMaterial(unitMaterialCode(unit, detail));
    const prefix = phase ? `${phase.device} ${phase.fasa} PHASA` : multi ? (unit.materialName ?? detail.materialName) : undefined;
    buildFormSheet(wb, d, detail, unit, ui, prefix);
  });
  return wb;
}

// Kelompokkan sheet per fasa (3PH dulu, lalu 1PH) — utk cetak banyak dokumen sekaligus.
function phaseRank(unit: ReturUnitDetail, detail: ReturDetail): number {
  const phase = parsePhaseMaterial(unitMaterialCode(unit, detail));
  if (!phase) return 2;
  return phase.fasa >= 3 ? 0 : 1;
}

// Cetak banyak dokumen (material) sekaligus: SATU file Excel, satu sheet per unit per
// dokumen. Sampling tetap 1 unit per material — sheet dinamai "<material> Dok<id>" agar
// tidak bentrok antar dokumen (satu material bisa muncul di dokumen berbeda). Sheet diurutkan
// per fasa (3PH → 1PH) supaya dokumen campuran tetap mudah dibaca.
export interface FormWorkbookEntry { def: FormDefinition; detail: ReturDetail; defsByMaterial?: Record<number, FormDefinition> }

export function buildMultiFormWorkbook(entries: FormWorkbookEntry[]) {
  const sheets: { def: FormDefinition; detail: ReturDetail; unit: ReturUnitDetail; prefix: string; rank: number }[] = [];
  for (const { def, detail, defsByMaterial } of entries) {
    for (const unit of detail.units) {
      const d = (unit.materialId != null && defsByMaterial?.[unit.materialId]) || def;
      const phase = parsePhaseMaterial(unitMaterialCode(unit, detail));
      const prefix = phase ? `${phase.device} ${phase.fasa} PHASA Dok${detail.id}` : `${unit.materialName ?? detail.materialName} Dok${detail.id}`;
      sheets.push({ def: d, detail, unit, prefix, rank: phase ? (phase.fasa >= 3 ? 0 : 1) : 2 });
    }
  }
  sheets.sort((a, b) => a.rank - b.rank);
  const wb = new ExcelJS.Workbook();
  sheets.forEach((s, i) => buildFormSheet(wb, s.def, s.detail, s.unit, i, s.prefix));
  return wb;
}

function buildFormSheet(wb: exceljsNs.Workbook, def: FormDefinition, detail: ReturDetail, unit: ReturUnitDetail, unitIdx: number, prefix?: string): void {
  const phase = parsePhaseMaterial(unitMaterialCode(unit, detail));
  const ws = wb.addWorksheet(sheetName(unit.label, unitIdx, prefix));
  ws.columns = COL_W.map((width) => ({ width }));
  const items = finalItems(unit);
  const matched = new Set<string>();
  let r = 1;

  const cell = (col: string, value: string, opts: { bold?: boolean; border?: boolean; align?: Alignment; strike?: boolean } = {}) => put(ws, `${col}${r}`, value, opts);

  // Judul cetak mengikuti fasa material ("MCB 3 PHASA"), bukan tetap "MCB/MCCB".
  const printedTitle = phase ? `FORMULIR INSPEKSI MATERIAL RETUR ${phase.device} ${phase.fasa} PHASA` : def.title;

  // ── Header kop formulir ────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:G${r}`); cell("A", def.header.line1, { bold: true }); cell("H", def.formCode, { align: { horizontal: "right" } }); r++;
  ws.mergeCells(`A${r}:H${r}`); cell("A", def.header.line2); r++;
  ws.mergeCells(`A${r}:H${r}`); cell("A", def.header.line3); r += 4; // jarak identik contoh (title di baris ~7)

  ws.mergeCells(`A${r}:H${r}`); cell("A", printedTitle, { bold: true, align: { horizontal: "center" } }); r++;
  ws.mergeCells(`A${r}:H${r}`); cell("A", `NO: ${detail.id}`); r += 3;

  const t = tanggalIndonesia(detail.checkedAt);
  ws.mergeCells(`B${r}:H${r + 1}`);
  cell("B", `Pada hari ini ${t.hari} tanggal ${t.tanggal} bulan ${t.bulan} tahun ${t.tahun} telah diadakan inspeksi material retur ${def.intro} dengan data sebagai berikut:`, { align: { wrapText: true } });
  r += 3;

  // ── A. DATA MATERIAL (kiri kolom B, kanan kolom F) ────────────────────────────
  cell("A", "A", { border: true, align: { horizontal: "center", vertical: "top" } });
  ws.mergeCells(`B${r}:H${r}`); cell("B", "DATA MATERIAL", { bold: true, border: true });
  rowCells(ws, r, "C", "H", (a) => { ws.getCell(a).border = BORDER; });
  r++;
  const fieldsLeft = def.fields.left ?? [];
  const fieldsRight = def.fields.right ?? [];
  const fieldRowspan = Math.max(fieldsLeft.length, fieldsRight.length);
  for (let i = 0; i < fieldRowspan; i++) {
    const fl = fieldsLeft[i];
    const fr = fieldsRight[i];
    if (fl) {
      ws.mergeCells(`B${r}:D${r}`);
      cell("B", `${fl.label}: ${displayValue(unit, fl.key)}${fl.hint ? `  (${fl.hint})` : ""}`, { align: { wrapText: true } });
    }
    if (fr) {
      ws.mergeCells(`F${r}:H${r}`);
      cell("F", `${fr.label}: ${displayValue(unit, fr.key)}${fr.hint ? `  (${fr.hint})` : ""}`, { align: { wrapText: true } });
    }
    r++;
  }
  r++;

  // ── Seksi pemeriksaan (B/C/D...) — satu tabel per seksi ───────────────────────
  const defRowsBySection = new Map<string, FormRowDef[]>();
  for (const row of def.rows ?? []) {
    const kode = row.section ?? def.sections[0]?.kode ?? "B";
    if (!defRowsBySection.has(kode)) defRowsBySection.set(kode, []);
    defRowsBySection.get(kode)!.push(row);
  }
  const autoNo = (n: number) => `${n}.0`;

  for (const sec of def.sections) {
    cell("A", sec.kode, { border: true, align: { horizontal: "center", vertical: "top" } });
    ws.mergeCells(`B${r}:H${r}`); cell("B", sec.judul, { bold: true, border: true });
    rowCells(ws, r, "C", "H", (a) => { ws.getCell(a).border = BORDER; });
    r++;

    // ── Mode JUMLAH (revisi form kWh/MCB): tabel ringkas, bukan daftar item checklist ──
    if (sec.jumlah) {
      const cols = sec.jumlahCols ?? ["ARUS", "JUMLAH", "KETERANGAN"];
      const h1 = r, h2 = r + 1;
      cell("B", cols[0] ?? "", { bold: true, border: true, align: { horizontal: "center", vertical: "middle", wrapText: true } });
      ws.mergeCells(`B${h1}:B${h2}`);
      ws.getCell(`B${h2}`).border = BORDER;
      cell("C", cols[1] ?? "", { bold: true, border: true, align: { horizontal: "center", vertical: "middle", wrapText: true } });
      ws.mergeCells(`C${h1}:C${h2}`);
      ws.getCell(`C${h2}`).border = BORDER;
      cell("D", cols[2] ?? "", { bold: true, border: true, align: { horizontal: "center", vertical: "middle", wrapText: true } });
      ws.mergeCells(`D${h1}:F${h2}`);
      rowCells(ws, h1, "E", "F", (a) => { ws.getCell(a).border = BORDER; });
      rowCells(ws, h2, "E", "F", (a) => { ws.getCell(a).border = BORDER; });
      ws.getCell(`D${h2}`).border = BORDER;
      r = h2 + 1;
      // Otomatis isi kolom JUMLAH baris ARUS yang sesuai material (mode sampling):
      // jumlah unit = user menginput "Jumlah unit seluruhnya" di tab Buat.
      const jumlahUnit = unitJumlahUnit(unit, detail);
      const matchArus = phase?.arus ?? null;
      // Baris ARUS yang kebetulan hilang di seed (mis. 16A yang ada di materials tapi tidak
      // di jumlahRows) ikut ditambahkan otomatis, diurutkan numerik.
      const _rawRows = [...(sec.jumlahRows?.length ? sec.jumlahRows : [""])];
      if (matchArus && !_rawRows.some((l) => norm(l) === norm(matchArus))) _rawRows.push(matchArus);
      const _arusNum = (s: string): number => { const m = /(\d+)/.exec(s); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };
      const jumlahRows = _rawRows.sort((a, b) => _arusNum(a) - _arusNum(b));
      for (const lbl of jumlahRows) {
        const isMatch = !!matchArus && norm(lbl) === norm(matchArus);
        cell("B", lbl, { border: true, align: { horizontal: "center", vertical: "middle" } });
        cell("C", isMatch && jumlahUnit ? String(jumlahUnit) : "", { border: true, align: { horizontal: "center", vertical: "middle" } });
        cell("D", "", { border: true, align: { horizontal: "center", vertical: "middle" } });
        ws.mergeCells(`D${r}:F${r}`);
        ws.getCell(`E${r}`).border = BORDER;
        ws.getCell(`F${r}`).border = BORDER;
        r++;
      }
      // ── Tabel komponen pemeriksaan (utk form JUMLAH: MCB/kWh) ─────────────
      // Hasil komponen yang wajib diisi pengawas tetap tampil di form cetak.
      if (items.size > 0) {
        const t0 = r;
        cell("A", "", { border: true });
        ws.mergeCells(`B${t0}:H${t0}`);
        cell("B", "KOMPONEN PEMERIKSAAN", { bold: true, border: true, align: { horizontal: "center" } });
        rowCells(ws, t0, "C", "H", (a) => { ws.getCell(a).border = BORDER; });
        r = t0 + 1;
        const h3 = r;
        cell("B", "NO", { bold: true, border: true, align: { horizontal: "center" } });
        cell("C", "MATA UJI", { bold: true, border: true, align: { horizontal: "center" } });
        ws.mergeCells(`D${h3}:E${h3}`); cell("D", "HASIL", { bold: true, border: true, align: { horizontal: "center" } }); ws.getCell(`E${h3}`).border = BORDER;
        cell("F", "KETERANGAN", { bold: true, border: true, align: { horizontal: "center" } });
        ws.mergeCells(`F${h3}:H${h3}`); rowCells(ws, h3, "G", "H", (a) => { ws.getCell(a).border = BORDER; });
        r = h3 + 1;
        let no = 0;
        for (const [, item] of items) {
          no++;
          const side = hasilSide(item.hasil, {} as FormRowDef, { kode: "", judul: "", colL: "", colR: "" });
          const dVal = side === "L" ? "\u2713" : side === "R" ? "\u2717" : (item.hasil || "");
          cell("B", autoNo(no), { border: true, align: { horizontal: "center", vertical: "middle" } });
          cell("C", item.itemLabel, { border: true, align: { wrapText: true, vertical: "middle" } });
          ws.mergeCells(`D${r}:E${r}`);
          cell("D", dVal, { border: true, align: { horizontal: "center", vertical: "middle" } }); ws.getCell(`E${r}`).border = BORDER;
          ws.mergeCells(`F${r}:H${r}`);
          cell("F", item.catatan ?? "", { border: true, align: { wrapText: true, vertical: "middle" } });
          rowCells(ws, r, "G", "H", (a) => { ws.getCell(a).border = BORDER; });
          r++;
        }
        r += 2;
      }
      r += 2;
      continue;
    }

    const hR = r;
    cell("B", "NO", { bold: true, border: true, align: { horizontal: "center" } });
    cell("C", "MATA UJI", { bold: true, border: true, align: { horizontal: "center" } });
    ws.mergeCells(`D${hR}:E${hR}`); cell("D", "HASIL PEMERIKSAAN", { bold: true, border: true, align: { horizontal: "center" } }); ws.getCell(`E${hR}`).border = BORDER;
    cell("F", "PERSYARATAN", { bold: true, border: true, align: { horizontal: "center" } });
    cell("G", "KESESUAIAN", { bold: true, border: true, align: { horizontal: "center" } });
    cell("H", "KETERANGAN", { bold: true, border: true, align: { horizontal: "center" } });
    r++;
    if (sec.nilaiSatuan) {
      ws.mergeCells(`B${hR}:B${r}`); ws.mergeCells(`C${hR}:C${r}`); ws.mergeCells(`F${hR}:F${r}`); ws.mergeCells(`G${hR}:G${r}`); ws.mergeCells(`H${hR}:H${r}`);
      cell("D", "Nilai", { bold: true, border: true, align: { horizontal: "center" } });
      cell("E", "Satuan", { bold: true, border: true, align: { horizontal: "center" } });
    } else {
      ws.mergeCells(`B${hR}:B${r}`); ws.mergeCells(`C${hR}:C${r}`); ws.mergeCells(`F${hR}:F${r}`); ws.mergeCells(`G${hR}:G${r}`); ws.mergeCells(`H${hR}:H${r}`);
      cell("D", sec.colL, { bold: true, border: true, align: { horizontal: "center" } });
      cell("E", sec.colR, { bold: true, border: true, align: { horizontal: "center" } });
    }
    r++;

    let autoIdx = 1;
    for (const row of defRowsBySection.get(sec.kode) ?? []) {
      let item = items.get(norm(row.label));
      if (!item) {
        for (const [key, cand] of items) {
          if (!matched.has(key) && labelsClose(row.label, key)) { item = cand; break; }
        }
      }
      if (item) matched.add(norm(item.itemLabel));
      const hasil = item?.hasil ?? "";
      const indent = " ".repeat((row.level ?? 0) * 3);
      cell("B", row.no || "", { border: true, align: { horizontal: "center", vertical: "top" } });
      cell("C", `${indent}${row.label}`, { border: true, align: { wrapText: true, vertical: "top" } });
      if (sec.nilaiSatuan) {
        // kolom Nilai/Satuan: teks hasil (mis. "Baik") atau angka dimensi; satuan dari definisi.
        cell("D", hasil || (row.textValue ?? ""), { border: true, align: { horizontal: "center" } });
        cell("E", row.satuan ?? "-", { border: true, align: { horizontal: "center" } });
        cell("F", row.persyaratan ?? "", { border: true, align: { wrapText: true } });
        cell("G", kesesuaianMark(hasil, row), { border: true, align: { horizontal: "center" } });
      } else {
        const side = hasilSide(hasil, row, sec);
        let dText = side === "L" ? "✓" : "";
        let eText = side === "R" ? "✗" : "";
        let gMark = kesesuaianMark(hasil, row);
        if (!side && hasil && row.textValue) {
          // Baris nilai teks (mis. "Masa pakai … tahun"): tampilkan angkanya + satuan,
          // kesesuaian dibandingkan batas numerik pada persyaratan (mis. "< 5 tahun").
          const val = hasil.trim();
          dText = /^\d+(?:[.,]\d+)?$/.test(val) ? `${val} ${row.textValue}` : val;
          const batas = row.persyaratan?.match(/(<|>)\s*(\d+)/);
          if (batas && /^\d+(?:[.,]\d+)?$/.test(val)) {
            const num = parseFloat(val.replace(",", "."));
            const lim = parseInt(batas[2], 10);
            gMark = batas[1] === "<" ? (num < lim ? "✓" : "✗") : num > lim ? "✓" : "✗";
          }
        }
        cell("D", dText, { border: true, align: { horizontal: "center" } });
        cell("E", eText, { border: true, align: { horizontal: "center" } });
        cell("F", row.persyaratan ?? "", { border: true, align: { wrapText: true } });
        cell("G", gMark, { border: true, align: { horizontal: "center" } });
      }
      const ketParts = [row.ket, item?.catatan].filter((x) => x && x.trim());
      cell("H", ketParts.join(" — "), { border: true, align: { wrapText: true, vertical: "top" } });
      r++;
    }

    // Item hasil ceklist yang TIDAK ada di tabel contoh → ditampilkan tetap dengan
    // format tabel yang sama (instruksi user), di bawah baris definisi seksi ini.
    for (const [key, item] of items) {
      if (matched.has(key) || norm(item.itemLabel) !== key) continue;
      // hanya item tanpa padanan definisi; hindari duplikat label
      const hasMatch = (def.rows ?? []).some((dr) => norm(dr.label) === key);
      if (hasMatch) continue;
      matched.add(key);
      cell("B", autoNo((defRowsBySection.get(sec.kode)?.length ?? 0) + autoIdx++), { border: true, align: { horizontal: "center" } });
      cell("C", item.itemLabel, { border: true, align: { wrapText: true } });
      const side = hasilSide(item.hasil, {} as FormRowDef, sec);
      // hasil bukan kutub kolom L/R (mis. angka/teks data: daya, tahun, berat): tampilkan nilainya apa adanya.
      const dOut = side === "L" ? "✓" : side === "R" ? "" : (item.hasil || "");
      cell("D", dOut, { border: true, align: { horizontal: "center", wrapText: true, vertical: "top" } });
      cell("E", side === "R" ? "✗" : "", { border: true, align: { horizontal: "center" } });
      cell("F", "", { border: true });
      cell("G", "", { border: true, align: { horizontal: "center" } });
      cell("H", item.catatan ?? "", { border: true, align: { wrapText: true } });
      r++;
    }
    r += 2;
  }

  // ── Seksi kesimpulan (huruf setelah seksi pemeriksaan terakhir) ────────────────
  const fk = unit.formKeputusan;
  if (def.kesimpulan) {
    const nextKode = String.fromCharCode((def.sections[def.sections.length - 1]?.kode.charCodeAt(0) ?? 66) + 1);
    cell("A", nextKode, { border: true, align: { horizontal: "center", vertical: "top" } });
    ws.mergeCells(`B${r}:H${r}`); cell("B", "KESIMPULAN", { bold: true, border: true });
    rowCells(ws, r, "C", "H", (a) => { ws.getCell(a).border = BORDER; });
    r++;

    if (def.kesimpulan.mode === "meter") {
      for (const opt of def.kesimpulan.options) {
        const meterVal = fk?.[opt.meterKey as keyof typeof fk];
        ws.mergeCells(`B${r}:H${r}`);
        cell("B", `${opt.label} ${meterVal ? `${meterVal}` : "......................"} meter`, {
          bold: true,
          strike: !!fk && fk.code !== opt.code,
        });
        r++;
      }
    } else {
      const parts = def.kesimpulan.options.map((opt) => ({ text: opt.label, strike: !!fk ? fk.code !== opt.code : false }));
      ws.mergeCells(`B${r}:H${r}`);
      const c = ws.getCell(`B${r}`);
      c.value = {
        richText: [
          { text: "*) " },
          ...parts.flatMap((p, i) => [
            { text: p.text, font: { ...FONT, strike: p.strike } },
            ...(i < parts.length - 1 ? [{ text: " / " }] : []),
          ]),
        ],
      };
      r++;
    }
    if (def.note) { ws.mergeCells(`B${r}:H${r}`); cell("B", def.note, { bold: true }); r++; }
    r++;
  }

  // ── Blok tanda tangan ──────────────────────────────────────────────────────────
  ws.mergeCells(`E${r}:G${r}`); cell("E", "DISETUJUI OLEH", { align: { horizontal: "center" } }); r++;
  ws.mergeCells(`B${r}:C${r}`); cell("B", def.signature.left, { align: { horizontal: "center" } });
  ws.mergeCells(`F${r}:G${r}`); cell("F", def.signature.right, { align: { horizontal: "center" } });
  for (let i = 0; i < 4; i++) r++; // ruang tanda tangan tangan
  ws.mergeCells(`B${r}:C${r}`); cell("B", detail.pengawasName ?? "…"); r++;
  ws.mergeCells(`B${r}:C${r}`); cell("B", detail.pengawasCompany ?? "…", { align: { horizontal: "center" } }); r++;
  ws.mergeCells(`F${r - 2}:G${r - 2}`); cell("F", detail.gudangName ?? "…");
  ws.mergeCells(`F${r - 1}:G${r - 1}`); cell("F", detail.gudangCompany ?? "…", { align: { horizontal: "center" } }); r += 1;
  r++;

  // ── Legenda ────────────────────────────────────────────────────────────────────
  cell("B", "Keterangan:");
  cell("C", "…");
  r++;
  for (const lg of def.legend ?? []) {
    cell("B", lg.mark); cell("C", lg.label); r++;
  }
  cell("B", "*)"); cell("C", def.coretNote ?? "coret yang tidak diperlukan");

  ws.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
}

function displayValue(unit: ReturUnitDetail, key: string): string {
  const v = unit.formData?.[key] ?? (key === "sn" && unit.sn ? unit.sn : "");
  return v ? String(v) : DOTS;
}

export function formFilename(detail: ReturDetail): string {
  const mat = detail.materialName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 30);
  return `Formulir-Inspeksi-Dok${detail.id}-${mat}.xlsx`;
}
