/**
 * Barcode Tools — konversi banyak barcode dari PDF / Excel menjadi satu QR Code inspeksi
 * Printer target: SATO CL4NX Plus, ukuran kertas 7cm × 3cm (70mm × 30mm)
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  QrCode, Printer, X, CheckCircle2, AlertTriangle, Loader2,
  FileSpreadsheet, UploadCloud, RefreshCw, Plus, Download,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InspectionItem {
  nomorInspeksi: string;
  tglInspeksi: string;   // DD-MM-YYYY displayed, stored as-is
  noMaterial: string;    // barcode / material number
  namaMaterial: string;
  qty: string;
}

// ─── PDF.js initialisation ─────────────────────────────────────────────────

let _pdfjsLib: any = null;
async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
  }
  _pdfjsLib = lib;
  return lib;
}

async function renderPageToCanvas(page: any, scale = 2.5): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return canvas;
}

async function readBarcodeFromCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/library");
    const codeReader = new BrowserMultiFormatReader();
    return await new Promise<string | null>((resolve) => {
      const img = document.createElement("img");
      img.onload = async () => {
        try { resolve((await codeReader.decodeFromImageElement(img)).getText()); }
        catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = canvas.toDataURL("image/png");
    });
  } catch { return null; }
}

async function extractBarcodesFromPdf(
  file: File,
  onProgress: (cur: number, tot: number) => void,
): Promise<string[]> {
  const lib = await getPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const results: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(i, pdf.numPages);
    try {
      const v = await readBarcodeFromCanvas(await renderPageToCanvas(await pdf.getPage(i), 2.5));
      if (v) results.push(v.trim());
    } catch { /* skip */ }
  }
  return results;
}

// ─── Excel template ─────────────────────────────────────────────────────────

const EXAMPLE_ROWS: InspectionItem[] = [
  { nomorInspeksi: "55UTR2607210026", tglInspeksi: "21-07-2026", noMaterial: "00000000000002090032", namaMaterial: "LA;20-24kV;K;10kA;POLYMER;;",              qty: "1" },
  { nomorInspeksi: "55UTR2607210024", tglInspeksi: "21-07-2026", noMaterial: "00000000000001030077", namaMaterial: "TRF DIS;D3;20kV/400V;3P;250kVA;DYN5;OD",  qty: "1" },
  { nomorInspeksi: "55UTR2607210021", tglInspeksi: "21-07-2026", noMaterial: "00000000000003250026", namaMaterial: "MCB;380/440V;3P;300A;50Hz;MCCB",            qty: "1" },
  { nomorInspeksi: "55UTR2607210019", tglInspeksi: "21-07-2026", noMaterial: "00000000000003280469", namaMaterial: "CONN;20KV;LLC;AL;70-240MM2;BOLT;PERMANEN", qty: "3" },
  { nomorInspeksi: "55UTR2607210018", tglInspeksi: "21-07-2026", noMaterial: "00000000000003030006", namaMaterial: "POLE;CONCRETE;20kV;CIRCL;13m;350daN;;",   qty: "1" },
];

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // ── Sheet: Form Inspeksi ────────────────────────────────────────────────
  const header = ["No Inspeksi", "Tgl Inspeksi", "No Material", "Nama Material", "QTY"];
  const dataRows = EXAMPLE_ROWS.map((r) => [
    r.nomorInspeksi, r.tglInspeksi, r.noMaterial, r.namaMaterial, Number(r.qty),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  ws["!cols"] = [
    { wch: 22 }, // No Inspeksi
    { wch: 16 }, // Tgl Inspeksi
    { wch: 24 }, // No Material
    { wch: 48 }, // Nama Material
    { wch:  8 }, // QTY
  ];

  // Keep date column as text so Excel doesn't auto-convert
  for (let r = 1; r <= dataRows.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (cell) cell.t = "s";
    const qtyCell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
    if (qtyCell) qtyCell.t = "n";
  }

  XLSX.utils.book_append_sheet(wb, ws, "Form Inspeksi");

  // ── Sheet: Petunjuk ─────────────────────────────────────────────────────
  const wsPetunjuk = XLSX.utils.aoa_to_sheet([
    ["PETUNJUK PENGISIAN TEMPLATE"],
    [""],
    ["Kolom",         "Format",       "Contoh",               "Keterangan"],
    ["No Inspeksi",   "Teks",         "55UTR2607210026",      "Nomor inspeksi unik per item"],
    ["Tgl Inspeksi",  "DD-MM-YYYY",   "21-07-2026",           "Tanggal inspeksi"],
    ["No Material",   "Teks/Angka",   "00000000000002090032", "Nomor material / nilai barcode"],
    ["Nama Material", "Teks",         "LA;20-24kV;K;10kA",    "Nama atau deskripsi material"],
    ["QTY",           "Angka",        "1",                    "Jumlah item"],
    [""],
    ["Catatan:"],
    ["• Hapus baris contoh dan isi dengan data aktual mulai baris 2."],
    ["• Kolom header (baris 1) jangan diubah."],
    ["• Boleh menambah baris sebanyak yang diperlukan."],
    ["• Simpan dalam format .xlsx sebelum diimport."],
  ]);
  wsPetunjuk["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 26 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsPetunjuk, "Petunjuk");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const url = URL.createObjectURL(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  const a = document.createElement("a");
  a.href = url; a.download = "template_inspeksi.xlsx"; a.click();
  URL.revokeObjectURL(url);
}

// ─── Excel / CSV import ─────────────────────────────────────────────────────

const COL_MAP: Record<string, keyof InspectionItem> = {
  "no inspeksi":    "nomorInspeksi",
  "noinspeksi":     "nomorInspeksi",
  "nomor inspeksi": "nomorInspeksi",
  "nomorinspeksi":  "nomorInspeksi",
  "tgl inspeksi":   "tglInspeksi",
  "tglinspeksi":    "tglInspeksi",
  "tanggal":        "tglInspeksi",
  "no material":    "noMaterial",
  "nomaterial":     "noMaterial",
  "nomor material": "noMaterial",
  "nama material":  "namaMaterial",
  "namamaterial":   "namaMaterial",
  "nama":           "namaMaterial",
  "qty":            "qty",
  "jumlah":         "qty",
};

async function parseInspectionFile(file: File): Promise<InspectionItem[] | null> {
  const XLSX = await import("xlsx");
  let wb: any;
  try {
    wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
      type: "array", cellText: true, cellDates: false,
    });
  } catch { return null; }

  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return null;

  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rows.length < 2) return null;

  // Locate header row
  let hdrIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map((c: any) => String(c).toLowerCase().replace(/\s+/g, " ").trim());
    if (cells.some((c: string) => c.includes("inspeksi") || c.includes("material"))) {
      hdrIdx = i; break;
    }
  }
  if (hdrIdx === -1 || hdrIdx + 1 >= rows.length) return null;

  const headers = rows[hdrIdx].map((c: any) =>
    String(c).toLowerCase().replace(/\s+/g, " ").trim(),
  );

  // Map header index → field key
  const colIdx: Partial<Record<keyof InspectionItem, number>> = {};
  headers.forEach((h: string, i: number) => {
    const key = COL_MAP[h] ?? COL_MAP[h.replace(/\s/g, "")];
    if (key) colIdx[key] = i;
  });

  const items: InspectionItem[] = [];
  for (let r = hdrIdx + 1; r < rows.length; r++) {
    const row = rows[r].map((c: any) => String(c).trim());
    if (row.every((c: string) => c === "")) continue; // skip blank rows

    const get = (k: keyof InspectionItem) =>
      colIdx[k] !== undefined ? (row[colIdx[k]!] ?? "") : "";

    items.push({
      nomorInspeksi: get("nomorInspeksi"),
      tglInspeksi:   get("tglInspeksi"),
      noMaterial:    get("noMaterial"),
      namaMaterial:  get("namaMaterial"),
      qty:           get("qty"),
    });
  }

  return items.length > 0 ? items : null;
}

// ─── QR payload & print ────────────────────────────────────────────────────

function buildPayload(items: InspectionItem[]): string {
  return JSON.stringify({
    items: items.map((it) => ({
      no:  it.nomorInspeksi,
      tgl: it.tglInspeksi,
      mat: it.noMaterial,
      nm:  it.namaMaterial,
      qty: it.qty,
    })),
  });
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function printLabel(items: InspectionItem[]): Promise<void> {
  const payload = buildPayload(items);
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M", margin: 4, width: 400,
  });

  // Summary line for the label text area
  const firstNo = items[0]?.nomorInspeksi ?? "—";
  const firstTgl = items[0]?.tglInspeksi ?? "—";
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  @page{size:70mm 30mm;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:70mm;height:30mm;background:#fff;overflow:hidden}
  .label{width:70mm;height:30mm;padding:1.5mm;display:flex;flex-direction:row;align-items:center;gap:1.5mm;font-family:Arial,Helvetica,sans-serif}
  .qr{flex-shrink:0;width:26mm;height:26mm}
  .qr img{width:26mm;height:26mm;display:block;image-rendering:pixelated}
  .info{flex:1;display:flex;flex-direction:column;justify-content:center;gap:0.8mm;overflow:hidden}
  .t1{font-size:6.5pt;font-weight:bold;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t2{font-size:5.5pt;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t3{font-size:4.8pt;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hr{border-top:.3mm solid #ccc;margin:.5mm 0}
</style></head><body>
<div class="label">
  <div class="qr"><img src="${qrDataUrl}" alt="QR"/></div>
  <div class="info">
    <div class="t1">${esc(firstNo)}</div>
    <div class="t2">Tgl: ${esc(firstTgl)}</div>
    <div class="t2">Qty Total: ${totalQty}</div>
    <div class="hr"></div>
    <div class="t3">${items.length} item${items.length !== 1 ? "s" : ""} embedded</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();window.close();},300);};</script>
</body></html>`;

  const w = window.open("", "_blank", "width=700,height=500,menubar=no,toolbar=no");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  else toast.error("Popup diblokir browser. Izinkan popup lalu coba lagi.");
}

// ─── Empty row factory ─────────────────────────────────────────────────────

const emptyItem = (): InspectionItem => ({
  nomorInspeksi: "", tglInspeksi: "", noMaterial: "", namaMaterial: "", qty: "1",
});

// ─── Component ─────────────────────────────────────────────────────────────

export default function BarcodeTools() {
  const [items, setItems] = useState<InspectionItem[]>([emptyItem()]);
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ cur: number; tot: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [qrPreviewUrl, setQrPreviewUrl] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);

  const validItems = items.filter((it) => it.nomorInspeksi.trim() && it.noMaterial.trim());
  const canPrint = validItems.length > 0;

  // Regenerate QR preview whenever items change
  useEffect(() => {
    if (validItems.length === 0) { setQrPreviewUrl(""); return; }
    QRCode.toDataURL(buildPayload(validItems), { errorCorrectionLevel: "M", margin: 4, width: 260 })
      .then(setQrPreviewUrl).catch(() => setQrPreviewUrl(""));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Item editing ──────────────────────────────────────────────────────────

  const updateItem = (idx: number, field: keyof InspectionItem, value: string) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const addRow = () => setItems((prev) => [...prev, emptyItem()]);

  const removeRow = (idx: number) => {
    setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  };

  // ── PDF scanning ──────────────────────────────────────────────────────────

  const processPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { toast.error("Hanya file PDF"); return; }
    setIsPdfProcessing(true);
    setPdfProgress({ cur: 0, tot: 1 });
    try {
      const barcodes = await extractBarcodesFromPdf(file, (cur, tot) => setPdfProgress({ cur, tot }));
      if (barcodes.length === 0) {
        toast.warning("Tidak ada barcode yang terdeteksi di PDF ini");
      } else {
        // Fill noMaterial into existing empty rows, then append extras
        setItems((prev) => {
          const next = [...prev];
          let bIdx = 0;
          for (let i = 0; i < next.length && bIdx < barcodes.length; i++) {
            if (!next[i].noMaterial.trim()) {
              next[i] = { ...next[i], noMaterial: barcodes[bIdx++] };
            }
          }
          // Append remaining barcodes as new rows
          while (bIdx < barcodes.length) {
            next.push({ ...emptyItem(), noMaterial: barcodes[bIdx++] });
          }
          return next;
        });
        toast.success(`${barcodes.length} barcode berhasil dideteksi dari PDF`);
      }
    } catch (err: any) {
      toast.error("Gagal memproses PDF: " + (err?.message ?? "Unknown error"));
    } finally {
      setIsPdfProcessing(false); setPdfProgress(null);
    }
  }, []);

  const handlePdfInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processPdf(f); e.target.value = "";
  };

  // ── Excel import ──────────────────────────────────────────────────────────

  const handleXlsxImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
    try {
      const parsed = await parseInspectionFile(file);
      if (parsed) {
        setItems(parsed);
        toast.success(`${parsed.length} baris berhasil diimport dari ${file.name}`);
      } else {
        toast.error("Format file tidak valid. Gunakan template yang tersedia.");
      }
    } catch { toast.error("Gagal membaca file."); }
  }, []);

  // ── Print ─────────────────────────────────────────────────────────────────

  const handlePrint = async () => {
    if (!canPrint) return;
    setIsPrinting(true);
    try { await printLabel(validItems); }
    catch (err: any) { toast.error("Gagal mencetak: " + (err?.message ?? "Unknown error")); }
    finally { setIsPrinting(false); }
  };

  // ── Template download ─────────────────────────────────────────────────────

  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    try { await downloadTemplate(); }
    catch { toast.error("Gagal membuat template."); }
    finally { setIsDownloading(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <QrCode className="w-6 h-6 text-primary" />
          Barcode Tools
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Gabungkan banyak barcode dari PDF / Excel menjadi satu QR Code inspeksi
          untuk dicetak di label <span className="font-medium">7 × 3 cm</span> (SATO CL4NX Plus).
        </p>
      </div>

      {/* ── Import row ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Import Data</CardTitle>
          <CardDescription className="text-xs">
            Download template Excel, isi datanya, lalu import. Atau scan barcode dari PDF untuk mengisi kolom No Material secara otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline" size="sm"
              disabled={isDownloading}
              onClick={handleDownloadTemplate}
            >
              {isDownloading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Download className="w-4 h-4 mr-2" />}
              Download Template (.xlsx)
            </Button>

            <Button
              variant="outline" size="sm"
              onClick={() => xlsxInputRef.current?.click()}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Import Excel / CSV
            </Button>
            <input
              ref={xlsxInputRef} type="file" accept=".xlsx,.xls,.csv"
              className="hidden" onChange={handleXlsxImport}
            />

            <Button
              variant="outline" size="sm"
              disabled={isPdfProcessing}
              onClick={() => pdfInputRef.current?.click()}
            >
              {isPdfProcessing
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scanning {pdfProgress?.cur}/{pdfProgress?.tot}…</>
                : <><UploadCloud className="w-4 h-4 mr-2" />Scan PDF Barcode</>}
            </Button>
            <input
              ref={pdfInputRef} type="file" accept=".pdf"
              className="hidden" onChange={handlePdfInput}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Editable table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Data Inspeksi</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Edit langsung di tabel. Baris dengan <span className="font-medium">No Inspeksi</span> dan{" "}
                <span className="font-medium">No Material</span> yang terisi akan disertakan dalam QR Code.
              </CardDescription>
            </div>
            <Badge variant="secondary">{items.length} baris</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/60">
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap w-[18%]">No Inspeksi</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap w-[13%]">Tgl Inspeksi</th>
                  <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap w-[18%]">No Material</th>
                  <th className="text-left px-3 py-2.5 font-semibold w-[40%]">Nama Material</th>
                  <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap w-[7%]">QTY</th>
                  <th className="w-[4%]"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, idx) => {
                  const isValid = item.nomorInspeksi.trim() && item.noMaterial.trim();
                  return (
                    <tr
                      key={idx}
                      className={`group transition-colors ${isValid ? "bg-background" : "bg-muted/20"}`}
                    >
                      <td className="px-2 py-1.5">
                        <Input
                          value={item.nomorInspeksi}
                          onChange={(e) => updateItem(idx, "nomorInspeksi", e.target.value)}
                          placeholder="No Inspeksi"
                          className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={item.tglInspeksi}
                          onChange={(e) => updateItem(idx, "tglInspeksi", e.target.value)}
                          placeholder="DD-MM-YYYY"
                          className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={item.noMaterial}
                          onChange={(e) => updateItem(idx, "noMaterial", e.target.value)}
                          placeholder="No Material / Barcode"
                          className={`h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 font-mono ${
                            item.noMaterial && !isValid ? "text-amber-600" : ""
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={item.namaMaterial}
                          onChange={(e) => updateItem(idx, "namaMaterial", e.target.value)}
                          placeholder="Nama Material"
                          className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number" min="0"
                          value={item.qty}
                          onChange={(e) => updateItem(idx, "qty", e.target.value)}
                          className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 text-center"
                        />
                      </td>
                      <td className="pr-2 py-1.5">
                        <button
                          onClick={() => removeRow(idx)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          title="Hapus baris"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t">
            <Button variant="outline" size="sm" onClick={addRow} className="h-7 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Tambah Baris
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Preview & Print ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Preview & Cetak QR Code</CardTitle>
          <CardDescription className="text-xs">
            Preview label <span className="font-medium">7 × 3 cm</span> sebelum dicetak ke SATO CL4NX Plus.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-6 items-start">

            {/* Label preview (3× scale: 70mm×30mm → 210px×90px) */}
            <div className="flex-shrink-0">
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded overflow-hidden bg-white shadow-sm"
                style={{ width: 210, height: 90 }}
                title="Preview 3× — cetak sebenarnya 70mm × 30mm"
              >
                <div className="flex flex-row items-center gap-[4.5px] h-full" style={{ padding: "4.5px", fontFamily: "Arial,Helvetica,sans-serif" }}>
                  {/* QR */}
                  <div className="flex-shrink-0 flex items-center justify-center bg-gray-50" style={{ width: 78, height: 78 }}>
                    {qrPreviewUrl
                      ? <img src={qrPreviewUrl} alt="QR" style={{ width: 78, height: 78, imageRendering: "pixelated" }} />
                      : <QrCode className="w-8 h-8 text-muted-foreground/20" />}
                  </div>
                  {/* Info */}
                  <div className="flex-1 flex flex-col justify-center gap-[2.5px] overflow-hidden min-w-0">
                    <div className="font-bold text-black truncate" style={{ fontSize: 7 }}>
                      {validItems[0]?.nomorInspeksi || <span className="text-gray-300">No Inspeksi</span>}
                    </div>
                    <div className="text-gray-600 truncate" style={{ fontSize: 5.8 }}>
                      Tgl: {validItems[0]?.tglInspeksi || "—"}
                    </div>
                    <div className="text-gray-600 truncate" style={{ fontSize: 5.8 }}>
                      Qty Total: {validItems.reduce((s, it) => s + (Number(it.qty) || 0), 0) || "—"}
                    </div>
                    <div className="border-t border-gray-200 mt-[1.5px] pt-[1px] text-gray-400 truncate" style={{ fontSize: 5 }}>
                      {validItems.length > 0 ? `${validItems.length} item${validItems.length !== 1 ? "s" : ""} embedded` : "—"}
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-1.5">Preview 3× · Cetak: 70 × 30 mm</p>
            </div>

            {/* Status + print */}
            <div className="flex-1 space-y-3">
              {/* Validation */}
              {validItems.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Belum ada baris valid. Isi minimal <strong>No Inspeksi</strong> dan <strong>No Material</strong>.
                </div>
              )}
              {validItems.length > 0 && validItems.length < items.length && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {items.length - validItems.length} baris belum lengkap (kosong/tidak diikutsertakan).
                </div>
              )}
              {validItems.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Siap dicetak — <strong>{validItems.length} item</strong> akan di-encode ke QR Code.
                </div>
              )}

              {/* QR payload preview */}
              {qrPreviewUrl && (
                <div className="bg-muted/40 rounded-md p-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Isi QR Code</p>
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-all leading-relaxed max-h-28 overflow-y-auto">
                    {JSON.stringify({
                      items: validItems.map((it) => ({
                        no: it.nomorInspeksi, tgl: it.tglInspeksi,
                        mat: it.noMaterial,   nm: it.namaMaterial, qty: it.qty,
                      })),
                    }, null, 2)}
                  </pre>
                </div>
              )}

              <Button className="w-full" size="lg" disabled={!canPrint || isPrinting} onClick={handlePrint}>
                {isPrinting
                  ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  : <Printer className="w-5 h-5 mr-2" />}
                Cetak QR Code (SATO CL4NX Plus)
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                QR Code dicetak dengan quiet-zone margin 4 modul — dapat di-scan ulang dengan scanner apapun.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
