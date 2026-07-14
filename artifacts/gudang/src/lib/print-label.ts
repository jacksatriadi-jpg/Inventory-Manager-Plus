/**
 * QR code label printing utility
 * Target: SATO CL4NX Plus — paper 60mm × 30mm
 *
 * QR codes are rendered with the `qrcode` npm package (same library used
 * elsewhere in the app) as PNG data URLs, then embedded as plain <img> tags.
 * We intentionally do NOT use the `qrcodejs` CDN script here anymore:
 *  - qrcodejs renders with zero quiet zone (no white border around the
 *    modules), which makes small 26mm labels unreliable to re-scan — the
 *    scanner needs blank space around the code to find its edges.
 *  - Creating many `new QRCode(...)` canvas instances in a single bulk-print
 *    document is prone to rendering/anti-aliasing artifacts (labels come out
 *    visually "thicker"/blurrier as more are printed at once), and depends
 *    on an external CDN being reachable at print time.
 * A single shared `toDataURL` call per label avoids all of the above: every
 * label — single or bulk — gets an identically crisp, high quiet-zone PNG.
 */
import QRCode from "qrcode";

export interface LabelData {
  /** Value to encode as QR code (boxLabel, materialCode, or serial number) */
  qrValue: string;
  /** Human-readable title shown next to QR (e.g. box label or item code) */
  title: string;
  /** Material name */
  materialName: string;
  /** Quantity string e.g. "24 pcs" */
  qty: string;
  /** Transaction type label e.g. "Scan Masuk" */
  type?: string;
  /** Formatted date string */
  date: string;
  /** Operator name */
  operator?: string;
}

// QR generated at high resolution for crisp thermal printing; CSS then
// constrains the <img> to the correct physical size (26mm).
const QR_PNG_PX = 300;
// margin: 4 = standard quiet-zone width (in QR modules) recommended by the
// spec — this is what makes the printed code reliably re-scannable.
const QR_OPTS = { errorCorrectionLevel: "M" as const, margin: 4, width: QR_PNG_PX };

async function qrDataUrl(value: string): Promise<string> {
  try {
    return await QRCode.toDataURL(value, QR_OPTS);
  } catch {
    return "";
  }
}

function qrImgOrFallback(dataUrl: string, value: string): string {
  if (dataUrl) return `<img src="${dataUrl}" alt="QR" />`;
  return `<div style="font-size:8px;text-align:center;word-break:break-all">${escHtml(value)}</div>`;
}

/** Returns a full HTML document string ready for a print window or iframe srcdoc */
export async function generateLabelHtml(data: LabelData, forPreview = false): Promise<string> {
  // Preview: scale up so it's readable in the dialog (3.5× original mm)
  const scale = forPreview ? 3.5 : 1;
  const w = 60 * scale;
  const h = 30 * scale;

  // Physical size: 26mm in print, 26*scale px in preview
  const qrDisplaySize = forPreview ? `${26 * scale}px` : "26mm";

  // Text sizing
  const fs = (mm: number) => forPreview ? `${mm * scale}px` : `${mm * 2.835}pt`; // 1mm ≈ 2.835pt
  const gap = (mm: number) => forPreview ? `${mm * scale}px` : `${mm}mm`;

  const qrUrl = await qrDataUrl(data.qrValue);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page {
    size: 60mm 30mm;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${forPreview ? w + "px" : "60mm"};
    height: ${forPreview ? h + "px" : "30mm"};
    background: #fff;
    overflow: hidden;
  }
  .label {
    width: ${forPreview ? w + "px" : "60mm"};
    height: ${forPreview ? h + "px" : "30mm"};
    padding: ${gap(0.8)};
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: ${gap(1)};
    font-family: Arial, Helvetica, sans-serif;
  }
  .qr-wrap {
    flex-shrink: 0;
    width: ${qrDisplaySize};
    height: ${qrDisplaySize};
  }
  .qr-wrap img {
    width: ${qrDisplaySize} !important;
    height: ${qrDisplaySize} !important;
    display: block;
    image-rendering: pixelated;
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: ${gap(0.5)};
    overflow: hidden;
  }
  .title {
    font-size: ${fs(2.3)};
    font-weight: bold;
    color: #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .material {
    font-size: ${fs(2.1)};
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #111;
  }
  .row {
    font-size: ${fs(1.8)};
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
<div class="label">
  <div class="qr-wrap">${qrImgOrFallback(qrUrl, data.qrValue)}</div>
  <div class="info">
    <div class="title">${escHtml(data.title)}</div>
    <div class="material">${escHtml(data.materialName)}</div>
    <div class="row">${escHtml(data.qty)}${data.type ? " &middot; " + escHtml(data.type) : ""}</div>
    <div class="row">${escHtml(data.date)}${data.operator ? " &middot; " + escHtml(data.operator) : ""}</div>
  </div>
</div>
${forPreview ? "" : '<script>window.onload = function(){ setTimeout(function(){ window.print(); window.close(); }, 300); };</script>'}
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Opens a popup and immediately prints the label */
export async function printLabel(data: LabelData): Promise<void> {
  const html = await generateLabelHtml(data, false);
  const w = window.open("", "_blank", "width=640,height=480,menubar=no,toolbar=no");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}

/**
 * Generates a single HTML document with one 60×30mm page per label.
 * Suitable for bulk thermal printing — each label becomes its own printed page.
 * All QR codes are pre-rendered as PNG data URLs before the document is
 * built, so print quality does not degrade as the batch grows.
 */
export async function generateBulkLabelHtml(labels: LabelData[]): Promise<string> {
  const qrDisplaySize = "26mm";
  const fs = (mm: number) => `${mm * 2.835}pt`;
  const gap = (mm: number) => `${mm}mm`;

  const qrUrls = await Promise.all(labels.map((data) => qrDataUrl(data.qrValue)));

  const labelDivs = labels
    .map(
      (data, i) => `
<div class="label">
  <div class="qr-wrap">${qrImgOrFallback(qrUrls[i], data.qrValue)}</div>
  <div class="info">
    <div class="title">${escHtml(data.title)}</div>
    <div class="material">${escHtml(data.materialName)}</div>
    <div class="row">${escHtml(data.qty)}${data.type ? " &middot; " + escHtml(data.type) : ""}</div>
    <div class="row">${escHtml(data.date)}${data.operator ? " &middot; " + escHtml(data.operator) : ""}</div>
  </div>
</div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: 60mm 30mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  .label {
    width: 60mm; height: 30mm;
    padding: ${gap(0.8)};
    display: flex; flex-direction: row; align-items: center; gap: ${gap(1)};
    font-family: Arial, Helvetica, sans-serif;
    page-break-after: always;
    overflow: hidden;
  }
  .label:last-child { page-break-after: avoid; }
  .qr-wrap { flex-shrink: 0; width: ${qrDisplaySize}; height: ${qrDisplaySize}; }
  .qr-wrap img { width: ${qrDisplaySize} !important; height: ${qrDisplaySize} !important; display: block; image-rendering: pixelated; }
  .info { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: ${gap(0.5)}; overflow: hidden; }
  .title    { font-size: ${fs(2.3)}; font-weight: bold; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .material { font-size: ${fs(2.1)}; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #111; }
  .row      { font-size: ${fs(1.8)}; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
${labelDivs}
<script>
  window.onload = function() { setTimeout(function(){ window.print(); window.close(); }, 300); };
</script>
</body>
</html>`;
}

/**
 * Opens a print popup with one SATO label page per entry.
 * Falls back to single-label popup when the array has exactly one item.
 */
export async function printBulkLabels(labels: LabelData[]): Promise<void> {
  if (labels.length === 0) return;
  if (labels.length === 1) { await printLabel(labels[0]); return; }
  const html = await generateBulkLabelHtml(labels);
  const w = window.open("", "_blank", "width=700,height=500,menubar=no,toolbar=no");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
