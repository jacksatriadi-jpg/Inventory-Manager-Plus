// Tab BUAT: pengawas membuat dokumen retur — foto TUG10 (mandatori, kompresi 1280/0.72),
// material non-scan, units repeater, checklist per unit dari template, foto wajib per item ber-hasil.
import { useEffect, useRef, useState } from "react";
import { useListMaterials } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, FileText, ImageOff, Loader2, PackageX, Plus, Trash2 } from "lucide-react";
import { Hasil, ReturTemplateItem, isNonScanMaterial, readFileCompressed, returApi } from "./shared";

interface ItemForm {
  label: string;
  hasil: "" | Hasil;
  catatan: string;
  foto: string;
}

interface UnitForm {
  label: string;
  items: ItemForm[];
}

const makeUnit = (n: number, labels: string[]): UnitForm => ({
  label: `Unit ${n}`,
  items: labels.map((label) => ({ label, hasil: "", catatan: "", foto: "" })),
});

export function BuatTab() {
  const { toast } = useToast();
  const { data: materials } = useListMaterials();

  const [tug10, setTug10] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [units, setUnits] = useState<UnitForm[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const tug10InputRef = useRef<HTMLInputElement>(null);
  const itemFileRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<{ unit: number; item: number } | null>(null);

  useEffect(() => {
    if (!materialId) { setLabels([]); setUnits([]); return; }
    let alive = true;
    setTemplateLoading(true);
    returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`)
      .then((d) => {
        if (!alive) return;
        const ls = (d.items ?? []).map((i) => i.label);
        setLabels(ls);
        // Unit lama tetap ada; item lama dipertahankan utk label yang sama.
        setUnits((prev) => prev.length === 0
          ? [makeUnit(1, ls)]
          : prev.map((u, ui) => ({
              ...u,
              label: `Unit ${ui + 1}`,
              items: ls.map((l) => u.items.find((x) => x.label === l) ?? { label: l, hasil: "", catatan: "", foto: "" }),
            })));
      })
      .catch((e) => { if (alive) toast({ title: "Gagal memuat template", description: (e as Error).message, variant: "destructive" }); })
      .finally(() => { if (alive) setTemplateLoading(false); });
    return () => { alive = false; };
  }, [materialId, toast]);

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
      if (it.hasil && !it.foto) tanpaFoto.push(`Unit ${ui + 1} — ${it.label}`);
    }));
    if (tanpaFoto.length > 0) {
      toast({ title: "Item dengan hasil wajib difoto", description: tanpaFoto.join("; "), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await returApi("", {
        method: "POST",
        body: JSON.stringify({
          materialId: Number(materialId),
          tug10Photo: tug10,
          catatan: catatan.trim(),
          units: units.map((u) => ({
            label: u.label,
            items: u.items
              .filter((it) => it.hasil)
              .map((it) => ({ label: it.label, hasil: it.hasil, catatan: it.catatan, foto: it.foto })),
          })),
        }),
      });
      toast({ title: "Dokumen retur tersimpan", description: "Status: sudah dicek pengawas, menunggu verifikasi gudang." });
      setTug10(""); setMaterialId(""); setCatatan(""); setLabels([]); setUnits([]);
    } catch (e) {
      toast({ title: "Gagal menyimpan dokumen", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Foto Surat TUG10 (wajib)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input ref={tug10InputRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { handleTug10File(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => tug10InputRef.current?.click()}>
                <Camera className="h-4 w-4 mr-2" /> {tug10 ? "Ganti foto TUG10" : "Ambil / pilih foto TUG10"}
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
              <Label>Material (non-scan)</Label>
              <Select value={materialId || undefined} onValueChange={setMaterialId}>
                <SelectTrigger><SelectValue placeholder="Pilih material" /></SelectTrigger>
                <SelectContent className="max-h-[50vh] overflow-y-auto">
                  {materials?.filter(isNonScanMaterial).map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      <span className="font-mono text-xs mr-2 text-muted-foreground">{m.code}</span>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {templateLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Memuat template pemeriksaan...</p>}
            </div>
            <div className="space-y-2">
              <Label>Catatan dokumen (opsional)</Label>
              <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan dari pengawas..." rows={3} />
            </div>
          </CardContent>
        </Card>
      </div>

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
            {unit.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {materialId ? "Template material ini kosong — atur daftar komponen di tab Pengaturan (master)." : "Pilih material untuk memuat daftar pemeriksaan."}
              </p>
            ) : (
              <div className="space-y-2">
                {unit.items.map((it, ii) => (
                  <div key={ii} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto] gap-2 items-center border-b border-border/50 pb-2 last:border-0">
                    <span className="text-sm">{it.label}</span>
                    <Select value={it.hasil || "skip"} onValueChange={(v) => setItem(ui, ii, { hasil: v === "skip" ? "" : (v as Hasil) })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lewati" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Kosong (lewati)</SelectItem>
                        <SelectItem value="ada">Lengkap</SelectItem>
                        <SelectItem value="hilang">Hilang</SelectItem>
                        <SelectItem value="rusak">Rusak</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input className="h-8 text-xs" placeholder="Catatan (opsional)" value={it.catatan}
                      onChange={(e) => setItem(ui, ii, { catatan: e.target.value })} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant={it.hasil && !it.foto ? "destructive" : "outline"}
                        onClick={() => { photoTarget.current = { unit: ui, item: ii }; itemFileRef.current?.click(); }}>
                        <Camera className="h-3.5 w-3.5 mr-1" /> {it.foto ? "Ganti" : "Foto"}
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
          <Plus className="h-4 w-4 mr-2" /> Tambah Unit
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Simpan Dokumen Retur
        </Button>
      </div>

      <input ref={itemFileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { handleItemFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}
