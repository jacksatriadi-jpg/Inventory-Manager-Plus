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

function sheetName(label: string, idx: number): string {
  const clean = (label || `Unit ${idx + 1}`).replace(/[[\]:*?/\\']/g, " ").slice(0, 28);
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

function put(ws: ExcelJS.Worksheet, addr: string, value: string, opts: { bold?: boolean; border?: boolean; align?: ExcelJS.Alignment; strike?: boolean } = {}): void {
  const c = ws.getCell(addr);
  c.value = value;
  c.font = { ...FONT, ...(opts.bold ? { bold: true } : {}), ...(opts.strike ? { strike: true } : {}) };
  if (opts.border) c.border = BORDER;
  if (opts.align) c.alignment = { vertical: "middle", ...opts.align };
}

function rowCells(ws: ExcelJS.Worksheet, r: number, from: string, to: string, fn: (addr: string) => void): void {
  const start = ws.getColumn(from).number;
  const end = ws.getColumn(to).number;
  const row = ws.getRow(r);
  for (let col = start; col <= end; col++) row.getCell(col).address && fn(row.getCell(col).address);
}

export function buildFormWorkbook(def: FormDefinition, detail: ReturDetail) {
  const wb = new ExcelJS.Workbook();
  detail.units.forEach((unit, ui) => buildFormSheet(wb, def, detail, unit, ui));
  return wb;
}

function buildFormSheet(wb: ExcelJS.Workbook, def: FormDefinition, detail: ReturDetail, unit: ReturUnitDetail, unitIdx: number): void {
  const ws = wb.addWorksheet(sheetName(unit.label, unitIdx));
  ws.columns = COL_W.map((width) => ({ width }));
  const items = finalItems(unit);
  const matched = new Set<string>();
  let r = 1;

  const cell = (col: string, value: string, opts: Parameters<typeof put>[2] = {}) => put(ws, `${col}${r}`, value, opts);

  // ── Header kop formulir ────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:G${r}`); cell("A", def.header.line1, { bold: true }); cell("H", def.formCode, { align: { horizontal: "right" } }); r++;
  ws.mergeCells(`A${r}:H${r}`); cell("A", def.header.line2); r++;
  ws.mergeCells(`A${r}:H${r}`); cell("A", def.header.line3); r += 4; // jarak identik contoh (title di baris ~7)

  ws.mergeCells(`A${r}:H${r}`); cell("A", def.title, { bold: true, align: { horizontal: "center" } }); r++;
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
      const item = items.get(norm(row.label));
      if (item) matched.add(norm(row.label));
      const hasil = item?.hasil ?? "";
      const indent = " ".repeat((row.level ?? 0) * 3);
      cell("B", row.no || "", { border: true, align: { horizontal: "center", vertical: "top" } });
      cell("C", `${indent}${row.label}`, { border: true, align: { wrapText: true, vertical: "top" } });
      if (sec.nilaiSatuan) {
        // kolom Nilai/Satuan: teks hasil (mis. "Baik") atau angka dimensi; satuan dari definisi.
        cell("D", hasil || (row.textValue ?? ""), { border: true, align: { horizontal: "center" } });
        cell("E", row.satuan ?? "-", { border: true, align: { horizontal: "center" } });
        cell("F", row.persyaratan, { border: true, align: { wrapText: true } });
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
        cell("F", row.persyaratan, { border: true, align: { wrapText: true } });
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
      cell("B", autoNo(defRowsBySection.get(sec.kode)!.length + autoIdx++), { border: true, align: { horizontal: "center" } });
      cell("C", item.itemLabel, { border: true, align: { wrapText: true } });
      cell("D", hasilSide(item.hasil, {} as FormRowDef, sec) === "L" ? "✓" : "", { border: true, align: { horizontal: "center" } });
      cell("E", hasilSide(item.hasil, {} as FormRowDef, sec) === "R" ? "✗" : "", { border: true, align: { horizontal: "center" } });
      cell("F", "", { border: true });
      cell("G", "", { border: true, align: { horizontal: "center" } });
      cell("H", item.catatan ?? "", { border: true, align: { wrapText: true } });
      r++;
    }
    r += 2;
  }

  // ── Seksi kesimpulan (huruf setelah seksi pemeriksaan terakhir) ────────────────
  const nextKode = String.fromCharCode((def.sections[def.sections.length - 1]?.kode.charCodeAt(0) ?? 66) + 1);
  cell("A", nextKode, { border: true, align: { horizontal: "center", vertical: "top" } });
  ws.mergeCells(`B${r}:H${r}`); cell("B", "KESIMPULAN", { bold: true, border: true });
  rowCells(ws, r, "C", "H", (a) => { ws.getCell(a).border = BORDER; });
  r++;

  const fk = unit.formKeputusan;
  if (def.kesimpulan?.mode === "meter") {
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
  cell("C", "");
  r++;
  cell("B", "✓"); cell("C", "sesuai"); r++;
  cell("B", "✗"); cell("C", "tidak sesuai"); r++;
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
