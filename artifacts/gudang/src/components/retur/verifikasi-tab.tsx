// Tab VERIFIKASI (gudang): daftar dokumen status checked_supervisor, panel per unit dgn
// input SN MIMS wajib, tabel pembanding data pengawas (kiri) vs form gudang (kanan),
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
import { ArrowLeft, Camera, ImageOff, Loader2, PackageX } from "lucide-react";
import { DriveImg } from "./drive-img";
import {
  hasilBadgeClass, hasilDisplay, DEFAULT_RESULT_OPTIONS, ReturDetail, ReturDokumen, ReturItemCek, ReturTemplateItem,
  KEPUTUSAN_LABEL, Keputusan,
  fmtTanggal, notifyReturChanged, readFileCompressed, returApi,
} from "./shared";

interface GudangItemForm {
  hasil: string; // "" = dilewati; selain itu = salah satu nilai opsi komponen tsb
  catatan: string;
  foto: string;
}

const emptyForm: GudangItemForm = { hasil: "", catatan: "", foto: "" };

export function VerifikasiTab({ initialDok }: { initialDok?: number | null }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<ReturDokumen[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [detail, setDetail] = useState<ReturDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showTug10, setShowTug10] = useState(false);
  const [snByUnit, setSnByUnit] = useState<Record<number, string>>({});
  const [keputusanByUnit, setKeputusanByUnit] = useState<Record<number, Keputusan | "">>({});
  const [gudangCatatan, setGudangCatatan] = useState("");
  const [itemForms, setItemForms] = useState<Record<number, Record<string, GudangItemForm>>>({});
  const [cfgByLabel, setCfgByLabel] = useState<Record<string, { options: string[] | null; tipeInput: "opsi" | "teks"; fotoWajib: boolean }>>({});

  const itemFileRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<{ unitId: number; label: string } | null>(null);

  // Komponen tanpa entri config (dokumen lama/preset) = opsi bawaan + foto wajib.
  const cfgFor = (label: string) => cfgByLabel[label] ?? { options: null as string[] | null, tipeInput: "opsi" as const, fotoWajib: true };
  const optionsFor = (label: string) => cfgFor(label).options ?? DEFAULT_RESULT_OPTIONS;

  const loadDocs = async () => {
    try {
      const all = await returApi<ReturDokumen[]>("");
      setDocs(all.filter((d) => d.status === "checked_supervisor"));
    } catch (e) {
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
      let cfg: Record<string, { options: string[] | null; tipeInput: "opsi" | "teks"; fotoWajib: boolean }> = {};
      try {
        const materialId = docs.find((x) => x.id === id)?.materialId;
        if (materialId != null) {
          const t = await returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`);
          cfg = Object.fromEntries((t.items ?? []).map((i) => [i.label, { options: i.options, tipeInput: i.tipeInput ?? "opsi", fotoWajib: i.fotoWajibGudang !== false }]));
        }
      } catch { /* material tanpa template = pakai bawaan */ }
      setCfgByLabel(cfg);
      const sn: Record<number, string> = {};
      const keputusan: Record<number, Keputusan | ""> = {};
      const forms: Record<number, Record<string, GudangItemForm>> = {};
      for (const u of d.units) {
        sn[u.id] = u.sn ?? "";
        keputusan[u.id] = u.keputusan ?? "";
        const labels: string[] = [];
        for (const it of u.items) if (!labels.includes(it.itemLabel)) labels.push(it.itemLabel);
        forms[u.id] = Object.fromEntries(labels.map((l) => {
          const gudangItem = u.items.find((it) => it.stage === "gudang" && it.itemLabel === l);
          if (gudangItem) return [l, { hasil: gudangItem.hasil, catatan: gudangItem.catatan ?? "", foto: "" }];
          // Default: hasil + catatan salinan cek pengawas (tetap bisa diedit). Nilai hanya
          // disalin bila masih ada di opsi komponen (template berubah -> kosong).
          const pw = u.items.find((it) => it.stage === "pengawas" && it.itemLabel === l);
          const opts = cfg[l]?.options ?? DEFAULT_RESULT_OPTIONS;
          const teks = (cfg[l]?.tipeInput ?? "opsi") === "teks";
          // item input-form: salin nilai bebas pengawas (kecuali placeholder lama "ISI DI KOLOM CATATAN")
          const salinTeks = teks && pw && pw.hasil && !/^isi di kolom catatan$/i.test(pw.hasil);
          return [l, { hasil: salinTeks ? pw.hasil : pw && !teks && opts.includes(pw.hasil) ? pw.hasil : "", catatan: pw?.catatan ?? "", foto: "" }];
        }));
      }
      setDetail(d);
      setSnByUnit(sn);
      setItemForms(forms);
      setKeputusanByUnit(keputusan);
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
          [target.label]: { ...prev[target.unitId][target.label], foto: dataUrl },
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
    const snKosong = detail.units.filter((u) => !(snByUnit[u.id] ?? "").trim()).map((u) => u.label);
    if (snKosong.length > 0) {
      toast({ title: "SN MIMS wajib diisi tiap unit", description: `Unit: ${snKosong.join(", ")}`, variant: "destructive" });
      return;
    }
    const keputusanKosong = detail.units.filter((u) => !keputusanByUnit[u.id]).map((u) => u.label);
    if (keputusanKosong.length > 0) {
      toast({ title: "Keputusan unit wajib dipilih", description: `Pilih "Layak Pakai (Standby)" atau "Tidak Layak Pakai (Usul Hapus)" untuk unit: ${keputusanKosong.join(", ")}`, variant: "destructive" });
      return;
    }
    const tanpaFoto: string[] = [];
    for (const u of detail.units) {
      for (const [label, f] of Object.entries(itemForms[u.id] ?? {})) {
        if (f.hasil && !f.foto && cfgFor(label).fotoWajib) tanpaFoto.push(`${u.label} — ${label}`);
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
          units: detail.units.map((u) => ({
            unitId: u.id,
            sn: (snByUnit[u.id] ?? "").trim(),
            keputusan: keputusanByUnit[u.id],
            items: Object.entries(itemForms[u.id] ?? {})
              .filter(([, f]) => f.hasil)
              .map(([label, f]) => ({ label, hasil: f.hasil, catatan: f.catatan, foto: f.foto })),
          })),
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
            <h3 className="text-lg font-bold">Retur #{detail.id} — {detail.materialName}</h3>
            <Badge variant="secondary" className="capitalize">{detail.status === "checked_supervisor" ? "Menunggu verifikasi" : detail.status}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowTug10((v) => !v)}>
            {showTug10 ? "Sembunyikan" : "Tampilkan"} foto TUG10
          </Button>
        </div>

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
          return (
            <Card key={u.id}>
              <CardHeader className="py-3 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">{u.label}{u.sn ? ` — SN ${u.sn}` : ""}</CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">SN MIMS (wajib)</Label>
                  <Input className="h-8 w-52 text-sm font-mono" placeholder="TUG10/..."
                    value={snByUnit[u.id] ?? ""}
                    onChange={(e) => setSnByUnit((prev) => ({ ...prev, [u.id]: e.target.value }))} />
                </div>
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
                {labels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Unit ini tanpa item pemeriksaan.</p>
                ) : (
                  <>
                  <p className="text-xs text-muted-foreground mb-2">Komponen bertanda <span className="text-red-600 font-bold">*</span> wajib difoto (verifikasi ditolak bila hasil diisi tanpa foto). Hasil &amp; catatan gudang terisi otomatis mengikuti cek pengawas — ubah seperlunya bila hasil gudang berbeda.</p>
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
                        return (
                          <TableRow key={label}>
                            <TableCell className="text-sm max-w-[220px]">
                              {label}
                              {cfgFor(label).fotoWajib && (
                                <span className="text-red-600 font-bold ml-1" title="Foto komponen ini wajib">*</span>
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
                              {cfgFor(label).tipeInput === "teks" ? (
                                <Input className="h-8 w-28 text-xs" placeholder="Ketik hasil..." value={f.hasil}
                                  onChange={(e) => setItem(u.id, label, { hasil: e.target.value })} />
                              ) : (
                                <Select value={f.hasil || "skip"} onValueChange={(v) => setItem(u.id, label, { hasil: v === "skip" ? "" : v })}>
                                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Lewati" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="skip">Kosong (lewati)</SelectItem>
                                    {optionsFor(label).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
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
                                <Button size="sm" variant={f.hasil && !f.foto && cfgFor(label).fotoWajib ? "destructive" : "outline"}
                                  onClick={() => { photoTarget.current = { unitId: u.id, label }; itemFileRef.current?.click(); }}>
                                  <Camera className="h-3.5 w-3.5 mr-1" /> {f.foto ? "Ganti" : "Foto"}
                                </Button>
                                {f.foto && <img src={f.foto} alt={`Foto gudang: ${label}`} className="h-10 w-10 rounded border object-cover" />}
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

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => { setDetail(null); setShowTug10(false); }}>Batal</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Kirim Verifikasi Gudang
          </Button>
        </div>

        <input ref={itemFileRef} type="file" accept="image/*" capture="environment" className="hidden"
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
          <p className="text-sm text-muted-foreground">Tidak ada dokumen retur yang menunggu verifikasi.</p>
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
                  <TableCell>{d.materialName}</TableCell>
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
