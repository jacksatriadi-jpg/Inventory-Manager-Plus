import { useRef, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Loader2, QrCode, ClipboardList } from "lucide-react";
import { type LabelData, generateLabelHtml, printLabel } from "@/lib/print-label";

interface LabelPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LabelData | null;
}

// Each label page is 60mm × 30mm; we scale 3.5× for the dialog.
const SCALE  = 3.5;
const PAGE_W = Math.round(60 * SCALE); // 210 px
const PAGE_H = Math.round(30 * SCALE); // 105 px
const GAP    = 8;                       // px gap between page 1 and page 2

export function LabelPreviewDialog({ open, onOpenChange, data }: LabelPreviewDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !data || !iframeRef.current) return;
    setLoading(true);
    let cancelled = false;
    const iframe = iframeRef.current;
    const onLoad = () => { if (!cancelled) setLoading(false); };

    generateLabelHtml(data, true).then((html) => {
      if (cancelled || !iframeRef.current) return;
      iframeRef.current.addEventListener("load", onLoad, { once: true });
      iframeRef.current.srcdoc = html;
    });

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
    };
  }, [open, data]);

  useEffect(() => { if (!open) setLoading(true); }, [open]);

  if (!data) return null;

  const totalH = PAGE_H * 2 + GAP;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-4 h-4" />
            Preview Label SATO (6cm × 3cm)
          </DialogTitle>
        </DialogHeader>

        {/* Two-page preview */}
        <div className="flex flex-col items-center gap-3">
          {/* Page labels */}
          <div className="flex w-full justify-between px-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <QrCode className="w-3 h-3" /> Halaman 1 — QR Code
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ClipboardList className="w-3 h-3" /> Halaman 2 — Data Inspeksi
            </span>
          </div>

          {/* Iframe container — tall enough for 2 label pages */}
          <div
            className="relative border-2 border-dashed border-border rounded overflow-hidden bg-white shadow-sm"
            style={{ width: PAGE_W, height: totalH }}
          >
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              title="Label Preview"
              scrolling="no"
              style={{
                width:  PAGE_W,
                height: totalH,
                border: "none",
                display: "block",
                pointerEvents: "none",
              }}
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Cetak menghasilkan <strong>2 label</strong> per record —
            QR code &amp; data inspeksi terpisah.<br />
            Skala diperbesar untuk preview; hasil cetak 6cm × 3cm.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            onClick={() => {
              if (data) void printLabel(data);
              onOpenChange(false);
            }}
            className="gap-2"
          >
            <Printer className="w-4 h-4" />
            Cetak 2 Halaman
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
