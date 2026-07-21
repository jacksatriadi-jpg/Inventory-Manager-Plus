/**
 * Barcode Tools — konversi banyak barcode dari PDF menjadi satu QR Code inspeksi
 * Printer target: SATO CL4NX Plus, ukuran kertas 7cm × 3cm (70mm × 30mm)
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileUp, Download, QrCode, Printer, X, CheckCircle2,
  AlertTriangle, Loader2, ScanLine, Trash2, FileSpreadsheet,
  UploadCloud, ToggleLeft, ToggleRight, RefreshCw,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────

interface BarcodeResult {
  page: number;
  value: string;
  included: boolean;
}

interface InspectionData {
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
    // Use CDN worker — avoids Vite worker-bundle config
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
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// ─── Barcode reading (ZXing) ───────────────────────────────────────────────

async function readBarcodeFromCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/library");
    const codeReader = new BrowserMultiFormatReader();

    return await new Promise<string | null>((resolve) => {
      const img = document.createElement("img");
      img.onload = async () => {
        try {
          const result = await codeReader.decodeFromImageElement(img);
          resolve(result.getText());
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = canvas.toDataURL("image/png");
    });
  } catch {
    return null;
  }
}

async function extractBarcodesFromPdf(
  file: File,
  onProgress: (current: number, total: number) => void,
): Promise<BarcodeResult[]> {
  const pdfjsLib = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const numPages = pdf.numPages;
  const results: BarcodeResult[] = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress(i, numPages);
    try {
      const page = await pdf.getPage(i);
      const canvas = await renderPageToCanvas(page, 2.5);
      const value = await readBarcodeFromCanvas(canvas);
      if (value) {
        results.push({ page: i, value: value.trim(), included: true });
      }
    } catch {
      // Skip pages that fail
    }
  }

  return results;
}

// ─── Excel template helpers ────────────────────────────────────────────────

async function downloadTemplate() {
  const XLSX = await import("xlsx");

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Form Inspeksi ──────────────────────────────────────────────
  const wsData: any[][] = [
    // Row 1: title row (merged visually via wide column + bold)
    ["FORM DATA INSPEKSI", "", ""],
    ["Isi baris data mulai dari baris 4. Jangan ubah baris header (baris 3).", "", ""],
    // Row 3: column headers
    ["Nomor Inspeksi", "Tanggal Inspeksi", "Qty"],
    // Row 4: example data
    ["INS-001", "2026-07-21", 100],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = [
    { wch: 28 }, // Nomor Inspeksi
    { wch: 22 }, // Tanggal Inspeksi
    { wch: 14 }, // Qty
  ];

  // Cell styles (xlsx supports styles via SheetJS Pro; with the free version
  // we set cell types and number formats for the date column)
  // Mark B4 as text so Excel doesn't auto-convert date format
  if (ws["B4"]) {
    ws["B4"].t = "s"; // string type — keeps YYYY-MM-DD intact
  }
  if (ws["C4"]) {
    ws["C4"].t = "n"; // number type for qty
  }

  XLSX.utils.book_append_sheet(wb, ws, "Form Inspeksi");

  // ── Sheet 2: Petunjuk ───────────────────────────────────────────────────
  const wsPetunjuk = XLSX.utils.aoa_to_sheet([
    ["PETUNJUK PENGISIAN"],
    [""],
    ["Kolom", "Format", "Contoh", "Keterangan"],
    ["Nomor Inspeksi", "Teks bebas", "INS-001", "Nomor unik untuk inspeksi ini"],
    ["Tanggal Inspeksi", "YYYY-MM-DD", "2026-07-21", "Format tahun-bulan-tanggal (ISO 8601)"],
    ["Qty", "Angka", "100", "Jumlah item yang diinspeksi"],
    [""],
    ["Catatan:"],
    ["• Isi hanya SATU baris data (baris 4 di sheet Form Inspeksi)."],
    ["• Simpan file dalam format .xlsx sebelum diimport."],
    ["• Kolom Tanggal harus dalam format YYYY-MM-DD (gunakan format Teks di Excel)."],
  ]);
  wsPetunjuk["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(wb, wsPetunjuk, "Petunjuk");

  // Export
  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbOut], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "template_inspeksi.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

async function parseInspectionFile(file: File): Promise<InspectionData | null> {
  const XLSX = await import("xlsx");

  const arrayBuffer = await file.arrayBuffer();
  let wb: any;

  try {
    wb = XLSX.read(arrayBuffer, { type: "array", cellText: true, cellDates: false });
  } catch {
    return null;
  }

  // Use first sheet
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;

  // Convert to rows
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Find the header row (contains "nomor" and "tanggal")
  let headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map((c: any) => String(c).toLowerCase());
    if (row.some((c: string) => c.includes("nomor")) && row.some((c: string) => c.includes("tanggal"))) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1 || headerRowIdx + 1 >= rows.length) return null;

  const headers = rows[headerRowIdx].map((c: any) => String(c).toLowerCase().replace(/\s+/g, "_"));
  const values  = rows[headerRowIdx + 1].map((c: any) => String(c).trim());

  const get = (key: string) => {
    const idx = headers.findIndex((h: string) => h.includes(key));
    return idx >= 0 ? (values[idx] ?? "") : "";
  };

  const nomor   = get("nomor");
  const tanggal = get("tanggal");
  const qty     = get("qty");

  if (!nomor && !tanggal && !qty) return null;
  return { nomorInspeksi: nomor, tanggalInspeksi: tanggal, qty };
}

// ─── QR payload builder ────────────────────────────────────────────────────

function buildPayload(inspection: InspectionData, barcodes: string[]): string {
  return JSON.stringify({
    no_insp: inspection.nomorInspeksi,
    tgl_insp: inspection.tanggalInspeksi,
    qty: inspection.qty,
    barcodes,
  });
}

// ─── Print helper (70mm × 30mm — SATO CL4NX Plus) ─────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function printInspectionLabel(inspection: InspectionData, barcodes: string[]): Promise<void> {
  const payload = buildPayload(inspection, barcodes);
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 4,
    width: 400,
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: 70mm 30mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 70mm; height: 30mm; background: #fff; overflow: hidden; }
  .label {
    width: 70mm; height: 30mm;
    padding: 1.5mm;
    display: flex; flex-direction: row; align-items: center; gap: 1.5mm;
    font-family: Arial, Helvetica, sans-serif;
  }
  .qr-wrap { flex-shrink: 0; width: 26mm; height: 26mm; }
  .qr-wrap img { width: 26mm; height: 26mm; display: block; image-rendering: pixelated; }
  .info { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 1mm; overflow: hidden; }
  .title  { font-size: 6.8pt; font-weight: bold; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row    { font-size: 5.8pt; color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .small  { font-size: 5pt;   color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .divider { border-top: 0.3mm solid #ccc; margin: 0.5mm 0; }
</style>
</head>
<body>
<div class="label">
  <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR" /></div>
  <div class="info">
    <div class="title">${esc(inspection.nomorInspeksi || "—")}</div>
    <div class="row">Tgl: ${esc(inspection.tanggalInspeksi || "—")}</div>
    <div class="row">Qty: ${esc(inspection.qty || "—")}</div>
    <div class="divider"></div>
    <div class="small">${barcodes.length} barcode${barcodes.length !== 1 ? "s" : ""} embedded</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();window.close();},300);};</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=700,height=500,menubar=no,toolbar=no");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  } else {
    toast.error("Popup diblokir browser. Izinkan popup lalu coba lagi.");
  }
}

// ─── QR preview generator ──────────────────────────────────────────────────

async function generatePreview(
  inspection: InspectionData,
  barcodes: string[],
): Promise<string> {
  const payload = buildPayload(inspection, barcodes);
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 4, width: 260 });
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function BarcodeTools() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [barcodes, setBarcodes] = useState<BarcodeResult[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [inspection, setInspection] = useState<InspectionData>({
    nomorInspeksi: "",
    tanggalInspeksi: new Date().toISOString().slice(0, 10),
    qty: "",
  });
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string>("");
  const [isPrinting, setIsPrinting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const includedBarcodes = barcodes.filter((b) => b.included).map((b) => b.value);
  const canPrint =
    includedBarcodes.length > 0 &&
    inspection.nomorInspeksi.trim() !== "" &&
    inspection.tanggalInspeksi.trim() !== "";

  // Regenerate QR preview on change
  useEffect(() => {
    if (includedBarcodes.length === 0) {
      setQrPreviewUrl("");
      return;
    }
    generatePreview(inspection, includedBarcodes)
      .then(setQrPreviewUrl)
      .catch(() => setQrPreviewUrl(""));
  }, [inspection, barcodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PDF handling ──────────────────────────────────────────────────────────

  const processPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Hanya file PDF yang didukung");
      return;
    }
    setPdfFile(file);
    setBarcodes([]);
    setIsProcessing(true);
    setProgress({ current: 0, total: 1 });

    try {
      const results = await extractBarcodesFromPdf(file, (current, total) => {
        setProgress({ current, total });
      });
      setBarcodes(results);

      if (results.length === 0) {
        toast.warning("Tidak ada barcode yang terdeteksi. Pastikan PDF mengandung barcode yang jelas.");
      } else {
        toast.success(`${results.length} barcode berhasil dideteksi dari ${file.name}`);
      }
    } catch (err: any) {
      toast.error("Gagal memproses PDF: " + (err?.message ?? "Unknown error"));
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPdf(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processPdf(file);
  };

  // ── Excel / CSV import ───────────────────────────────────────────────────

  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const data = await parseInspectionFile(file);
      if (data) {
        setInspection(data);
        toast.success("Data inspeksi berhasil diimport");
      } else {
        toast.error("Format file tidak valid. Gunakan template yang tersedia (.xlsx).");
      }
    } catch {
      toast.error("Gagal membaca file. Pastikan file tidak rusak.");
    }
  }, []);

  // ── Barcode list controls ─────────────────────────────────────────────────

  const toggleBarcode = (idx: number) => {
    setBarcodes((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, included: !b.included } : b)),
    );
  };

  const removeBarcode = (idx: number) => {
    setBarcodes((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleAll = (included: boolean) => {
    setBarcodes((prev) => prev.map((b) => ({ ...b, included })));
  };

  // ── Print ─────────────────────────────────────────────────────────────────

  const handlePrint = async () => {
    if (!canPrint) return;
    setIsPrinting(true);
    try {
      await printInspectionLabel(inspection, includedBarcodes);
    } catch (err: any) {
      toast.error("Gagal mencetak: " + (err?.message ?? "Unknown error"));
    } finally {
      setIsPrinting(false);
    }
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
          Gabungkan banyak barcode dari PDF menjadi satu QR Code inspeksi untuk dicetak di label{" "}
          <span className="font-medium">7 × 3 cm</span> (SATO CL4NX Plus).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left column ── */}
        <div className="space-y-6">

          {/* Step 1: Import PDF */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</span>
                Import PDF Barcode
              </CardTitle>
              <CardDescription>
                Upload PDF yang berisi barcode. Setiap halaman akan di-scan secara otomatis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm font-medium">
                      Memproses halaman {progress?.current ?? 0} / {progress?.total ?? "?"}
                    </p>
                    <p className="text-xs text-muted-foreground">Mohon tunggu…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <UploadCloud className="w-8 h-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">
                      {pdfFile ? pdfFile.name : "Klik atau seret PDF ke sini"}
                    </p>
                    <p className="text-xs text-muted-foreground">Format: .pdf</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {/* Barcode list */}
              {barcodes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Barcode terdeteksi{" "}
                      <Badge variant="secondary">{barcodes.length}</Badge>
                    </span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleAll(true)}>
                        Pilih Semua
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleAll(false)}>
                        Hapus Pilihan
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                    {barcodes.map((b, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                          b.included ? "bg-background" : "bg-muted/40 opacity-60"
                        }`}
                      >
                        <button
                          className="flex-shrink-0"
                          onClick={() => toggleBarcode(idx)}
                          title={b.included ? "Klik untuk abaikan" : "Klik untuk sertakan"}
                        >
                          {b.included ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : (
                            <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                        <span className="text-muted-foreground w-12 flex-shrink-0">Hal. {b.page}</span>
                        <span className="flex-1 font-mono truncate">{b.value}</span>
                        <button
                          className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeBarcode(idx)}
                          title="Hapus"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {includedBarcodes.length} dari {barcodes.length} barcode akan disertakan dalam QR Code.
                  </p>
                </div>
              )}

              {/* Re-scan button */}
              {pdfFile && !isProcessing && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => processPdf(pdfFile)}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Scan Ulang PDF
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Inspection Data */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</span>
                Data Inspeksi
              </CardTitle>
              <CardDescription>
                Isi data inspeksi secara manual atau import dari file CSV.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Template & import */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={downloadTemplate}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Template
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => csvInputRef.current?.click()}
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Import Excel / CSV
                </Button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileImport}
                />
              </div>

              <Separator />

              {/* Form fields */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nomor-inspeksi">Nomor Inspeksi</Label>
                  <Input
                    id="nomor-inspeksi"
                    placeholder="contoh: INS-2026-001"
                    value={inspection.nomorInspeksi}
                    onChange={(e) =>
                      setInspection((prev) => ({ ...prev, nomorInspeksi: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tanggal-inspeksi">Tanggal Inspeksi</Label>
                  <Input
                    id="tanggal-inspeksi"
                    type="date"
                    value={inspection.tanggalInspeksi}
                    onChange={(e) =>
                      setInspection((prev) => ({ ...prev, tanggalInspeksi: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qty">Qty</Label>
                  <Input
                    id="qty"
                    type="number"
                    min="0"
                    placeholder="contoh: 100"
                    value={inspection.qty}
                    onChange={(e) =>
                      setInspection((prev) => ({ ...prev, qty: e.target.value }))
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right column: Preview & Print ── */}
        <div className="space-y-6">
          <Card className="sticky top-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</span>
                Preview & Cetak QR Code
              </CardTitle>
              <CardDescription>
                Preview label <span className="font-medium">7 × 3 cm</span> sebelum dicetak ke SATO CL4NX Plus.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Label preview — scaled 3× for screen readability */}
              <div className="flex justify-center">
                <div
                  className="border-2 border-dashed border-muted-foreground/30 rounded-md overflow-hidden bg-white shadow-sm"
                  style={{ width: "210px", height: "90px" }} /* 70mm×30mm at 3px/mm */
                  title="Preview label 7cm × 3cm (skala 3×)"
                >
                  <div
                    className="flex flex-row items-center gap-[4.5px] h-full"
                    style={{ padding: "4.5px", fontFamily: "Arial, Helvetica, sans-serif" }}
                  >
                    {/* QR */}
                    <div
                      className="flex-shrink-0 bg-gray-100 flex items-center justify-center"
                      style={{ width: "78px", height: "78px" }}
                    >
                      {qrPreviewUrl ? (
                        <img
                          src={qrPreviewUrl}
                          alt="QR Preview"
                          style={{ width: "78px", height: "78px", imageRendering: "pixelated" }}
                        />
                      ) : (
                        <QrCode className="w-8 h-8 text-muted-foreground/30" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 flex flex-col justify-center gap-[3px] overflow-hidden min-w-0">
                      <div className="font-bold text-black truncate" style={{ fontSize: "6.8px" }}>
                        {inspection.nomorInspeksi || <span className="text-gray-300">Nomor Inspeksi</span>}
                      </div>
                      <div className="text-gray-700 truncate" style={{ fontSize: "5.8px" }}>
                        Tgl: {inspection.tanggalInspeksi || "—"}
                      </div>
                      <div className="text-gray-700 truncate" style={{ fontSize: "5.8px" }}>
                        Qty: {inspection.qty || "—"}
                      </div>
                      <div className="border-t border-gray-200 mt-[1.5px] pt-[1.5px] text-gray-400 truncate" style={{ fontSize: "5px" }}>
                        {includedBarcodes.length > 0
                          ? `${includedBarcodes.length} barcode${includedBarcodes.length !== 1 ? "s" : ""} embedded`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                Preview skala 3× · Ukuran cetak sebenarnya: 70mm × 30mm
              </p>

              {/* Validation hints */}
              <div className="space-y-1.5">
                {includedBarcodes.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    Belum ada barcode yang dipilih dari PDF
                  </div>
                )}
                {!inspection.nomorInspeksi.trim() && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    Nomor Inspeksi belum diisi
                  </div>
                )}
                {includedBarcodes.length > 0 && inspection.nomorInspeksi.trim() && (
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    Siap dicetak — {includedBarcodes.length} barcode akan di-embed dalam QR Code
                  </div>
                )}
              </div>

              {/* QR payload info */}
              {qrPreviewUrl && (
                <div className="bg-muted/50 rounded-md p-3 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Isi QR Code
                  </p>
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
                    {JSON.stringify(
                      {
                        no_insp: inspection.nomorInspeksi,
                        tgl_insp: inspection.tanggalInspeksi,
                        qty: inspection.qty,
                        barcodes: includedBarcodes,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}

              {/* Print button */}
              <Button
                className="w-full"
                size="lg"
                disabled={!canPrint || isPrinting}
                onClick={handlePrint}
              >
                {isPrinting ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <Printer className="w-5 h-5 mr-2" />
                )}
                Cetak QR Code (SATO CL4NX Plus)
              </Button>

              {/* Scan-back note */}
              <p className="text-xs text-muted-foreground text-center">
                QR Code dicetak dengan <em>quiet zone</em> margin 4 modul — dapat di-scan ulang dengan scanner apapun.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
