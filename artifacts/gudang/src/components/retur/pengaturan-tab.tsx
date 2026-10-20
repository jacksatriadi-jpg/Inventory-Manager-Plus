// Tab PENGATURAN (master): koneksi Google Drive RETUR (akun kedua, terpisah dari backup)
// dan editor template komponen per material.
import { useEffect, useState } from "react";
import { useListMaterials } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CloudUpload, Link2, Link2Off, Loader2, ListChecks, Save } from "lucide-react";
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
  const [labelsText, setLabelsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!materialId) { setLabelsText(""); return; }
    let alive = true;
    setLoading(true);
    returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`)
      .then((d) => { if (alive) setLabelsText((d.items ?? []).map((i) => i.label).join("\n")); })
      .catch((e) => { if (alive) toast({ title: "Gagal memuat template", description: (e as Error).message, variant: "destructive" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [materialId, toast]);

  const save = async () => {
    if (!materialId) { toast({ title: "Pilih material terlebih dahulu", variant: "destructive" }); return; }
    const labels = labelsText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    setSaving(true);
    try {
      const d = await returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`, {
        method: "PUT",
        body: JSON.stringify({ labels }),
      });
      setLabelsText((d.items ?? []).map((i) => i.label).join("\n"));
      toast({ title: "Template tersimpan", description: `${(d.items ?? []).length} komponen untuk material ini.` });
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
        <CardDescription>Satu label komponen per baris. Kosongkan untuk memakai preset otomatis (2-line / 4-line / umum).</CardDescription>
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
        </div>
        <div className="space-y-2">
          <Label>Daftar komponen</Label>
          <Textarea
            rows={14}
            className="font-mono text-xs"
            placeholder={"MCB utama (incoming)\nMCB line 1\nBusbar tembaga\n..."}
            value={labelsText}
            onChange={(e) => setLabelsText(e.target.value)}
            disabled={!materialId || loading}
          />
        </div>
        <Button onClick={save} disabled={!materialId || loading || saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Simpan Template
        </Button>
      </CardContent>
    </Card>
  );
}
