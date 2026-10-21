// Tab RIWAYAT (gudang): dokumen selesai (completed), tabel checkable, Export Excel & PDF
// sepenuhnya CLIENT-SIDE (exceljs + jspdf). Bytes foto diambil via GET /api/retur/file/:fileId.
// Master dapat menghapus dokumen (DELETE /api/retur/:id) — tombol + dialog konfirmasi per baris.
import { useCallback, useEffect, useState } from "react";
import * as exceljsNs from "exceljs";
// d.ts exceljs memakai named exports tetapi Vite pre-bundel build UMD-nya, jadi anggota
// modul bisa berada di bawah `default`; bundel boundary ini diberi tipe sekali di sini.
type ExcelJsModule = typeof exceljsNs & { default?: typeof exceljsNs };
const exceljsModule = exceljsNs as ExcelJsModule;
const ExcelJS = exceljsModule.default ?? exceljsModule;
import { jsPDF } from "jspdf";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { CheckCircle2, Download, FileSpreadsheet, FileText, Loader2, Search, Trash2 } from "lucide-react";
import { DriveImg } from "./drive-img";
import {
  hasilDisplay, ReturDetail, ReturDokumen,
  KEPUTUSAN_BADGE, KEPUTUSAN_LABEL, Keputusan,
  downloadBlob, fetchReturFile, fmtTanggal, notifyReturChanged, returApi,
} from "./shared";

interface DocFiles {
  detail: ReturDetail;
  files: Map<string, { bytes: ArrayBuffer; contentType: string }>;
}

const fileExt = (contentType: string): "png" | "jpeg" => (contentType.includes("png") ? "png" : "jpeg");

const bytesToBase64 = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i += 8192) bin += String.fromCharCode(...view.subarray(i, i + 8192));
  return btoa(bin);
};

export function RiwayatTab() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<ReturDokumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const [q, setQ] = useState("");
  const [keputusanF, setKeputusanF] = useState<"semua" | Keputusan>("semua");
  const { user } = useAuth();
  const canDelete = user?.role === "master";
  const [toDelete, setToDelete] = useState<ReturDokumen | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter server-side (status=completed wajib utk riwayat); q didebounce 300 ms.
  const loadDocs = useCallback(() => {
    const params = new URLSearchParams({ status: "completed" });
    if (q.trim()) params.set("q", q.trim());
    if (keputusanF !== "semua") params.set("keputusan", keputusanF);
    returApi<ReturDokumen[]>(`?${params.toString()}`)
      .then(setDocs)
      .catch((e) => toast({ title: "Gagal memuat riwayat", description: (e as Error).message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [q, keputusanF, toast]);

  useEffect(() => {
    const t = setTimeout(loadDocs, 300);
    return () => clearTimeout(t);
  }, [loadDocs]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await returApi(`/${toDelete.id}`, { method: "DELETE" });
      toast({ title: `Dokumen #${toDelete.id} dihapus`, description: "Data DB dan foto di Google Drive ikut dihapus." });
      setToDelete(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(toDelete.id);
        return next;
      });
      notifyReturChanged();
      loadDocs();
    } catch (e) {
      toast({ title: "Gagal menghapus dokumen", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };
  const toggleAll = () => {
    setSelected((prev) => prev.size === docs.length ? new Set<number>() : new Set(docs.map((d) => d.id)));
  };

  const gather = async (ids: number[]): Promise<DocFiles[]> => {
    const out: DocFiles[] = [];
    for (const id of ids) {
      const detail = await returApi<ReturDetail>(`/${id}`);
      const fileIds = new Set<string>([
        detail.tug10FileId,
        ...detail.units.flatMap((u) => u.items.map((i) => i.fotoFileId)),
      ]);
      const files = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
      await Promise.all([...fileIds].map(async (fid) => {
        try {
          files.set(fid, await fetchReturFile(fid));
        } catch {
          // foto gagal diunduh dari Drive — diekspor dengan catatan, bukan menggagalkan seluruh dokumen
        }
      }));
      out.push({ detail, files });
    }
    return out;
  };

  const exportNames = (ids: number[], ext: string) =>
    ids.length === 1 ? `retur-${ids[0]}.${ext}` : `retur-${ids.length}-dokumen.${ext}`;

  const exportExcel = async () => {
    const ids = docs.filter((d) => selected.has(d.id)).map((d) => d.id);
    if (ids.length === 0) { toast({ title: "Pilih minimal satu dokumen", variant: "destructive" }); return; }
    setExporting("excel");
    try {
      const items = await gather(ids);
      const wb = new ExcelJS.Workbook();
      wb.creator = "Gudang Pemaron";
      for (const { detail, files } of items) {
        const ws = wb.addWorksheet(`Retur ${detail.id}`);
        ws.columns = [{ width: 40 }, { width: 18 }, { width: 34 }, { width: 18 }, { width: 34 }];
        let r = 1;
        ws.getCell(r, 1).value = `RETUR MATERIAL #${detail.id}`;
        ws.getCell(r, 1).font = { bold: true, size: 14 };
        r += 2;
        const info: [string, string][] = [
          ["Tanggal", fmtTanggal(detail.createdAt)],
          ["Material", detail.materialName],
          ["Pengawas", detail.pengawasName ?? "-"],
          ["Gudang", detail.gudangName ?? "-"],
          ["Status", "Selesai diverifikasi"],
          ["Catatan", detail.catatan ?? "-"],
          ["Catatan Gudang", detail.gudangCatatan ?? "-"],
        ];
        for (const [k, v] of info) {
          ws.getCell(r, 1).value = k;
          ws.getCell(r, 1).font = { bold: true };
          ws.getCell(r, 2).value = v;
          r += 1;
        }
        r += 2;
        for (const u of detail.units) {
          ws.getCell(r, 1).value = `Unit ${u.label} — SN ${u.sn ?? "-"} — Keputusan: ${u.keputusan ? KEPUTUSAN_LABEL[u.keputusan] : "-"}`;
          ws.getCell(r, 1).font = { bold: true };
          r += 1;
          const header = ws.getRow(r);
          header.values = ["Komponen", "Hasil Pengawas", "Catatan Pengawas", "Hasil Gudang", "Catatan Gudang"];
          header.font = { bold: true };
          header.eachCell((c) => {
            c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
          });
          r += 1;
          const labels: string[] = [];
          for (const it of u.items) if (!labels.includes(it.itemLabel)) labels.push(it.itemLabel);
          for (const label of labels) {
            const pw = u.items.find((i) => i.stage === "pengawas" && i.itemLabel === label);
            const gw = u.items.find((i) => i.stage === "gudang" && i.itemLabel === label);
            ws.getRow(r).values = [
              label,
              pw ? hasilDisplay(pw.hasil) : "-",
              pw?.catatan ?? "",
              gw ? hasilDisplay(gw.hasil) : "-",
              gw?.catatan ?? "",
            ];
            r += 1;
          }
          r += 1;
          // Foto: 2 per baris grid; 150x110px ≈ 6 baris tinggi sel.
          let col = 1;
          for (const it of u.items) {
            ws.getCell(r, col).value = `${it.stage} — ${it.itemLabel}`;
            ws.getCell(r, col).font = { size: 9, italic: true };
            const f = files.get(it.fotoFileId);
            if (f) {
              const imageId = wb.addImage({ base64: bytesToBase64(f.bytes), extension: fileExt(f.contentType) });
              ws.addImage(imageId, { tl: { col: col - 1, row: r }, ext: { width: 150, height: 110 } });
            } else {
              ws.getCell(r + 1, col).value = "(foto gagal diunduh)";
            }
            if (col === 1) {
              col = 4;
            } else {
              col = 1;
              r += 7;
            }
          }
          if (col === 4) r += 7;
          r += 2;
        }
      }
      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        exportNames(ids, "xlsx"),
      );
      toast({ title: `Excel ${ids.length} dokumen terunduh` });
    } catch (e) {
      toast({ title: "Gagal membuat Excel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    const ids = docs.filter((d) => selected.has(d.id)).map((d) => d.id);
    if (ids.length === 0) { toast({ title: "Pilih minimal satu dokumen", variant: "destructive" }); return; }
    setExporting("pdf");
    try {
      const items = await gather(ids);
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 12;
      let y = margin;
      const ensure = (h: number) => {
        if (y + h > pageH - margin) { doc.addPage(); y = margin; }
      };

      for (let di = 0; di < items.length; di++) {
        const { detail, files } = items[di];
        if (di > 0) { doc.addPage(); y = margin; }

        doc.setFont("helvetica", "bold"); doc.setFontSize(14);
        doc.text(`RETUR MATERIAL #${detail.id}`, margin, y); y += 7;
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        const info: [string, string][] = [
          ["Tanggal", fmtTanggal(detail.createdAt)],
          ["Material", detail.materialName],
          ["Status", "Selesai diverifikasi"],
          ["Pengawas", detail.pengawasName ?? "-"],
          ["Gudang", detail.gudangName ?? "-"],
        ];
        for (const [k, v] of info) {
          ensure(5);
          doc.setFont("helvetica", "bold"); doc.text(`${k}:`, margin, y);
          doc.setFont("helvetica", "normal"); doc.text(v, margin + 32, y);
          y += 5;
        }
        for (const [k, v] of [["Catatan", detail.catatan ?? "-"], ["Catatan Gudang", detail.gudangCatatan ?? "-"]] as [string, string][]) {
          doc.setFont("helvetica", "bold"); doc.text(`${k}:`, margin, y); y += 4.5;
          doc.setFont("helvetica", "normal"); doc.setFontSize(8);
          for (const ln of doc.splitTextToSize(v, pageW - 2 * margin)) {
            ensure(4.5);
            doc.text(ln, margin, y); y += 4;
          }
          doc.setFontSize(9);
          y += 1.5;
        }

        const tug10 = files.get(detail.tug10FileId);
        if (tug10) {
          const dim = await measureImage(tug10.bytes);
          let w = Math.min(170, pageW - 2 * margin);
          let h = (w * dim.h) / dim.w;
          if (h > 110) { h = 110; w = (h * dim.w) / dim.h; }
          ensure(h + 4);
          doc.addImage(new Uint8Array(tug10.bytes), fileExt(tug10.contentType).toUpperCase(), (pageW - w) / 2, y, w, h);
          y += h + 6;
        } else {
          doc.setFontSize(8); doc.text("(foto TUG10 gagal diunduh)", margin, y); y += 6;
        }

        for (const u of detail.units) {
          ensure(14);
          doc.setFont("helvetica", "bold"); doc.setFontSize(11);
          doc.text(`Unit ${u.label} — SN ${u.sn ?? "-"} — Keputusan: ${u.keputusan ? KEPUTUSAN_LABEL[u.keputusan] : "-"}`, margin, y); y += 5;
          doc.setFontSize(8);
          const colW = [52, 24, 40, 24, 46];
          const colX = [margin];
          for (let i = 1; i < colW.length; i++) colX.push(colX[i - 1] + colW[i - 1]);
          const headers = ["Komponen", "Hasil Pengawas", "Catatan", "Hasil Gudang", "Catatan"];
          const drawRow = (cells: string[], bold: boolean) => {
            const split = cells.map((c, i) => doc.splitTextToSize(c, colW[i] - 2));
            const lines = Math.max(...split.map((s) => s.length), 1);
            ensure(lines * 4 + 2);
            doc.setFont("helvetica", bold ? "bold" : "normal");
            split.forEach((s, i) => doc.text(s, colX[i], y));
            y += lines * 4 + 1;
            doc.setLineWidth(0.1); doc.line(margin, y - 1.5, pageW - margin, y - 1.5);
          };
          drawRow(headers, true);
          const labels: string[] = [];
          for (const it of u.items) if (!labels.includes(it.itemLabel)) labels.push(it.itemLabel);
          for (const label of labels) {
            const pw = u.items.find((i) => i.stage === "pengawas" && i.itemLabel === label);
            const gw = u.items.find((i) => i.stage === "gudang" && i.itemLabel === label);
            drawRow([
              label,
              pw ? hasilDisplay(pw.hasil) : "-",
              pw?.catatan ?? "",
              gw ? hasilDisplay(gw.hasil) : "-",
              gw?.catatan ?? "",
            ], false);
          }
          y += 2;
          // Foto grid 2 kolom ±45mm, tiap foto berlabel stage+item.
          const photos = u.items.map((it) => ({ label: `${it.stage} — ${it.itemLabel}`, fileId: it.fotoFileId }));
          for (let p = 0; p < photos.length; p += 2) {
            const pair = photos.slice(p, p + 2);
            const dims = await Promise.all(pair.map((ph) => {
              const f = files.get(ph.fileId);
              return f ? measureImage(f.bytes) : null;
            }));
            const heights = dims.map((d) => (d ? Math.min(45, (45 * d.h) / d.w) : 8));
            ensure(8 + Math.max(...heights) + 2);
            pair.forEach((ph, i) => {
              const x = margin + i * 50;
              doc.setFont("helvetica", "italic"); doc.setFontSize(7);
              doc.text(ph.label, x, y);
              const f = files.get(ph.fileId);
              if (f && dims[i]) {
                const h = heights[i];
                doc.addImage(new Uint8Array(f.bytes), fileExt(f.contentType).toUpperCase(), x, y + 1.5, 45, h);
              } else {
                doc.text("(gagal)", x, y + 5);
              }
            });
            y += 1.5 + Math.max(...heights) + 2.5;
          }
          y += 3;
        }
      }

      downloadBlob(doc.output("blob"), exportNames(ids, "pdf"));
      toast({ title: `PDF ${ids.length} dokumen terunduh` });
    } catch (e) {
      toast({ title: "Gagal membuat PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Dokumen selesai ({docs.length})</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportExcel} disabled={exporting !== null || selected.size === 0}>
            {exporting === "excel" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
            Export Excel
          </Button>
          <Button size="sm" variant="outline" onClick={exportPdf} disabled={exporting !== null || selected.size === 0}>
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Export PDF
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
            <Input className="h-8 w-64 pl-8 text-sm" placeholder="Cari nama / kode material..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={keputusanF} onValueChange={(v) => setKeputusanF(v as "semua" | Keputusan)}>
            <SelectTrigger className="h-8 w-64 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semua">Semua keputusan</SelectItem>
              <SelectItem value="layak_pakai">Layak Pakai (Standby)</SelectItem>
              <SelectItem value="usul_hapus">Tidak Layak Pakai (Usul Hapus)</SelectItem>
            </SelectContent>
          </Select>
          {(q.trim() !== "" || keputusanF !== "semua") && (
            <Button size="sm" variant="ghost" onClick={() => { setQ(""); setKeputusanF("semua"); }}>Reset filter</Button>
          )}
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Memuat...</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{q.trim() !== "" || keputusanF !== "semua" ? "Tidak ada dokumen yang cocok dengan filter." : "Belum ada dokumen retur yang selesai diverifikasi."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === docs.length && docs.length > 0} onCheckedChange={toggleAll} aria-label="Pilih semua" />
                </TableHead>
                <TableHead>#</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Pengawas</TableHead>
                <TableHead>Gudang</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Keputusan</TableHead>
                <TableHead>Selesai</TableHead>
                <TableHead>TUG10</TableHead>
                {canDelete && <TableHead className="w-10">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label={`Pilih dokumen ${d.id}`} />
                  </TableCell>
                  <TableCell className="font-mono">{d.id}</TableCell>
                  <TableCell>{d.materialName}</TableCell>
                  <TableCell>{d.pengawasName ?? "-"}</TableCell>
                  <TableCell>{d.gudangName ?? "-"}</TableCell>
                  <TableCell>{d.unitCount}</TableCell>
                  <TableCell>
                    {d.keputusan
                      ? <Badge className={KEPUTUSAN_BADGE[d.keputusan]}>{KEPUTUSAN_LABEL[d.keputusan]}</Badge>
                      : <span className="text-xs text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtTanggal(d.completedAt)}</TableCell>
                  <TableCell>
                    <DriveImg fileId={d.tug10FileId} alt={`TUG10 #${d.id}`} />
                  </TableCell>
                  {canDelete && (
                    <TableCell>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                        onClick={() => setToDelete(d)} aria-label={`Hapus dokumen ${d.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {selected.size > 0 && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <Download className="h-3 w-3" /> {selected.size} dokumen terpilih — filename: <code>{exportNames(docs.filter((d) => selected.has(d.id)).map((d) => d.id), "pdf|xlsx")}</code>
          </p>
        )}
      </CardContent>
    </Card>
    <AlertDialog open={toDelete !== null} onOpenChange={(open) => { if (!open) setToDelete(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus dokumen retur #{toDelete?.id}?</AlertDialogTitle>
          <AlertDialogDescription>
            Dokumen <b>{toDelete?.materialName}</b> beserta unit, hasil ceklist, dan notifikasinya akan
            dihapus permanen dari database. Foto TUG10 dan foto ceklist di Google Drive juga ikut dihapus.
            Tindakan ini tidak bisa dibatalkan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
            {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Hapus
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

// Ukuran natural bytes gambar utk menghitung rasio aspek saat menyisip ke PDF.
const measureImage = (bytes: ArrayBuffer): Promise<{ w: number; h: number }> => {
  const { promise, resolve, reject } = Promise.withResolvers<{ w: number; h: number }>();
  const url = URL.createObjectURL(new Blob([bytes]));
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 }); };
  img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 800, h: 600 }); };
  img.src = url;
  return promise;
};
