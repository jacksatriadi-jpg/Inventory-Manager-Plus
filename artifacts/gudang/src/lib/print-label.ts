/**
 * QR code label printing utility
 * Target: SATO CL4NX Plus — paper 60mm × 30mm
 *
 * Each label prints as TWO pages:
 *   Page 1 — QR code only, maximized (30mm × 30mm square centred on the
 *             60mm wide label).  The quiet zone is baked into the PNG via
 *             margin:4 in the qrcode library; no extra CSS padding is added.
 *   Page 2 — Inspection data (title, material, qty/type, date/operator),
 *             full 60mm × 30mm, large clear fonts.
 *
 * QR codes are pre-rendered as PNG data URLs (qrcode npm package) so every
 * label — single or bulk — is identically crisp at print time, with no CDN
 * dependency and no canvas anti-aliasing drift.
 */
import QRCode from "qrcode";

export interface LabelData {
  /** Value to encode as QR code (serial numbers joined by "\n", or material code) */
  qrValue: string;
  /** Human-readable title shown on the info page (box label or material code) */
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

// margin:4 = standard quiet-zone (in QR modules) required for reliable scanning
const QR_PNG_PX = 400;
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

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── shared CSS snippets ───────────────────────────────────────────────────

function pageCSS(forPreview: boolean, scale: number): string {
  const W = 60 * scale;
  const H = 30 * scale;
  // QR: max square that fits the 30 mm height
  const qrMm = 30;
  const qr   = forPreview ? `${qrMm * scale}px` : `${qrMm}mm`;
  const sp   = (mm: number) => forPreview ? `${mm * scale}px` : `${mm}mm`;
  const fs   = (mm: number) => forPreview ? `${mm * scale}px` : `${mm * 2.835}pt`;
  const page = forPreview ? `width:${W}px;height:${H}px;` : `width:60mm;height:30mm;`;

  return `
  @page { size: 60mm 30mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; ${forPreview ? `width:${W}px;` : ""} }

  .page {
    ${page}
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: avoid; break-after: avoid; }

  /* ── Page 1: QR code ───────────────────────────── */
  .qr-page {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
  }
  .qr-wrap { width: ${qr}; height: ${qr}; flex-shrink: 0; }
  .qr-wrap img {
    width:  ${qr} !important;
    height: ${qr} !important;
    display: block;
    image-rendering: pixelated;
  }

  /* ── Page 2: Inspection data ───────────────────── */
  .info-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: ${sp(2)} ${sp(2.5)};
    gap: ${sp(0.8)};
    font-family: Arial, Helvetica, sans-serif;
    background: #fff;
  }
  .inf-title {
    font-size: ${fs(4.2)};
    font-weight: bold;
    color: #000;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inf-material {
    font-size: ${fs(3.4)};
    font-weight: bold;
    color: #111;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inf-row {
    font-size: ${fs(2.8)};
    color: #222;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inf-row-sm {
    font-size: ${fs(2.3)};
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }`;
}

function twoPageBody(qrImg: string, qrValue: string, data: LabelData): string {
  return `
<!-- Page 1: QR code — maximised, no extra CSS margin -->
<div class="page qr-page">
  <div class="qr-wrap">${qrImgOrFallback(qrImg, qrValue)}</div>
</div>

<!-- Page 2: Inspection data -->
<div class="page info-page">
  <div class="inf-title">${escHtml(data.title)}</div>
  <div class="inf-material">${escHtml(data.materialName)}</div>
  <div class="inf-row">${escHtml(data.qty)}${data.type ? " &nbsp;&middot;&nbsp; " + escHtml(data.type) : ""}</div>
  <div class="inf-row-sm">${escHtml(data.date)}${data.operator ? " &nbsp;&middot;&nbsp; " + escHtml(data.operator) : ""}</div>
</div>`;
}

// ─── public API ───────────────────────────────────────────────────────────

/**
 * Returns a full HTML document with 2 pages:
 *   page 1 = QR code (maximised), page 2 = inspection data.
 * forPreview=true scales everything up 3.5× for the dialog iframe.
 */
export async function generateLabelHtml(data: LabelData, forPreview = false): Promise<string> {
  const scale = forPreview ? 3.5 : 1;
  const qrUrl = await qrDataUrl(data.qrValue);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>${pageCSS(forPreview, scale)}</style>
</head>
<body>
${twoPageBody(qrUrl, data.qrValue, data)}
${forPreview ? "" : '<script>window.onload=function(){setTimeout(function(){window.print();window.close();},300);};</script>'}
</body>
</html>`;
}

/** Opens a popup and immediately prints the 2-page label. */
export async function printLabel(data: LabelData): Promise<void> {
  const html = await generateLabelHtml(data, false);
  const w = window.open("", "_blank", "width=640,height=480,menubar=no,toolbar=no");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
}

/**
 * Generates a single HTML document with 2 pages per label
 * (QR page then info page, interleaved).
 * For N labels → 2N printed pages total.
 */
export async function generateBulkLabelHtml(labels: LabelData[]): Promise<string> {
  const qrUrls = await Promise.all(labels.map((d) => qrDataUrl(d.qrValue)));

  const allPages = labels
    .map((data, i) => twoPageBody(qrUrls[i], data.qrValue, data))
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>${pageCSS(false, 1)}</style>
</head>
<body>
${allPages}
<script>window.onload=function(){setTimeout(function(){window.print();window.close();},300);};</script>
</body>
</html>`;
}

/**
 * Opens a print popup with 2 pages per label (QR + info).
 * For a single label, delegates to printLabel.
 */
export async function printBulkLabels(labels: LabelData[]): Promise<void> {
  if (labels.length === 0) return;
  if (labels.length === 1) { await printLabel(labels[0]); return; }
  const html = await generateBulkLabelHtml(labels);
  const w = window.open("", "_blank", "width=700,height=500,menubar=no,toolbar=no");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
}
