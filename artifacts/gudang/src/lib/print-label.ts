/**
 * Barcode label printing utility
 * Target: SATO CL4NX Plus — paper 60mm × 30mm
 */

export interface LabelData {
  /** Value to encode as Code-128 barcode (boxLabel or materialCode) */
  barcode: string;
  /** Human-readable title shown below barcode */
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
  // In preview mode we scale up so it's readable in the dialog
  const scale = forPreview ? 3.5 : 1;
  const w = 60 * scale;
  const h = 30 * scale;

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
    padding: ${forPreview ? 3.5 * scale + "px " + 7 * scale + "px" : "1mm 2mm"};
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-family: Arial, Helvetica, sans-serif;
  }
  svg#bc {
    width: 100%;
    height: ${forPreview ? 13 * scale + "px" : "13mm"};
  }
  .material {
    font-size: ${forPreview ? 7 * scale + "px" : "7pt"};
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    margin-top: ${forPreview ? 2 * scale + "px" : "0.5mm"};
  }
  .meta {
    font-size: ${forPreview ? 5.5 * scale + "px" : "5.5pt"};
    color: #333;
    display: flex;
    justify-content: space-between;
    margin-top: ${forPreview ? 1.5 * scale + "px" : "0.4mm"};
  }
  .meta span { white-space: nowrap; }
</style>
</head>
<body>
<div class="label">
  <div>
    <svg id="bc"></svg>
    <div class="material">${escHtml(data.materialName)}</div>
    <div class="meta">
      <span>${escHtml(data.qty)}${data.type ? " · " + escHtml(data.type) : ""}</span>
      <span>${escHtml(data.date)}</span>
      ${data.operator ? `<span>${escHtml(data.operator)}</span>` : ""}
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/barcodes/JsBarcode.code128.min.js"></script>
<script>
  try {
    JsBarcode("#bc", ${JSON.stringify(data.barcode)}, {
      format: "CODE128",
      width: ${forPreview ? 1.8 * scale : 1.8},
      height: ${forPreview ? 13 * scale * 0.7 : 28},
      displayValue: true,
      text: ${JSON.stringify(data.title)},
      fontSize: ${forPreview ? 5 * scale : 8},
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch(e) {
    // fallback: show text if barcode fails
    document.getElementById("bc").outerHTML =
      '<div style="text-align:center;font-size:${forPreview ? 8 * scale : 10}px;font-weight:bold;padding:4px">' +
      ${JSON.stringify(data.title)} + '</div>';
  }
  ${forPreview ? "" : "window.onload = function(){ setTimeout(function(){ window.print(); window.close(); }, 400); };"}
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
