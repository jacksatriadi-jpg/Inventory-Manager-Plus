// DriveImg: tampilkan foto yang tersimpan di Google Drive Retur.
// Bytes diambil via GET /api/retur/file/:fileId (Bearer), disimpan sebagai
// object URL dalam cache Map level-modul agar thumbnail yang sama tidak diunduh dua kali.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ImageOff } from "lucide-react";
import { fetchReturFile } from "./shared";

const objectUrlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function getObjectUrl(fileId: string): Promise<string> {
  const cached = objectUrlCache.get(fileId);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(fileId);
  if (pending) return pending;
  const task = fetchReturFile(fileId)
    .then(({ bytes, contentType }) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      objectUrlCache.set(fileId, url);
      inflight.delete(fileId);
      return url;
    })
    .catch((e) => {
      inflight.delete(fileId);
      throw e;
    });
  inflight.set(fileId, task);
  return task;
}

export function DriveImg({ fileId, alt, className, imgClassName }: { fileId: string; alt?: string; className?: string; imgClassName?: string }) {
  const [url, setUrl] = useState<string | null>(() => objectUrlCache.get(fileId) ?? null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (url || failed) return;
    let alive = true;
    getObjectUrl(fileId)
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [fileId, url, failed]);

  if (failed) {
    return (
      <div className={`${className ?? "h-14 w-14"} flex items-center justify-center rounded border border-dashed border-muted-foreground/40 text-muted-foreground`}>
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  if (!url) {
    return (
      <div className={`${className ?? "h-14 w-14"} flex items-center justify-center rounded border bg-muted`}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Klik untuk memperbesar" className="block">
        <img src={url} alt={alt ?? "Foto retur"} className={`${imgClassName ?? `${className ?? "h-14 w-14"} object-cover`} rounded border cursor-zoom-in`} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{alt ?? "Foto retur"}</DialogTitle>
          </DialogHeader>
          <img src={url} alt={alt ?? "Foto retur"} className="w-full max-h-[75vh] object-contain rounded border" />
        </DialogContent>
      </Dialog>
    </>
  );
}
