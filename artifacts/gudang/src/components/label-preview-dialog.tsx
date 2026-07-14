import { useRef, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { type LabelData, generateLabelHtml, printLabel } from "@/lib/print-label";

interface LabelPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LabelData | null;
}

export function LabelPreviewDialog({ open, onOpenChange, data }: LabelPreviewDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !data || !iframeRef.current) return;
    setLoading(true);
    const iframe = iframeRef.current;
    let cancelled = false;
    const onLoad = () => setLoading(false);
    generateLabelHtml(data, true).then((html) => {
      if (cancelled || !iframeRef.current) return;
      iframeRef.current.srcdoc = html;
      iframeRef.current.addEventListener("load", onLoad);
    });
    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
    };
  }, [open, data]);

  // reset loading state when dialog closes
  useEffect(() => {
    if (!open) setLoading(true);
  }, [open]);

  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-4 h-4" />
            Preview Label (6cm × 3cm)
          </DialogTitle>
        </DialogHeader>

        {/* Label preview — exact ratio 60:30 = 2:1 */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="relative border-2 border-dashed border-border rounded overflow-hidden bg-white shadow-sm"
            style={{ width: 210, height: 105 }}
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
                width: 210,
                height: 105,
                border: "none",
                display: "block",
                pointerEvents: "none",
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Preview di atas ditampilkan dalam skala diperbesar.<br />
            Hasil cetak akan sesuai ukuran kertas 6cm × 3cm.
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
            Cetak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
