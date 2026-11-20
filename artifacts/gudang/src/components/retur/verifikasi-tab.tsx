// Tab VERIFIKASI (gudang): daftar dokumen status checked_supervisor, panel per unit dgn
// nomor inspeksi kini per dokumen diisi master dari Riwayat (bukan di tab ini);
// tabel pembanding data pengawas (kiri) vs form gudang (kanan),
// lalu POST /retur/:id/verify.
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Camera, ImageOff, ImagePlus, Loader2, PackageX, Paperclip } from "lucide-react";
import { DriveImg } from "./drive-img";
import {
  hasilBadgeClass, hasilDisplay, DEFAULT_RESULT_OPTIONS, ReturDetail, ReturDokumen, ReturItemCek, ReturTemplateItem,
  KEPUTUSAN_LABEL, Keputusan, FormDefinition, FormKeputusan,
  fmtTanggal, notifyReturChanged, readFileCompressed, returApi,
} from "./shared";

interface GudangItemForm {
  hasil: string; // "" = dilewati; selain itu = salah satu nilai opsi komponen tsb
  catatan: string;
  foto: string;
  ikutPengawas?: boolean; // true = slot foto memakai ulang foto pengawas (prefill), belum diganti
}

const emptyForm: GudangItemForm = { hasil: "", catatan: "", foto: "" };

interface ItemCfgEntry { options: string[] | null; tipeInput: "opsi" | "teks"; fotoWajib: boolean }

export function VerifikasiTab({ initialDok }: { initialDok?: number | null }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<ReturDokumen[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReturDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showTug10, setShowTug10] = useState(false);
  const [keputusanByUnit, setKeputusanByUnit] = useState<Record<number, Keputusan | "">>({});
  const [gudangCatatan, setGudangCatatan] = useState("");
  const [itemForms, setItemForms] = useState<Record<number, Record<string, GudangItemForm>>>({});
  // Multi-material: config komponen & template formulir disimpan PER MATERIAL milik unit.
  const [cfgByMaterial, setCfgByMaterial] = useState<Record<number, Record<string, ItemCfgEntry>>>({});
  const [formDefByMaterial, setFormDefByMaterial] = useState<Record<number, FormDefinition | null>>({});
  const [kesimpulanByUnit, setKesimpulanByUnit] = useState<Record<number, FormKeputusan | null>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectAlasan, setRejectAlasan] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const itemFileRef = useRef<HTMLInputElement>(null);
  const itemGalleryRef = useRef<HTMLInputElement>(null); // foto dari galeri device
  const photoTarget = useRef<{ unitId: number; label: string } | null>(null);

  // Komponen tanpa entri config (dokumen lama/preset) = opsi bawaan + foto wajib.
  const unitMat = (u: { materialId?: number }) => u.materialId ?? detail?.materialId ?? 0;
  const cfgFor = (u: { materialId?: number }, label: string): ItemCfgEntry =>
    (cfgByMaterial[unitMat(u)] ?? {})[label] ?? { options: null, tipeInput: "opsi", fotoWajib: true };
  const optionsFor = (u: { materialId?: number }, label: string) => cfgFor(u, label).options ?? DEFAULT_RESULT_OPTIONS;
  const formDefFor = (u: { materialId?: number }): FormDefinition | null => formDefByMaterial[unitMat(u)] ?? null;

  const loadDocs = async () => {
    try {
      const all = await returApi<ReturDokumen[]>("");
      setDocs(all.filter((d) => d.status === "checked_supervisor"));
      setListError(null);
    } catch (e) {
      setListError((e as Error).message);
      toast({ title: "Gagal memuat daftar retur", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { loadDocs(); }, []);

  const openDoc = async (id: number) => {
    setLoadingDetail(true);
    setShowTug10(false);
    try {
      const d = await returApi<ReturDetail>(`/${id}`);
      if (d.status !== "checked_supervisor") {
        // Dokumen sudah diverifikasi (mis. notifikasi lama dibuka lagi) — jangan render form verifikasi.
        toast({ title: "Dokumen sudah diverifikasi", description: `Dokumen #${id} berstatus selesai — buka lewat tab Riwayat.`, variant: "destructive" });
        return;
      }
      // Setiap material dalam dokumen punya template ceklist & formulir sendiri.
      const cfg: Record<number, Record<string, ItemCfgEntry>> = {};
      const fdefByMat: Record<number, FormDefinition | null> = {};
      const matIds = Array.from(new Set(
        [d.materialId, ...(d.materials ?? []).map((m) => m.id), ...d.units.map((u) => u.materialId ?? d.materialId)]
          .filter((x): x is number => x != null),
      ));
      await Promise.all(matIds.map(async (mid) => {
        try {
          const t = await returApi<{ items: ReturTemplateItem[] }>(`/template/${mid}`);
          cfg[mid] = Object.fromEntries((t.items ?? []).map((i) => [i.label, { options: i.options, tipeInput: i.tipeInput ?? "opsi", fotoWajib: i.fotoWajibGudang !== false }]));
        } catch { /* material tanpa template = pakai bawaan */ }
        try {
          const fd = await returApi<{ formKey: string | null; definition: FormDefinition | null }>(`/form-def/${mid}`);
          fdefByMat[mid] = fd.formKey ? fd.definition : null;
        } catch { fdefByMat[mid] = null; }
      }));
      setCfgByMaterial(cfg);
      setFormDefByMaterial(fdefByMat);
      const keputusan: Record<number, Keputusan | ""> = {};
      const kesimpulan: Record<number, FormKeputusan | null> = {};
      const forms: Record<number, Record<string, GudangItemForm>> = {};
      for (const u of d.units) {
        keputusan[u.id] = u.keputusan ?? "";
        kesimpulan[u.id] = u.formKeputusan ?? null;
        const labels: string[] = [];
        for (const it of u.items) if (!labels.includes(it.itemLabel)) labels.push(it.itemLabel);
        forms[u.id] = Object.fromEntries(labels.map((l) => {
          const gudangItem = u.items.find((it) => it.stage === "gudang" && it.itemLabel === l);
          if (gudangItem) return [l, { hasil: gudangItem.hasil, catatan: gudangItem.catatan ?? "", foto: "" }];
          // Default: hasil + catatan salinan cek pengawas (tetap bisa diedit). Nilai hanya
          // disalin bila masih ada di opsi komponen (template berubah -> kosong).
          const pw = u.items.find((it) => it.stage === "pengawas" && it.itemLabel === l);
          const teks = ((cfg[u.materialId ?? d.materialId] ?? {})[l]?.tipeInput ?? "opsi") === "teks";
          // item input-form: salin nilai bebas pengawas (kecuali placeholder lama "ISI DI KOLOM CATATAN")
          const salinTeks = teks && pw && pw.hasil && !/^isi di kolom catatan$/i.test(pw.hasil);
          // opsi: SELALU salin hasil pengawas — nilai yang tak lagi ada di daftar opsi (template
          // diubah setelah dokumen dibuat) tetap terpilih; render menambahkannya ke daftar opsi.
          return [l, { hasil: pw && (salinTeks || (!teks && pw.hasil)) ? pw.hasil : "", catatan: pw?.catatan ?? "", foto: "", ikutPengawas: !!pw?.fotoFileId }];
        }));
      }
      setDetail(d);
      setItemForms(forms);
      setKeputusanByUnit(keputusan);
      setKesimpulanByUnit(kesimpulan);
      setGudangCatatan(d.gudangCatatan ?? "");
    } catch (e) {
      toast({ title: "Gagal memuat dokumen", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (initialDok) openDoc(initialDok);
  }, [initialDok]);

  const handleItemFile = async (file?: File | null) => {
    const target = photoTarget.current;
    photoTarget.current = null;
    if (!file || !target) return;
    try {
      const dataUrl = await readFileCompressed(file);
      setItemForms((prev) => ({
        ...prev,
        [target.unitId]: {
          ...prev[target.unitId],
          [target.label]: { ...prev[target.unitId][target.label], foto: dataUrl, ikutPengawas: false },
        },
      }));
    } catch {
      toast({ title: "Gagal memproses foto", variant: "destructive" });
    }
  };

  const setItem = (unitId: number, label: string, patch: Partial<GudangItemForm>) => {
    setItemForms((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [label]: { ...prev[unitId][label], ...patch } },
    }));
  };

  const submit = async () => {
    if (!detail) return;
    const keputusanKosong = detail.units.filter((u) => !keputusanByUnit[u.id]).map((u) => u.label);
    if (keputusanKosong.length > 0) {
      toast({ title: "Keputusan unit wajib dipilih", description: `Pilih "Layak Pakai (Standby)" atau "Tidak Layak Pakai (Usul Hapus)" untuk unit: ${keputusanKosong.join(", ")}`, variant: "destructive" });
      return;
    }
    const butuhKesimpulan = detail.units.filter((u) => (formDefFor(u)?.kesimpulan?.options?.length ?? 0) > 0);
    if (butuhKesimpulan.length > 0) {
      const tanpaKesimpulan = butuhKesimpulan.filter((u) => !kesimpulanByUnit[u.id]?.code).map((u) => u.label);
      if (tanpaKesimpulan.length > 0) {
        toast({ title: "Kesimpulan formulir wajib dipilih", description: `Pilih kesimpulan (K6/K7/K8) untuk unit: ${tanpaKesimpulan.join(", ")}`, variant: "destructive" });
        return;
      }
    }
    // Wajib foto gudang mengikuti pengawas: hanya item yang difoto pengawas yang menuntut foto gudang.
    const tanpaFoto: string[] = [];
    for (const u of detail.units) {
      const pwFotoLabels = new Set(u.items.filter((it) => it.stage === "pengawas" && it.fotoFileId).map((it) => it.itemLabel));
      for (const [label, f] of Object.entries(itemForms[u.id] ?? {})) {
        if (f.hasil && !f.foto && !f.ikutPengawas && cfgFor(u, label).fotoWajib && pwFotoLabels.has(label)) tanpaFoto.push(`${u.label} — ${label}`);
      }
    }
    if (tanpaFoto.length > 0) {
      toast({ title: "Item wajib foto belum difoto", description: tanpaFoto.join("; "), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await returApi(`/${detail.id}/verify`, {
        method: "POST",
        body: JSON.stringify({
          gudangCatatan: gudangCatatan.trim(),
          units: detail.units.map((u) => {
            const fk = kesimpulanByUnit[u.id];
            const unitPunyaKesimpulan = (formDefFor(u)?.kesimpulan?.options?.length ?? 0) > 0;
            return {
            unitId: u.id,
            keputusan: keputusanByUnit[u.id],
            ...(unitPunyaKesimpulan && fk?.code ? {
              formKeputusan: {
                code: fk.code,
                ...(fk.meterLayak?.trim() ? { meterLayak: fk.meterLayak.trim() } : {}),
                ...(fk.meterTidakLayak?.trim() ? { meterTidakLayak: fk.meterTidakLayak.trim() } : {}),
              },
            } : {}),
            items: Object.entries(itemForms[u.id] ?? {})
              .filter(([, f]) => f.hasil)
              .map(([label, f]) => ({ label, hasil: f.hasil, catatan: f.catatan, ...(f.foto ? { foto: f.foto } : f.ikutPengawas ? { fotoIkutPengawas: true } : {}) })),
            };
          }),
        }),
      });
      toast({ title: "Verifikasi gudang selesai", description: `Dokumen #${detail.id} berstatus selesai.` });
      setDetail(null);
      setShowTug10(false);
      loadDocs();
      notifyReturChanged();
    } catch (e) {
      toast({ title: "Gagal memverifikasi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const rejectVerify = async () => {
    if (!detail) return;
    const alasan = rejectAlasan.trim();
    if (!alasan) return;
    setRejecting(true);
    try {
      await returApi(`/${detail.id}/tolak-verifikasi`, { method: "POST", body: JSON.stringify({ alasan }) });
      toast({ title: "Verifikasi ditolak", description: `Dokumen #${detail.id} dihapus; alasan dikirim ke notifikasi pengawas & gudang.` });
      setRejectOpen(false); setRejectAlasan("");
      setDetail(null); setShowTug10(false);
      loadDocs();
      notifyReturChanged();
    } catch (e) {
      toast({ title: "Gagal menolak verifikasi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRejecting(false);
    }
  };

  if (loadingDetail) {
    return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Memuat dokumen...</p>;
  }

  if (detail) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setDetail(null); setShowTug10(false); }}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Kembali
            </Button>
            <h3 className="text-lg font-bold">Retur #{detail.id} — {(detail.materials?.length ?? 0) > 1 ? (detail.materials as { name: string }[]).map((m) => m.name).join(" + ") : detail.materialName}</h3>
            <Badge variant="secondary" className="capitalize">{detail.status === "checked_supervisor" ? "Menunggu verifikasi" : detail.status}</Badge>
            {detail.jumlahUnit && detail.jumlahUnit > detail.units.length && (
              <Badge className="bg-sky-100 text-sky-800">Sampling: {detail.units.length} unit contoh untuk {detail.jumlahUnit} unit</Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowTug10((v) => !v)}>
            {showTug10 ? "Sembunyikan" : "Tampilkan"} foto TUG10
          </Button>
        </div>
        {detail.lampiran && detail.lampiran.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground inline-flex items-center gap-1"><Paperclip className="h-4 w-4" /> Lampiran ({detail.lampiran.length}):</span>
            {detail.lampiran.map((l) => (
              <a key={l.fileId} href={l.webViewLink} target="_blank" rel="noreferrer" className="underline text-primary truncate max-w-60">{l.name}</a>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground grid gap-1 sm:grid-cols-2">
          <span>Pengawas: <b className="text-foreground">{detail.pengawasName ?? "-"}</b></span>
          <span>Cek pengawas: {fmtTanggal(detail.checkedAt)}</span>
          {detail.catatan && <span className="sm:col-span-2">Catatan pengawas: {detail.catatan}</span>}
        </div>

        {showTug10 && (
          <DriveImg fileId={detail.tug10FileId} alt={`Foto TUG10 dokumen ${detail.id}`} className="w-96 max-h-24" imgClassName="max-h-[60vh] w-full object-contain" />
        )}

        {detail.units.map((u) => {
          const labels: string[] = [];
          for (const it of u.items) if (!labels.includes(it.itemLabel)) labels.push(it.itemLabel);
          const pengawasOf = (label: string): ReturItemCek | undefined =>
            u.items.find((it) => it.stage === "pengawas" && it.itemLabel === label);
          const fd = formDefFor(u); // definisi formulir material milik unit ini
          return (
            <Card key={u.id}>
              <CardHeader className="py-3 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">{(detail.materials?.length ?? 0) > 1 && u.materialName ? <span className="text-muted-foreground">{u.materialName} — </span> : null}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="text-xs font-medium">Keputusan unit (wajib pilih salah satu):</span>
                  {(["layak_pakai", "usul_hapus"] as const).map((k) => (
                    <Button key={k} size="sm" type="button"
                      variant={keputusanByUnit[u.id] === k ? "default" : "outline"}
                      className={keputusanByUnit[u.id] === k ? (k === "layak_pakai" ? "bg-emerald-600 hover:bg-emerald-600" : "bg-red-600 hover:bg-red-600") : ""}
                      onClick={() => setKeputusanByUnit((prev) => ({ ...prev, [u.id]: keputusanByUnit[u.id] === k ? "" : k }))}>
                      {KEPUTUSAN_LABEL[k]}
                    </Button>
                  ))}
                  {!keputusanByUnit[u.id] && <span className="text-xs text-destructive">belum dipilih</span>}
                </div>
                {fd?.kesimpulan?.options?.length ? (
                  <div className="mb-4 space-y-2 border-t border-border/50 pt-3">
                    <p className="text-xs font-medium">
                      Kesimpulan formulir inspeksi (wajib — tercetak di Cetak Formulir {fd.formCode}):
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {fd.kesimpulan.options.map((o) => (
                        <Button key={o.code} size="sm" type="button"
                          variant={kesimpulanByUnit[u.id]?.code === o.code ? "default" : "outline"}
                          onClick={() => setKesimpulanByUnit((prev) => ({
                            ...prev,
                            [u.id]: prev[u.id]?.code === o.code
                              ? null
                              : { code: o.code, meterLayak: prev[u.id]?.meterLayak, meterTidakLayak: prev[u.id]?.meterTidakLayak },
                          }))}>
                          {o.label}
                        </Button>
                      ))}
                      {!kesimpulanByUnit[u.id]?.code && <span className="text-xs text-destructive">belum dipilih</span>}
                    </div>
                    {fd.kesimpulan.mode === "meter" && kesimpulanByUnit[u.id] && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
                        <div className="space-y-1">
                          <Label className="text-xs">Panjang bekas layak pakai (meter)</Label>
                          <Input className="h-8 text-sm" placeholder="mis. 25.5"
                            value={kesimpulanByUnit[u.id]?.meterLayak ?? ""}
                            onChange={(e) => setKesimpulanByUnit((prev) => ({ ...prev, [u.id]: { ...(prev[u.id] as FormKeputusan), meterLayak: e.target.value } }))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Panjang bekas tidak layak pakai (meter)</Label>
                          <Input className="h-8 text-sm" placeholder="mis. 4"
                            value={kesimpulanByUnit[u.id]?.meterTidakLayak ?? ""}
                            onChange={(e) => setKesimpulanByUnit((prev) => ({ ...prev, [u.id]: { ...(prev[u.id] as FormKeputusan), meterTidakLayak: e.target.value } }))} />
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
                {labels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Unit ini tanpa item pemeriksaan.</p>
                ) : (
                  <>
                  <p className="text-xs text-muted-foreground mb-2">Komponen bertanda <span className="text-red-600 font-bold">*</span> wajib difoto — aturannya mengikuti pengawas: hanya komponen yang difoto pengawas yang menuntut foto gudang (verifikasi ditolak bila hasil diisi tanpa foto). Hasil &amp; catatan gudang terisi otomatis mengikuti cek pengawas — ubah seperlunya bila hasil gudang berbeda. Foto gudang otomatis terisi sama dengan foto pengawas — klik Ganti/Galeri untuk menggantinya.</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Komponen</TableHead>
                        <TableHead>Hasil pengawas</TableHead>
                        <TableHead>Foto pengawas</TableHead>
                        <TableHead>Hasil gudang</TableHead>
                        <TableHead>Catatan gudang</TableHead>
                        <TableHead>Foto gudang</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {labels.map((label) => {
                        const pw = pengawasOf(label);
                        const f = itemForms[u.id]?.[label] ?? emptyForm;
                        const fotoWajibEfektif = cfgFor(u, label).fotoWajib && !!pw?.fotoFileId;
                        return (
                          <TableRow key={label}>
                            <TableCell className="text-sm max-w-[220px]">
                              {label}
                              {fotoWajibEfektif && (
                                <span className="text-red-600 font-bold ml-1" title="Foto wajib — pengawas memfoto komponen ini">*</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {pw
                                ? (
                                  <div className="space-y-1">
                                    <Badge className={hasilBadgeClass(pw.hasil)}>{hasilDisplay(pw.hasil)}</Badge>
                                    {pw.catatan && <p className="text-xs text-muted-foreground">{pw.catatan}</p>}
                                  </div>
                                )
                                : <span className="text-xs text-muted-foreground">dilewati</span>}
                            </TableCell>
                            <TableCell>
                              {pw?.fotoFileId ? <DriveImg fileId={pw.fotoFileId} alt={`Foto pengawas: ${label}`} /> : <ImageOff className="h-4 w-4 text-muted-foreground/50" />}
                            </TableCell>
                            <TableCell>
                              {cfgFor(u, label).tipeInput === "teks" ? (
                                <Input className="h-8 w-28 text-xs" placeholder="Ketik hasil..." value={f.hasil}
                                  onChange={(e) => setItem(u.id, label, { hasil: e.target.value })} />
                              ) : (
                                <Select value={f.hasil || "skip"} onValueChange={(v) => setItem(u.id, label, { hasil: v === "skip" ? "" : v })}>
                                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Lewati" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="skip">Kosong (lewati)</SelectItem>
                                    {(() => {
                                      const opts = optionsFor(u, label);
                                      const shown = f.hasil && !opts.includes(f.hasil) ? [...opts, f.hasil] : opts;
                                      return shown.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>);
                                    })()}
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input className="h-8 text-xs" placeholder="Catatan" value={f.catatan}
                                onChange={(e) => setItem(u.id, label, { catatan: e.target.value })} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant={f.hasil && !f.foto && !f.ikutPengawas && fotoWajibEfektif ? "destructive" : "outline"}
                                  onClick={() => { photoTarget.current = { unitId: u.id, label }; itemFileRef.current?.click(); }}>
                                  <Camera className="h-3.5 w-3.5 mr-1" /> {f.foto || f.ikutPengawas ? "Ganti" : "Foto"}
                                </Button>
                                <Button size="sm" variant="outline"
                                  onClick={() => { photoTarget.current = { unitId: u.id, label }; itemGalleryRef.current?.click(); }}>
                                  <ImagePlus className="h-3.5 w-3.5 mr-1" /> Galeri
                                </Button>
                                {f.foto
                                  ? <img src={f.foto} alt={`Foto gudang: ${label}`} className="h-10 w-10 rounded border object-cover" />
                                  : f.ikutPengawas && pw?.fotoFileId
                                    ? (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <DriveImg fileId={pw.fotoFileId} alt={`Foto gudang (sama dengan pengawas): ${label}`} className="h-10 w-10" />
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">sama dgn pengawas</span>
                                      </div>
                                    )
                                    : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Catatan gudang</CardTitle></CardHeader>
          <CardContent>
            <Textarea value={gudangCatatan} onChange={(e) => setGudangCatatan(e.target.value)} placeholder="Catatan dari petugas gudang..." rows={3} />
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => { setDetail(null); setShowTug10(false); }}>Batal</Button>
          <Button variant="destructive" onClick={() => setRejectOpen(true)}>Tolak Verifikasi</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Kirim Verifikasi Gudang
          </Button>
        </div>

        <AlertDialog open={rejectOpen} onOpenChange={(v) => { setRejectOpen(v); if (!v) setRejectAlasan(""); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Tolak verifikasi dokumen #{detail.id}?</AlertDialogTitle>
              <AlertDialogDescription>
                Seluruh data retur dokumen ini (unit, ceklist, foto, data material, file Drive) akan DIHAPUS permanen.
                Alasan di bawah dikirim sebagai notifikasi ke pengawas pembuat dokumen dan petugas gudang.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Label className="text-xs font-medium">Alasan penolakan (wajib)</Label>
            <Textarea rows={3} value={rejectAlasan} onChange={(e) => setRejectAlasan(e.target.value)}
              placeholder="Contoh: material tidak sesuai fisik, foto tidak jelas, dokumen salah input..." maxLength={500} />
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction disabled={!rejectAlasan.trim() || rejecting}
                onClick={(e) => { e.preventDefault(); void rejectVerify(); }}>
                {rejecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Tolak &amp; Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <input ref={itemFileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { handleItemFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <input ref={itemGalleryRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { handleItemFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><PackageX className="h-4 w-4" /> Menunggu verifikasi gudang</CardTitle>
      </CardHeader>
      <CardContent>
        {loadingList ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Memuat...</p>
        ) : docs.length === 0 ? (
          listError ? (
            <p className="text-sm text-destructive">
              Gagal memuat daftar retur: {listError}{" "}
              <button className="underline" onClick={loadDocs}>Coba lagi</button>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Tidak ada dokumen retur yang menunggu verifikasi.</p>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Pengawas</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Cek pengawas</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono">{d.id}</TableCell>
                  <TableCell title={(d.materials ?? []).map((m) => m.name).join(", ")}>{(d.materials?.length ?? 0) > 1 ? `${d.materials![0].name} +${d.materials!.length - 1}` : d.materialName}</TableCell>
                  <TableCell>{d.pengawasName ?? "-"}</TableCell>
                  <TableCell>{d.unitCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtTanggal(d.checkedAt)}</TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => openDoc(d.id)}>Verifikasi</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
