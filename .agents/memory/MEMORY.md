# Memory Index

- [Gudang Pemaron: orval codegen contract](gudang-orval-codegen.md) — API params/response shapes must live in openapi.yaml, not be hand-added to generated files; a stockOnly-style ad-hoc param gets silently dropped on the next `pnpm codegen` run.
- [Gudang Pemaron: QR quiet zone](gudang-qr-quiet-zone.md) — QR codes need margin ≥4 (in the `qrcode` npm package) to stay reliably re-scannable after printing.
