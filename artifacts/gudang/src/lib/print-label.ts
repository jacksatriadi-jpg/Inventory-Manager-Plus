/**
 * QR code label printing utility
 * Target: SATO CL4NX Plus — paper 60mm × 30mm
 */

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

/** Returns a full HTML document string ready for a print window or iframe srcdoc */
export function generateLabelHtml(data: LabelData, forPreview = false): string {
  // Preview: scale up so it's readable in the dialog (3.5× original mm)
  const scale = forPreview ? 3.5 : 1;
  const w = 60 * scale;
  const h = 30 * scale;

  // QR canvas always generated at high resolution for crisp thermal printing.
  // CSS then constrains it to the correct physical size.
  const QR_CANVAS_PX = 200;
  // Physical size: 26mm in print, 26*scale px in preview
  const qrDisplaySize = forPreview ? `${26 * scale}px` : "26mm";

  // Text sizing
  const fs = (mm: number) => forPreview ? `${mm * scale}px` : `${mm * 2.835}pt`; // 1mm ≈ 2.835pt
  const gap = (mm: number) => forPreview ? `${mm * scale}px` : `${mm}mm`;

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
  /* Scale high-res canvas down to physical display size */
  .qr-wrap canvas, .qr-wrap img {
    width: ${qrDisplaySize} !important;
    height: ${qrDisplaySize} !important;
    display: block;
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
  <div class="qr-wrap" id="qrwrap"></div>
  <div class="info">
    <div class="title">${escHtml(data.title)}</div>
    <div class="material">${escHtml(data.materialName)}</div>
    <div class="row">${escHtml(data.qty)}${data.type ? " &middot; " + escHtml(data.type) : ""}</div>
    <div class="row">${escHtml(data.date)}${data.operator ? " &middot; " + escHtml(data.operator) : ""}</div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<script>
  try {
    new QRCode(document.getElementById("qrwrap"), {
      text: ${JSON.stringify(data.qrValue)},
      width: ${QR_CANVAS_PX},
      height: ${QR_CANVAS_PX},
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch(e) {
    document.getElementById("qrwrap").innerHTML =
      '<div style="font-size:8px;text-align:center;word-break:break-all">' +
      ${JSON.stringify(data.qrValue)} + '</div>';
  }
  ${forPreview ? "" : "window.onload = function(){ setTimeout(function(){ window.print(); window.close(); }, 600); };"}
</script>
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
export function printLabel(data: LabelData): void {
  const html = generateLabelHtml(data, false);
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
 */
export function generateBulkLabelHtml(labels: LabelData[]): string {
  const QR_CANVAS_PX = 200;
  const qrDisplaySize = "26mm";
  const fs = (mm: number) => `${mm * 2.835}pt`;
  const gap = (mm: number) => `${mm}mm`;

  const labelDivs = labels
    .map(
      (data, i) => `
<div class="label">
  <div class="qr-wrap" id="qrwrap-${i}"></div>
  <div class="info">
    <div class="title">${escHtml(data.title)}</div>
    <div class="material">${escHtml(data.materialName)}</div>
    <div class="row">${escHtml(data.qty)}${data.type ? " &middot; " + escHtml(data.type) : ""}</div>
    <div class="row">${escHtml(data.date)}${data.operator ? " &middot; " + escHtml(data.operator) : ""}</div>
  </div>
</div>`,
    )
    .join("\n");

  const qrInits = labels
    .map(
      (data, i) => `
  try {
    new QRCode(document.getElementById("qrwrap-${i}"), {
      text: ${JSON.stringify(data.qrValue)},
      width: ${QR_CANVAS_PX}, height: ${QR_CANVAS_PX},
      colorDark: "#000000", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch(e) {
    document.getElementById("qrwrap-${i}").innerHTML =
      '<div style="font-size:8px;text-align:center;word-break:break-all">' +
      ${JSON.stringify(escHtml(data.qrValue))} + '</div>';
  }`,
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
  .qr-wrap canvas, .qr-wrap img { width: ${qrDisplaySize} !important; height: ${qrDisplaySize} !important; display: block; }
  .info { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: ${gap(0.5)}; overflow: hidden; }
  .title    { font-size: ${fs(2.3)}; font-weight: bold; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .material { font-size: ${fs(2.1)}; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #111; }
  .row      { font-size: ${fs(1.8)}; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
${labelDivs}
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<script>
${qrInits}
  // qrcodejs renders synchronously; small delay lets browser paint before print dialog
  window.onload = function() { setTimeout(function(){ window.print(); window.close(); }, 700); };
</script>
</body>
</html>`;
}

/**
 * Opens a print popup with one SATO label page per entry.
 * Falls back to single-label popup when the array has exactly one item.
 */
export function printBulkLabels(labels: LabelData[]): void {
  if (labels.length === 0) return;
  if (labels.length === 1) { printLabel(labels[0]); return; }
  const html = generateBulkLabelHtml(labels);
  const w = window.open("", "_blank", "width=700,height=500,menubar=no,toolbar=no");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
