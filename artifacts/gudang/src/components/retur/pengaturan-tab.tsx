// Tab PENGATURAN (master): koneksi Google Drive RETUR (akun kedua, terpisah dari backup)
// dan editor template komponen per material.
import { useEffect, useState } from "react";
import { useListMaterials } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, CloudUpload, Link2, Link2Off, Loader2, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import { MaterialPicker } from "./material-picker";
import { ReturTemplateItem, isNonScanMaterial, returApi } from "./shared";

interface DriveStatus {
  connected: boolean;
  email: string | null;
}

export function PengaturanTab() {
  return (
    <div className="space-y-6">
      <DrivePanel />
      <TemplateEditor />
    </div>
  );
}

function DrivePanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = async () => {
    try {
      setStatus(await returApi<DriveStatus>("/google/status"));
    } catch (e) {
      toast({ title: "Gagal cek status Drive Retur", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const connect = async () => {
    try {
      const { url } = await returApi<{ url: string }>("/google/auth-url");
      window.location.href = url;
    } catch (e) {
      toast({ title: "Gagal mengambil URL autorisasi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await returApi("/google/disconnect", { method: "POST" });
      toast({ title: "Akun Drive Retur diputus" });
      load();
    } catch (e) {
      toast({ title: "Gagal memutus akun", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><CloudUpload className="h-4 w-4" /> Google Drive Retur (akun khusus)</CardTitle>
        <CardDescription>
          Foto TUG10 dan foto pemeriksaan retur disimpan di folder Drive "Retur Gudang Pemaron" — terpisah dari akun backup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Mengecek status...</p>
        ) : status?.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Terhubung</Badge>
            <span className="text-sm">{status.email ?? "(email tidak tersedia)"}</span>
            <Button variant="outline" size="sm" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link2Off className="h-4 w-4 mr-2" />} Putuskan
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="destructive">Belum terhubung</Badge>
            <span className="text-sm text-muted-foreground">Dokumen retur tidak bisa dibuat/diverifikasi sampai akun Drive Retur dihubungkan.</span>
            <Button size="sm" onClick={connect}>
              <Link2 className="h-4 w-4 mr-2" /> Hubungkan Akun Drive
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateEditor() {
  const { toast } = useToast();
  const { data: materials } = useListMaterials();
  const [materialId, setMaterialId] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  // true bila daftar yg tampil masih preset otomatis server (belum tersimpan di DB).
  const [isPreset, setIsPreset] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!materialId) { setLabels([]); setIsPreset(false); return; }
    let alive = true;
    setLoading(true);
    returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`)
      .then((d) => {
        if (!alive) return;
        const items = d.items ?? [];
        setLabels(items.map((i) => i.label));
        setIsPreset(items.length > 0 && items.every((i) => i.id === null));
      })
      .catch((e) => { if (alive) toast({ title: "Gagal memuat template", description: (e as Error).message, variant: "destructive" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [materialId, toast]);

  const setLabel = (i: number, v: string) => setLabels((ls) => ls.map((l, j) => (j === i ? v : l)));
  const removeRow = (i: number) => setLabels((ls) => ls.filter((_, j) => j !== i));
  const addRow = () => setLabels((ls) => [...ls, ""]);
  const move = (i: number, dir: -1 | 1) => setLabels((ls) => {
    const j = i + dir;
    if (j < 0 || j >= ls.length) return ls;
    const copy = [...ls];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  const save = async () => {
    if (!materialId) { toast({ title: "Pilih material terlebih dahulu", variant: "destructive" }); return; }
    const cleaned = labels.map((l) => l.trim()).filter((l) => l.length > 0);
    setSaving(true);
    try {
      const d = await returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`, {
        method: "PUT",
        body: JSON.stringify({ labels: cleaned }),
      });
      setLabels((d.items ?? []).map((i) => i.label));
      setIsPreset(false);
      toast({
        title: "Template tersimpan",
        description: cleaned.length === 0
          ? "Template dikosongkan — pemeriksaan material ini kembali memakai preset otomatis."
          : `${(d.items ?? []).length} komponen untuk material ini.`,
      });
    } catch (e) {
      toast({ title: "Gagal menyimpan template", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" /> Template Komponen Pemeriksaan</CardTitle>
        <CardDescription>Edit label per baris, tambah/hapus, dan atur urutan. Simpan daftar kosong untuk kembali ke preset otomatis.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Material (non-scan)</Label>
          <MaterialPicker materials={materials?.filter(isNonScanMaterial)} value={materialId} onChange={setMaterialId} />
        </div>

        {isPreset && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Preset otomatis</Badge>
            Daftar ini bawaan sistem dari nama material — simpan untuk menjadikannya template khusus material ini.
          </div>
        )}

        <div className="space-y-2">
          <Label>Daftar komponen ({labels.length})</Label>
          {loading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Memuat template...</p>}
          {!materialId && !loading && <p className="text-xs text-muted-foreground">Pilih material untuk memuat daftar komponennya.</p>}
          {materialId && !loading && labels.length === 0 && (
            <p className="text-xs text-muted-foreground">Daftar kosong — pemeriksaan memakai preset otomatis. Tambah komponen untuk menentukan daftar sendiri.</p>
          )}
          {labels.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
              <Input
                value={label}
                onChange={(e) => setLabel(i, e.target.value)}
                placeholder={`Komponen ${i + 1}`}
                className="text-sm"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Naikkan komponen">
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => move(i, 1)} disabled={i === labels.length - 1} aria-label="Turunkan komponen">
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => removeRow(i)} aria-label="Hapus komponen">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {materialId && !loading && (
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Tambah komponen
            </Button>
          )}
        </div>

        <Button onClick={save} disabled={!materialId || loading || saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Simpan Template
        </Button>
      </CardContent>
    </Card>
  );
}
