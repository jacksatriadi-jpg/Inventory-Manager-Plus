// Tab BUAT: pengawas membuat dokumen retur — foto TUG10 (mandatori, kompresi 1280/0.72),
// material (daftar penuh, terserah assignment master), units repeater, ceklist per unit dari template.
import { useEffect, useRef, useState } from "react";
import { useListMaterials } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, FileText, ImageOff, ImagePlus, Loader2, PackageX, Paperclip, Plus, Trash2, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_RESULT_OPTIONS, FormDefinition, ReturTemplateItem, readFileCompressed, returApi } from "./shared";
import { MaterialPicker } from "./material-picker";

interface ItemForm {
  label: string;
  hasil: string; // "" = dilewati; selain itu = salah satu nilai dari resultOptions
  catatan: string;
  foto: string;
}

interface UnitForm {
  label: string;
  items: ItemForm[];
  formData: Record<string, string>; // isian "A. DATA MATERIAL" utk Cetak Formulir (key = field definition)
}

const makeUnit = (n: number, labels: string[]): UnitForm => ({
  label: `Unit ${n}`,
  items: labels.map((label) => ({ label, hasil: "", catatan: "", foto: "" })),
  formData: {},
});

export function BuatTab() {
  const { toast } = useToast();
  const { data: materials } = useListMaterials();
  const { user } = useAuth();

  const [tug10, setTug10] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [cfgByLabel, setCfgByLabel] = useState<Record<string, { options: string[] | null; tipeInput: "opsi" | "teks"; fotoWajib: boolean }>>({});
  const [units, setUnits] = useState<UnitForm[]>([]);
  const [formDef, setFormDef] = useState<FormDefinition | null>(null);
  const [samplingMode, setSamplingMode] = useState(false);
  const [jumlahUnit, setJumlahUnit] = useState("");
  const [lampiranFiles, setLampiranFiles] = useState<{ name: string; dataUrl: string }[]>([]);
  const lampiranInputRef = useRef<HTMLInputElement>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const tug10InputRef = useRef<HTMLInputElement>(null);
  const itemFileRef = useRef<HTMLInputElement>(null);
  const itemGalleryRef = useRef<HTMLInputElement>(null); // ambil foto dari galeri device (tanpa capture)
  const tug10GalleryRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<{ unit: number; item: number } | null>(null);

  useEffect(() => {
    if (!materialId) { setLabels([]); setUnits([]); setCfgByLabel({}); return; }
    let alive = true;
    setTemplateLoading(true);
    returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`)
      .then((d) => {
        if (!alive) return;
        const ls = (d.items ?? []).map((i) => i.label);
        setLabels(ls);
        setCfgByLabel(Object.fromEntries((d.items ?? []).map((i) => [i.label, { options: i.options, tipeInput: i.tipeInput ?? "opsi", fotoWajib: i.fotoWajibPengawas !== false }])));
        // Unit lama tetap ada; item lama dipertahankan utk label yang sama.
        setUnits((prev) => prev.length === 0
          ? [makeUnit(1, ls)]
          : prev.map((u, ui) => ({
              ...u,
              label: `Unit ${ui + 1}`,
              items: ls.map((l) => u.items.find((x) => x.label === l) ?? { label: l, hasil: "", catatan: "", foto: "" }),
              formData: u.formData ?? {},
            })));
      })
      .catch((e) => { if (alive) toast({ title: "Gagal memuat template", description: (e as Error).message, variant: "destructive" }); })
      .finally(() => { if (alive) setTemplateLoading(false); });
    return () => { alive = false; };
  }, [materialId, toast]);

  // Template formulir inspeksi (Cetak Formulir) — null bila material belum di-assign master.
  useEffect(() => {
    if (!materialId) { setFormDef(null); setSamplingMode(false); setJumlahUnit(""); setLampiranFiles([]); return; }
    let alive = true;
    returApi<{ formKey: string | null; definition: FormDefinition | null; samplingEnabled?: boolean }>(`/form-def/${materialId}`)
      .then((d) => {
        if (!alive) return;
        setFormDef(d.formKey ? d.definition : null);
        setSamplingMode(d.samplingEnabled === true);
        setJumlahUnit(""); setLampiranFiles([]);
      })
      .catch(() => { if (alive) { setFormDef(null); setSamplingMode(false); } });
    return () => { alive = false; };
  }, [materialId]);

  // Komponen tanpa entri config (mis. preset) = opsi bawaan + foto wajib.
  const cfgFor = (label: string) => cfgByLabel[label] ?? { options: null as string[] | null, tipeInput: "opsi" as const, fotoWajib: true };
  const optionsFor = (label: string) => cfgFor(label).options ?? DEFAULT_RESULT_OPTIONS;

  const pickLampiran = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      const okType = f.type === "application/pdf" || f.type.startsWith("image/");
      if (!okType) { toast({ title: `Lampiran "${f.name}": hanya gambar atau PDF`, variant: "destructive" }); continue; }
      if (f.size > 8 * 1024 * 1024) { toast({ title: `Lampiran "${f.name}": maksimal 8 MB`, variant: "destructive" }); continue; }
      if (lampiranFiles.length >= 10) { toast({ title: "Maksimal 10 dokumen lampiran", variant: "destructive" }); return; }
      const reader = new FileReader();
      reader.onload = () => setLampiranFiles((prev) => [...prev, { name: f.name, dataUrl: String(reader.result) }]);
      reader.readAsDataURL(f);
    }
  };

  const setFormValue = (unitIdx: number, key: string, value: string) => {
    setUnits((prev) => prev.map((u, ui) => ui !== unitIdx ? u : { ...u, formData: { ...u.formData, [key]: value } }));
  };

  const setItem = (unitIdx: number, itemIdx: number, patch: Partial<ItemForm>) => {
    setUnits((prev) => prev.map((u, ui) => ui !== unitIdx ? u
      : { ...u, items: u.items.map((it, ii) => ii !== itemIdx ? it : { ...it, ...patch }) }));
  };

  const handleTug10File = async (file?: File | null) => {
    if (!file) return;
    try { setTug10(await readFileCompressed(file)); }
    catch { toast({ title: "Gagal memproses foto TUG10", variant: "destructive" }); }
  };

  const handleItemFile = async (file?: File | null) => {
    const target = photoTarget.current;
    photoTarget.current = null;
    if (!file || !target) return;
    try {
      const dataUrl = await readFileCompressed(file);
      setItem(target.unit, target.item, { foto: dataUrl });
    } catch { toast({ title: "Gagal memproses foto", variant: "destructive" }); }
  };

  const addUnit = () => setUnits((prev) => [...prev, makeUnit(prev.length + 1, labels)]);

  const removeUnit = (idx: number) => {
    setUnits((prev) => prev.filter((_, i) => i !== idx).map((u, i) => ({ ...u, label: `Unit ${i + 1}` })));
  };

  const save = async () => {
    if (!tug10) { toast({ title: "Foto TUG10 wajib diunggah", variant: "destructive" }); return; }
    if (!materialId) { toast({ title: "Pilih material terlebih dahulu", variant: "destructive" }); return; }
    if (units.length === 0) { toast({ title: "Tambahkan minimal satu unit", variant: "destructive" }); return; }
    const tanpaFoto: string[] = [];
    units.forEach((u, ui) => u.items.forEach((it) => {
      if (it.hasil && !it.foto && cfgFor(it.label).fotoWajib) tanpaFoto.push(`Unit ${ui + 1} — ${it.label}`);
    }));
    if (tanpaFoto.length > 0) {
      toast({ title: "Item wajib foto belum difoto", description: tanpaFoto.join("; "), variant: "destructive" });
      return;
    }
    if (samplingMode && jumlahUnit.trim() !== "" && (!/^\d+$/.test(jumlahUnit.trim()) || Number(jumlahUnit) < 1)) {
      toast({ title: "Jumlah unit tidak valid", description: "Isi bilangan bulat >= 1.", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await returApi("", {
        method: "POST",
        body: JSON.stringify({
          materialId: Number(materialId),
          tug10Photo: tug10,
          catatan: catatan.trim(),
          ...(samplingMode && /^\d+$/.test(jumlahUnit.trim()) ? { jumlahUnit: Number(jumlahUnit.trim()) } : {}),
          ...(samplingMode && lampiranFiles.length > 0 ? { lampiran: lampiranFiles } : {}),
          units: units.map((u) => ({
            label: u.label,
            items: u.items
              .filter((it) => it.hasil)
              .map((it) => ({ label: it.label, hasil: it.hasil, catatan: it.catatan, foto: it.foto })),
            ...(formDef ? { formData: Object.fromEntries(Object.entries(u.formData ?? {}).filter(([, v]) => v.trim())) } : {}),
          })),
        }),
      });
      toast({ title: "Dokumen retur tersimpan", description: "Status: sudah dicek pengawas, menunggu verifikasi gudang. Formulir bisa dicetak dari tab Riwayat — pilih dokumen, klik Cetak Formulir." });
      setTug10(""); setMaterialId(""); setCatatan(""); setLabels([]); setUnits([]);
      setJumlahUnit(""); setLampiranFiles([]); setSamplingMode(false);
    } catch (e) {
      toast({ title: "Gagal menyimpan dokumen", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const greetingCompany = (user as { companyName?: string | null } | null)?.companyName ?? null;

  return (
    <div className="space-y-6">
      {greetingCompany && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-center gap-3">
          <Building2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Selamat datang, {user?.username} 👋</p>
            <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">{greetingCompany}</p>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Foto Surat TUG10 (wajib)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input ref={tug10InputRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { handleTug10File(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <input ref={tug10GalleryRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { handleTug10File(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => tug10InputRef.current?.click()}>
                <Camera className="h-4 w-4 mr-2" /> {tug10 ? "Ganti foto TUG10" : "Ambil foto TUG10"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => tug10GalleryRef.current?.click()}>
                <ImagePlus className="h-4 w-4 mr-2" /> Galeri
              </Button>
              {tug10 && (
                <Button variant="ghost" size="sm" onClick={() => setTug10("")}>
                  <Trash2 className="h-4 w-4 mr-1" /> Hapus
                </Button>
              )}
            </div>
            {tug10
              ? <img src={tug10} alt="Foto TUG10" className="max-h-64 w-full object-contain rounded border bg-muted/40" />
              : (
                <div className="h-28 rounded border border-dashed border-muted-foreground/40 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                  <ImageOff className="h-5 w-5" />
                  <span className="text-xs">Belum ada foto TUG10</span>
                </div>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><PackageX className="h-4 w-4" /> Material &amp; Catatan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Material <span className="text-red-600">*</span></Label>
              <MaterialPicker materials={materials} value={materialId} onChange={setMaterialId} invalid={!materialId} />
              {!materialId && <p className="text-xs text-destructive">Wajib dipilih sebelum dokumen dapat disimpan.</p>}
              {templateLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Memuat template pemeriksaan...</p>}
            </div>
            <div className="space-y-2">
              <Label>Catatan dokumen (opsional)</Label>
              <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan dari pengawas..." rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>

      {samplingMode && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Mode Sampling — 1 unit contoh untuk semua unit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Jumlah unit seluruhnya</Label>
                <Input type="number" min={1} className="h-9 w-40" value={jumlahUnit} onChange={(e) => setJumlahUnit(e.target.value)} placeholder="mis. 25" />
              </div>
              <p className="text-xs text-muted-foreground max-w-md">Cukup periksa <b>satu unit contoh</b> di bawah — unit contoh ini mewakili seluruh unit lainnya sejumlah di atas.</p>
            </div>
            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={() => lampiranInputRef.current?.click()}>
                <Paperclip className="h-4 w-4 mr-2" /> Unggah Dokumen Lampiran
              </Button>
              <input ref={lampiranInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { pickLampiran(e.target.files); e.target.value = ""; }} />
              {lampiranFiles.length > 0 && (
                <div className="space-y-1 max-w-md">
                  {lampiranFiles.map((f, fi) => (
                    <div key={fi} className="flex items-center justify-between gap-2 text-sm border rounded-md px-2 py-1">
                      <span className="truncate">{f.name}</span>
                      <Button variant="ghost" size="sm" onClick={() => setLampiranFiles((prev) => prev.filter((_, i) => i !== fi))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Lampiran = dokumen pendukung (foto/PDF; maks 8 MB per file, maks 10 file) — tersimpan di folder Google Drive dokumen ini.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {units.map((unit, ui) => (
        <Card key={ui}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
            <CardTitle className="text-base">{unit.label}</CardTitle>
            {units.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => removeUnit(ui)}>
                <Trash2 className="h-4 w-4 mr-1" /> Hapus unit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {formDef && (
              <div className="mb-4 rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
                <div>
                  <p className="text-sm font-medium">Data Material — {formDef.formCode}</p>
                  <p className="text-xs text-muted-foreground">Isian ini tercetak pada bagian &quot;A. DATA MATERIAL&quot; formulir inspeksi. Boleh dikosongkan bila belum diketahui.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[...(formDef.fields?.left ?? []), ...(formDef.fields?.right ?? [])].map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label}{f.hint ? <span className="text-muted-foreground font-normal"> — {f.hint}</span> : ""}</Label>
                      <Input className="h-8 text-xs" placeholder={f.hint ?? f.label}
                        value={unit.formData?.[f.key] ?? ""}
                        onChange={(e) => setFormValue(ui, f.key, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {unit.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {materialId ? "Template material ini kosong — atur daftar komponen di tab Pengaturan (master)." : "Pilih material untuk memuat daftar pemeriksaan."}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Komponen bertanda <span className="text-red-600 font-bold">*</span> wajib difoto (dokumen ditolak bila hasil diisi tanpa foto).</p>
                {unit.items.map((it, ii) => (
                  <div key={ii} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto] gap-2 items-center border-b border-border/50 pb-2 last:border-0">
                    <span className="text-sm">
                      {it.label}
                      {cfgFor(it.label).fotoWajib && (
                        <span className="text-red-600 font-bold ml-1" title="Foto komponen ini wajib">*</span>
                      )}
                    </span>
                    {cfgFor(it.label).tipeInput === "teks" ? (
                      <Input className="h-8 text-xs" placeholder="Ketik hasil..." value={it.hasil}
                        onChange={(e) => setItem(ui, ii, { hasil: e.target.value })} />
                    ) : (
                      <Select value={it.hasil || "skip"} onValueChange={(v) => setItem(ui, ii, { hasil: v === "skip" ? "" : v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lewati" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Kosong (lewati)</SelectItem>
                          {optionsFor(it.label).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    <Input className="h-8 text-xs" placeholder="Catatan (opsional)" value={it.catatan}
                      onChange={(e) => setItem(ui, ii, { catatan: e.target.value })} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={it.hasil && !it.foto && cfgFor(it.label).fotoWajib ? "destructive" : "outline"}
                        onClick={() => { photoTarget.current = { unit: ui, item: ii }; itemFileRef.current?.click(); }}>
                        <Camera className="h-3.5 w-3.5 mr-1" /> {it.foto ? "Ganti" : "Foto"}
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => { photoTarget.current = { unit: ui, item: ii }; itemGalleryRef.current?.click(); }}>
                        <ImagePlus className="h-3.5 w-3.5 mr-1" /> Galeri
                      </Button>
                      {it.foto && <img src={it.foto} alt={`Foto ${it.label}`} className="h-10 w-10 rounded border object-cover" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={addUnit} disabled={!materialId}>
          <Plus className="h-4 w-4 mr-2" /> {samplingMode ? "Tambah Unit Contoh" : "Tambah Unit"}
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Simpan Dokumen Retur
        </Button>
      </div>

      <input ref={itemFileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { handleItemFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <input ref={itemGalleryRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { handleItemFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}
