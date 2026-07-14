---
name: Gudang Pemaron QR quiet zone
description: Why printed QR/box labels sometimes failed to re-scan, and the fix (margin, and avoiding the CDN qrcodejs library).
---

Printed QR labels (box labels, SATO labels, bulk A4 sheets) need a proper quiet zone
(the blank border around the QR pattern) or handheld scanners intermittently fail to
read them after printing, especially at small physical sizes or on lower-quality
printers.

**Why:** the original implementation used the `qrcodejs` CDN script, rendered live to a
`<canvas>`, with no margin control — the QR modules ran right up to the card edge. This
produced normal-looking QR codes on screen that were unreliable once printed and scanned
in the warehouse.

**How to apply:** generate label QR codes with the `qrcode` npm package's
`toDataURL(text, { margin: 4, ... })` and embed the result as a static `<img>` in the
print HTML, rather than rendering to a live canvas with a CDN script. `margin: 4` is the
value that fixed real-world re-scan failures in this app; don't go lower for printed
labels.
