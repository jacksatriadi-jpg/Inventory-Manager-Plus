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
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CloudUpload, Copy, Link2, Link2Off, Loader2, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MaterialPicker } from "./material-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_RESULT_OPTIONS, ReturTemplateItem, isNonScanMaterial, returApi } from "./shared";

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

// Baris editor: label + opsi hasil kustom (null = bawaan) + flag wajib foto per tahap.
interface TemplateRowUi {
  label: string;
  options: string[] | null;
  fwP: boolean;
  fwG: boolean;
}
const mapTemplateRows = (items: ReturTemplateItem[]): TemplateRowUi[] =>
  items.map((i) => ({ label: i.label, options: i.options, fwP: i.fotoWajibPengawas !== false, fwG: i.fotoWajibGudang !== false }));

function TemplateEditor() {
  const { toast } = useToast();
  const { data: materials } = useListMaterials();
  const [materialId, setMaterialId] = useState("");
  const [rows, setRows] = useState<TemplateRowUi[]>([]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  // true bila daftar yg tampil masih preset otomatis server (belum tersimpan di DB).
  const [isPreset, setIsPreset] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyQ, setCopyQ] = useState("");
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!materialId) { setRows([]); setIsPreset(false); setOpenRow(null); return; }
    let alive = true;
    setLoading(true);
    returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`)
      .then((d) => {
        if (!alive) return;
        const items = d.items ?? [];
        setRows(mapTemplateRows(items));
        setIsPreset(items.length > 0 && items.every((i) => i.id === null));
        setOpenRow(null);
      })
      .catch((e) => { if (alive) toast({ title: "Gagal memuat template", description: (e as Error).message, variant: "destructive" }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [materialId, toast]);

  const patchRow = (i: number, p: Partial<TemplateRowUi>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const removeRow = (i: number) => { setRows((rs) => rs.filter((_, j) => j !== i)); setOpenRow(null); };
  const addRow = () => setRows((rs) => [...rs, { label: "", options: null, fwP: true, fwG: true }]);
  const move = (i: number, dir: -1 | 1) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const copy = [...rs];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  const setOpt = (i: number, k: number, v: string) => setRows((rs) => rs.map((r, j) => (j !== i || !r.options) ? r : { ...r, options: r.options.map((o, m) => (m === k ? v : o)) }));
  const removeOpt = (i: number, k: number) => setRows((rs) => rs.map((r, j) => (j !== i || !r.options) ? r : { ...r, options: r.options.filter((_, m) => m !== k) }));
  const addOpt = (i: number) => setRows((rs) => rs.map((r, j) => (j !== i || !r.options) ? r : { ...r, options: [...r.options, ""] }));
  const moveOpt = (i: number, k: number, dir: -1 | 1) => setRows((rs) => rs.map((r, j) => {
    if (j !== i || !r.options) return r;
    const m = k + dir;
    if (m < 0 || m >= r.options.length) return r;
    const copy = [...r.options];
    [copy[k], copy[m]] = [copy[m], copy[k]];
    return { ...r, options: copy };
  }));

  const buildItems = () => rows
    .map((r) => ({ ...r, label: r.label.trim(), options: r.options ? r.options.map((o) => o.trim()).filter((o) => o.length > 0) : null }))
    .filter((r) => r.label.length > 0)
    .map((r) => ({ label: r.label, options: r.options, fotoWajibPengawas: r.fwP, fotoWajibGudang: r.fwG }));

  const save = async () => {
    if (!materialId) { toast({ title: "Pilih material terlebih dahulu", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const d = await returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`, {
        method: "PUT",
        body: JSON.stringify({ items: buildItems() }),
      });
      setRows(mapTemplateRows(d.items ?? []));
      setIsPreset(false);
      setOpenRow(null);
      toast({
        title: "Template tersimpan",
        description: (d.items ?? []).length === 0
          ? "Template dikosongkan — pemeriksaan material ini kembali memakai preset otomatis."
          : `${(d.items ?? []).length} komponen untuk material ini.`,
      });
    } catch (e) {
      toast({ title: "Gagal menyimpan template", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Duplikasi = PUT template yg sama ke tiap target; bukan operasi batch server (jumlah target kecil).
  const copyTo = async () => {
    const items = buildItems();
    if (items.length === 0) { toast({ title: "Daftar komponen kosong — tidak ada yang diduplikatkan", variant: "destructive" }); return; }
    const targets = (materials ?? []).filter((m) => copyTargets.has(String(m.id)));
    setCopying(true);
    let ok = 0;
    const gagal: string[] = [];
    for (const t of targets) {
      try {
        await returApi(`/template/${t.id}`, { method: "PUT", body: JSON.stringify({ items }) });
        ok += 1;
      } catch {
        gagal.push(t.name);
      }
    }
    setCopying(false);
    if (ok > 0) {
      toast({
        title: `Template diduplikatkan ke ${ok} material`,
        description: `${items.length} komponen per material${gagal.length ? `; gagal: ${gagal.join(", ")}` : ""}`,
        variant: gagal.length ? "destructive" : "default",
      });
      setCopyOpen(false);
      setCopyTargets(new Set());
      setCopyQ("");
    } else {
      toast({ title: "Semua duplikasi gagal", description: gagal.join(", "), variant: "destructive" });
    }
  };

  return (
    <>
      <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" /> Template Komponen Pemeriksaan</CardTitle>
        <CardDescription>Edit label, opsi hasil, dan aturan wajib foto per komponen. Simpan daftar kosong untuk kembali ke preset otomatis.</CardDescription>
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
          <Label>Daftar komponen ({rows.length})</Label>
          {loading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Memuat template...</p>}
          {!materialId && !loading && <p className="text-xs text-muted-foreground">Pilih material untuk memuat daftar komponennya.</p>}
          {materialId && !loading && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">Daftar kosong — pemeriksaan memakai preset otomatis. Tambah komponen untuk menentukan daftar sendiri.</p>
          )}
          {rows.map((row, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
                <Input
                  value={row.label}
                  onChange={(e) => patchRow(i, { label: e.target.value })}
                  placeholder={`Komponen ${i + 1}`}
                  className="text-sm"
                />
                <label className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground" title="Foto wajib saat pengawas mengisi hasil komponen ini">
                  <Checkbox className="h-4 w-4" checked={row.fwP} onCheckedChange={(v) => patchRow(i, { fwP: v === true })} />
                  Foto&nbsp;PW
                </label>
                <label className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground" title="Foto wajib saat gudang memverifikasi komponen ini">
                  <Checkbox className="h-4 w-4" checked={row.fwG} onCheckedChange={(v) => patchRow(i, { fwG: v === true })} />
                  Foto&nbsp;GD
                </label>
                <Button variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => setOpenRow(openRow === i ? null : i)}>
                  {openRow === i ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
                  Opsi{row.options ? ` (${row.options.length})` : ""}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Naikkan komponen">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Turunkan komponen">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => removeRow(i)} aria-label="Hapus komponen">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {openRow === i && (
                <div className="ml-8 space-y-2 rounded-md border border-dashed p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Opsi hasil komponen ini</span>
                    {!row.options && <Badge variant="secondary">Bawaan</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pilihan status komponen ini saat Buat/Verifikasi. Bawaan: {DEFAULT_RESULT_OPTIONS.join(" / ")}. Maks 30 opsi; kosongkan semua opsi untuk kembali ke bawaan.
                  </p>
                  {row.options === null ? (
                    <Button variant="outline" size="sm" onClick={() => patchRow(i, { options: [...DEFAULT_RESULT_OPTIONS] })}>
                      <Plus className="h-4 w-4 mr-1" /> Buat opsi kustom
                    </Button>
                  ) : (
                    <>
                      {row.options.map((opt, k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{k + 1}.</span>
                          <Input
                            value={opt}
                            onChange={(e) => setOpt(i, k, e.target.value)}
                            placeholder={`Opsi ${k + 1}`}
                            className="max-w-xs text-sm"
                          />
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => moveOpt(i, k, -1)} disabled={k === 0} aria-label="Naikkan opsi">
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => moveOpt(i, k, 1)} disabled={k === row.options!.length - 1} aria-label="Turunkan opsi">
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => removeOpt(i, k)} aria-label="Hapus opsi">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        {row.options.length < 30 && (
                          <Button variant="outline" size="sm" onClick={() => addOpt(i)}>
                            <Plus className="h-4 w-4 mr-1" /> Tambah opsi
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => patchRow(i, { options: null })}>Kembalikan ke bawaan</Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {materialId && !loading && (
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Tambah komponen
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={save} disabled={!materialId || loading || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Simpan Template
          </Button>
          <Button variant="outline" onClick={() => setCopyOpen(true)} disabled={!materialId || loading || rows.length === 0}>
            <Copy className="h-4 w-4 mr-2" /> Duplikatkan ke Material Lain
          </Button>
        </div>
      </CardContent>
    </Card>

    <Dialog open={copyOpen} onOpenChange={(o) => { setCopyOpen(o); if (!o) { setCopyTargets(new Set()); setCopyQ(""); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Duplikatkan template ke material lain</DialogTitle>
          <DialogDescription className="text-xs">
            {rows.length} komponen beserta opsi hasil &amp; aturan wajib foto akan MENGGANTI template material yang dipilih.
            Material yang sudah punya template akan tertimpa.
          </DialogDescription>
        </DialogHeader>
        <Input value={copyQ} onChange={(e) => setCopyQ(e.target.value)} placeholder="Cari nama / kode material..." className="h-8 text-sm" />
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {(materials ?? [])
            .filter(isNonScanMaterial)
            .filter((m) => String(m.id) !== materialId)
            .filter((m) => {
              const q = copyQ.trim().toLowerCase();
              return !q || `${m.id} ${m.code ?? ""} ${m.name}`.toLowerCase().includes(q);
            })
            .map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={copyTargets.has(String(m.id))}
                  onCheckedChange={(c) => setCopyTargets((prev) => {
                    const n = new Set(prev);
                    if (c === true) n.add(String(m.id)); else n.delete(String(m.id));
                    return n;
                  })}
                />
                <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
                <span className="truncate">{m.name}</span>
              </label>
            ))}
        </div>
        <DialogFooter className="items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground">{copyTargets.size} material dipilih</span>
          <Button variant="outline" size="sm" onClick={() => setCopyOpen(false)}>Batal</Button>
          <Button size="sm" onClick={copyTo} disabled={copying || copyTargets.size === 0}>
            {copying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />} Duplikatkan ({copyTargets.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
