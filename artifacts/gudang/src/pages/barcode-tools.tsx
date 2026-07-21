/**
 * Barcode Tools — konversi banyak barcode dari PDF / Excel menjadi satu QR Code inspeksi
 * Printer target: SATO CL4NX Plus, ukuran kertas 7cm × 3cm (70mm × 30mm)
 * QR payload: hanya daftar SN/barcode, satu per baris, tanpa teks tambahan
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  QrCode, Printer, X, CheckCircle2, AlertTriangle, Loader2,
  FileSpreadsheet, UploadCloud, Download, Plus,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────

interface InspectionForm {
  nomorInspeksi: string;
  tanggalInspeksi: string;
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
// Format 5 kolom sesuai contoh gambar

const EXAMPLE_ROWS = [
  ["55UTR2607210026", "21-07-2026", "00000000000002090032", "LA;20-24kV;K;10kA;POLYMER;;",              1],
  ["55UTR2607210024", "21-07-2026", "00000000000001030077", "TRF DIS;D3;20kV/400V;3P;250kVA;DYN5;OD",  1],
  ["55UTR2607210021", "21-07-2026", "00000000000003250026", "MCB;380/440V;3P;300A;50Hz;MCCB",            1],
  ["55UTR2607210019", "21-07-2026", "00000000000003280469", "CONN;20KV;LLC;AL;70-240MM2;BOLT;PERMANEN", 3],
  ["55UTR2607210018", "21-07-2026", "00000000000003030006", "POLE;CONCRETE;20kV;CIRCL;13m;350daN;;",    1],
];

async function downloadTemplate() {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // ── Sheet: Form Inspeksi ──────────────────────────────────────────────
  const header = ["No Inspeksi", "Tgl Inspeksi", "No Material", "Nama Material", "QTY"];
  const ws = XLSX.utils.aoa_to_sheet([header, ...EXAMPLE_ROWS]);
  ws["!cols"] = [
    { wch: 22 }, // No Inspeksi
    { wch: 16 }, // Tgl Inspeksi
    { wch: 24 }, // No Material
    { wch: 48 }, // Nama Material
    { wch:  8 }, // QTY
  ];

  // Force date & material columns as text so Excel doesn't auto-convert
  for (let r = 1; r <= EXAMPLE_ROWS.length; r++) {
    const dateCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (dateCell) { dateCell.t = "s"; delete dateCell.z; }
    const matCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    if (matCell) { matCell.t = "s"; delete matCell.z; }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Form Inspeksi");

  // ── Sheet: Petunjuk ───────────────────────────────────────────────────
  const wsPetunjuk = XLSX.utils.aoa_to_sheet([
    ["PETUNJUK PENGISIAN TEMPLATE"],
    [],
    ["Kolom",         "Format",      "Contoh",               "Keterangan"],
    ["No Inspeksi",   "Teks",        "55UTR2607210026",      "Nomor inspeksi unik per item"],
    ["Tgl Inspeksi",  "DD-MM-YYYY",  "21-07-2026",           "Tanggal inspeksi (teks, bukan tanggal Excel)"],
    ["No Material",   "Teks/Angka",  "00000000000002090032", "Nomor material / nilai barcode (SN)"],
    ["Nama Material", "Teks",        "LA;20-24kV;K;10kA",    "Nama atau deskripsi material"],
    ["QTY",           "Angka",       "1",                    "Jumlah item"],
    [],
    ["Catatan:"],
    ["• Hapus baris contoh dan isi dengan data aktual mulai baris 2."],
    ["• Header (baris 1) jangan diubah."],
    ["• Boleh menambah baris sebanyak yang diperlukan."],
    ["• Kolom No Material (SN) yang akan di-encode ke dalam QR Code."],
    ["• Simpan dalam format .xlsx sebelum diimport."],
  ]);
  wsPetunjuk["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 26 }, { wch: 52 }];
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

const COL_ALIASES: Record<string, string> = {
  "no inspeksi":    "inspeksi",
  "noinspeksi":     "inspeksi",
  "nomor inspeksi": "inspeksi",
  "tgl inspeksi":   "tgl",
  "tglinspeksi":    "tgl",
  "tanggal":        "tgl",
  "no material":    "material",
  "nomaterial":     "material",
  "nomor material": "material",
};

interface ImportedRow {
  inspeksi: string;
  tgl: string;
  material: string;
  nama: string;
  qty: string;
}

async function parseInspectionFile(file: File): Promise<ImportedRow[] | null> {
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

  // Find header row
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

  const idx: Record<string, number> = {};
  headers.forEach((h: string, i: number) => {
    const key = COL_ALIASES[h] ?? COL_ALIASES[h.replace(/\s/g, "")];
    if (key) idx[key] = i;
    else if (h.startsWith("nama")) idx["nama"] = i;
    else if (h === "qty" || h === "jumlah") idx["qty"] = i;
  });

  const result: ImportedRow[] = [];
  for (let r = hdrIdx + 1; r < rows.length; r++) {
    const row = rows[r].map((c: any) => String(c).trim());
    if (row.every((c: string) => c === "")) continue;
    result.push({
      inspeksi: idx["inspeksi"] !== undefined ? row[idx["inspeksi"]] ?? "" : "",
      tgl:      idx["tgl"]      !== undefined ? row[idx["tgl"]]      ?? "" : "",
      material: idx["material"] !== undefined ? row[idx["material"]] ?? "" : "",
      nama:     idx["nama"]     !== undefined ? row[idx["nama"]]     ?? "" : "",
      qty:      idx["qty"]      !== undefined ? row[idx["qty"]]      ?? "" : "",
    });
  }
  return result.length > 0 ? result : null;
}

// ─── Print ─────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function printLabel(
  form: InspectionForm,
  barcodes: string[],
): Promise<void> {
  // QR payload = hanya SN per baris, tanpa teks tambahan
  const payload = barcodes.join("\n");

  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M", margin: 4, width: 400,
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  @page{size:70mm 30mm;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:70mm;height:30mm;background:#fff;overflow:hidden}
  .label{width:70mm;height:30mm;padding:1.5mm;display:flex;flex-direction:row;align-items:center;gap:1.5mm;font-family:Arial,Helvetica,sans-serif}
  .qr{flex-shrink:0;width:26mm;height:26mm}
  .qr img{width:26mm;height:26mm;display:block;image-rendering:pixelated}
  .info{flex:1;display:flex;flex-direction:column;justify-content:center;gap:0.9mm;overflow:hidden}
  .t1{font-size:6.5pt;font-weight:bold;color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t2{font-size:5.5pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t3{font-size:4.8pt;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hr{border-top:.3mm solid #ddd;margin:.4mm 0}
</style></head><body>
<div class="label">
  <div class="qr"><img src="${qrDataUrl}" alt="QR"/></div>
  <div class="info">
    <div class="t1">${esc(form.nomorInspeksi || "—")}</div>
    <div class="t2">Tgl: ${esc(form.tanggalInspeksi || "—")}</div>
    <div class="t2">Qty: ${esc(form.qty || "—")}</div>
    <div class="hr"></div>
    <div class="t3">${barcodes.length} barcode embedded</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();window.close();},300);};</script>
</body></html>`;

  const w = window.open("", "_blank", "width=700,height=500,menubar=no,toolbar=no");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  else toast.error("Popup diblokir browser. Izinkan popup lalu coba lagi.");
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function BarcodeTools() {
  const [form, setForm] = useState<InspectionForm>({
    nomorInspeksi: "", tanggalInspeksi: "", qty: "",
  });
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [newBarcode, setNewBarcode] = useState("");

  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ cur: number; tot: number } | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [qrPreviewUrl, setQrPreviewUrl] = useState("");

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const xlsxInputRef = useRef<HTMLInputElement>(null);

  const canPrint = barcodes.length > 0;

  // ── QR preview ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (barcodes.length === 0) { setQrPreviewUrl(""); return; }
    const payload = barcodes.join("\n");
    QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 4, width: 260 })
      .then(setQrPreviewUrl)
      .catch(() => setQrPreviewUrl(""));
  }, [barcodes]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const setField = (field: keyof InspectionForm, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // ── PDF scanning ──────────────────────────────────────────────────────────

  const processPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { toast.error("Hanya file PDF"); return; }
    setIsPdfProcessing(true);
    setPdfProgress({ cur: 0, tot: 1 });
    try {
      const found = await extractBarcodesFromPdf(
        file,
        (cur, tot) => setPdfProgress({ cur, tot }),
      );
      if (found.length === 0) {
        toast.warning("Tidak ada barcode yang terdeteksi di PDF ini");
      } else {
        setBarcodes((prev) => {
          const existing = new Set(prev);
          const added = found.filter((b) => !existing.has(b));
          return [...prev, ...added];
        });
        toast.success(`${found.length} barcode berhasil dideteksi dari PDF`);
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
      const rows = await parseInspectionFile(file);
      if (!rows || rows.length === 0) {
        toast.error("Format file tidak valid. Gunakan template yang tersedia.");
        return;
      }

      // Fill form from first row
      const first = rows[0];
      setForm({
        nomorInspeksi:   first.inspeksi || "",
        tanggalInspeksi: first.tgl      || "",
        qty:             first.qty      || String(rows.length),
      });

      // Extract No Material column as barcode list (deduplicated)
      const sns = [...new Set(rows.map((r) => r.material).filter(Boolean))];
      if (sns.length > 0) {
        setBarcodes(sns);
        toast.success(`${sns.length} No Material diimport sebagai barcode dari ${file.name}`);
      } else {
        toast.warning("Kolom No Material kosong — barcode tidak diimport.");
      }
    } catch { toast.error("Gagal membaca file."); }
  }, []);

  // ── Barcode list management ───────────────────────────────────────────────

  const addManual = () => {
    const v = newBarcode.trim();
    if (!v) return;
    setBarcodes((prev) => prev.includes(v) ? prev : [...prev, v]);
    setNewBarcode("");
  };

  const removeBarcode = (idx: number) =>
    setBarcodes((prev) => prev.filter((_, i) => i !== idx));

  // ── Print ─────────────────────────────────────────────────────────────────

  const handlePrint = async () => {
    if (!canPrint) return;
    setIsPrinting(true);
    try { await printLabel(form, barcodes); }
    catch (err: any) { toast.error("Gagal mencetak: " + (err?.message ?? "")); }
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
          Gabungkan banyak barcode menjadi satu QR Code inspeksi untuk dicetak di label{" "}
          <span className="font-medium">7 × 3 cm</span> (SATO CL4NX Plus).
        </p>
      </div>

      {/* ── Step 1: Data Inspeksi ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">1 · Data Inspeksi</CardTitle>
          <CardDescription className="text-xs">
            Isi informasi inspeksi — ditampilkan sebagai teks pada label cetak.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="nomorInspeksi" className="text-xs">No Inspeksi</Label>
              <Input
                id="nomorInspeksi"
                placeholder="55UTR2607210026"
                value={form.nomorInspeksi}
                onChange={(e) => setField("nomorInspeksi", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tanggalInspeksi" className="text-xs">Tgl Inspeksi</Label>
              <Input
                id="tanggalInspeksi"
                placeholder="21-07-2026"
                value={form.tanggalInspeksi}
                onChange={(e) => setField("tanggalInspeksi", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qty" className="text-xs">QTY</Label>
              <Input
                id="qty"
                type="number" min="0"
                placeholder="1"
                value={form.qty}
                onChange={(e) => setField("qty", e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2: Import Barcode ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">2 · Daftar Barcode / SN</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Import dari PDF atau Excel. Kolom <span className="font-medium">No Material</span> pada
                template akan dijadikan daftar SN di dalam QR Code.
              </CardDescription>
            </div>
            {barcodes.length > 0 && (
              <Badge variant="secondary">{barcodes.length} SN</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Import actions */}
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
            />
          </div>

          {/* Manual add */}
          <div className="flex gap-2">
            <Input
              placeholder="Tambah SN manual…"
              value={newBarcode}
              onChange={(e) => setNewBarcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addManual(); }}
              className="h-8 text-sm flex-1"
            />
            <Button variant="outline" size="sm" onClick={addManual} className="h-8">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Barcode list */}
          {barcodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <QrCode className="w-8 h-8 mb-2 opacity-25" />
              <p className="text-xs">Belum ada barcode — import dari PDF atau Excel</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-10">#</th>
                    <th className="text-left px-3 py-2 font-semibold">No Material / SN</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {barcodes.map((bc, idx) => (
                    <tr key={idx} className="group hover:bg-muted/30">
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2 font-mono">{bc}</td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => removeBarcode(idx)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          title="Hapus"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {barcodes.length > 0 && (
            <Button
              variant="ghost" size="sm"
              className="text-xs text-destructive hover:text-destructive h-7"
              onClick={() => { setBarcodes([]); toast.info("Daftar barcode dikosongkan"); }}
            >
              Hapus semua barcode
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Step 3: Preview & Print ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">3 · Preview & Cetak QR Code</CardTitle>
          <CardDescription className="text-xs">
            QR Code berisi daftar SN saja, satu per baris — tanpa teks tambahan.
            Scan ulang akan menampilkan daftar SN langsung.
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
                <div
                  className="flex flex-row items-center h-full gap-[4.5px]"
                  style={{ padding: "4.5px", fontFamily: "Arial,Helvetica,sans-serif" }}
                >
                  {/* QR */}
                  <div
                    className="flex-shrink-0 flex items-center justify-center bg-gray-50"
                    style={{ width: 78, height: 78 }}
                  >
                    {qrPreviewUrl
                      ? <img src={qrPreviewUrl} alt="QR" style={{ width: 78, height: 78, imageRendering: "pixelated" }} />
                      : <QrCode className="w-8 h-8 text-muted-foreground/20" />}
                  </div>
                  {/* Info */}
                  <div className="flex-1 flex flex-col justify-center gap-[2.5px] overflow-hidden min-w-0">
                    <div className="font-bold text-black truncate" style={{ fontSize: 7 }}>
                      {form.nomorInspeksi || <span className="text-gray-300">No Inspeksi</span>}
                    </div>
                    <div className="text-gray-600 truncate" style={{ fontSize: 5.8 }}>
                      Tgl: {form.tanggalInspeksi || "—"}
                    </div>
                    <div className="text-gray-600 truncate" style={{ fontSize: 5.8 }}>
                      Qty: {form.qty || "—"}
                    </div>
                    <div
                      className="border-t border-gray-200 mt-[1.5px] pt-[1px] text-gray-400 truncate"
                      style={{ fontSize: 5 }}
                    >
                      {barcodes.length > 0
                        ? `${barcodes.length} SN embedded`
                        : <span className="text-gray-200">— belum ada barcode —</span>}
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-1.5">
                Preview 3× · Cetak: 70 × 30 mm
              </p>
            </div>

            {/* Status + print */}
            <div className="flex-1 space-y-3">
              {/* Validation */}
              {barcodes.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Belum ada barcode. Import dari PDF atau Excel terlebih dahulu.
                </div>
              )}
              {barcodes.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Siap dicetak —{" "}
                  <strong>{barcodes.length} SN</strong> akan di-encode ke QR Code.
                </div>
              )}

              {/* QR payload preview */}
              {barcodes.length > 0 && (
                <div className="bg-muted/40 rounded-md p-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Isi QR Code (plain text · satu SN per baris)
                  </p>
                  <pre className="text-xs text-foreground/80 whitespace-pre font-mono leading-relaxed max-h-28 overflow-y-auto">
                    {barcodes.join("\n")}
                  </pre>
                </div>
              )}

              <Button
                className="w-full" size="lg"
                disabled={!canPrint || isPrinting}
                onClick={handlePrint}
              >
                {isPrinting
                  ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  : <Printer className="w-5 h-5 mr-2" />}
                Cetak QR Code (SATO CL4NX Plus)
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                QR Code dicetak dengan quiet-zone margin 4 — dapat di-scan ulang dengan scanner apapun.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
