import { useState, useEffect, useRef } from "react";
import * as xlsx from "xlsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Database, Package2, Users2, Plus, Pencil, Trash2, Loader2, DatabaseBackup, Download, Upload, ShieldAlert, CheckCircle2, Clock, Calendar, HardDrive, PlayCircle, RefreshCw, Link2, Link2Off, CloudUpload, FileSpreadsheet } from "lucide-react";
import { useListMaterials, useCreateMaterial, useUpdateMaterial, useDeleteMaterial, 
         useListUsers, useCreateUser, useUpdateUser, useDeleteUser, getListMaterialsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";

export default function Master() {
  const defaultTab = new URLSearchParams(window.location.search).get("tab") ?? "materials";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <Database className="w-8 h-8 text-primary" />
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Master Data</h2>
          <p className="text-muted-foreground mt-1">Manage core system entities.</p>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="h-12 w-full max-w-2xl grid grid-cols-4">
          <TabsTrigger value="materials" className="text-base">
            <Package2 className="w-4 h-4 mr-2" /> Materials
          </TabsTrigger>
          <TabsTrigger value="users" className="text-base">
            <Users2 className="w-4 h-4 mr-2" /> Users
          </TabsTrigger>
          <TabsTrigger value="backup" className="text-base">
            <DatabaseBackup className="w-4 h-4 mr-2" /> Backup
          </TabsTrigger>
          <TabsTrigger value="spreadsheet" className="text-base">
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Spreadsheet
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="materials" className="mt-6">
          <MaterialsTab />
        </TabsContent>
        
        <TabsContent value="users" className="mt-6">
          <UsersTab />
        </TabsContent>

        <TabsContent value="backup" className="mt-6">
          <BackupTab />
        </TabsContent>

        <TabsContent value="spreadsheet" className="mt-6">
          <SpreadsheetTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MaterialsTab() {
  const { data: materials, isLoading } = useListMaterials();
  const createMutation = useCreateMaterial();
  const updateMutation = useUpdateMaterial();
  const deleteMutation = useDeleteMaterial();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: "", code: "", description: "", kategori: "scan" as "scan" | "non-scan" });

  const handleOpen = (material?: any) => {
    if (material) {
      setEditingId(material.id);
      setFormData({ name: material.name, code: material.code, description: material.description || "", kategori: material.kategori ?? "scan" });
    } else {
      setEditingId(null);
      setFormData({ name: "", code: "", description: "", kategori: "scan" });
    }
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: formData });
        toast({ title: "Material updated" });
      } else {
        await createMutation.mutateAsync({ data: formData });
        toast({ title: "Material created" });
      }
      queryClient.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
      setIsOpen(false);
    } catch (error) {
      toast({ title: "Operation failed", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Delete this material?")) {
      try {
        await deleteMutation.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
        toast({ title: "Material deleted" });
      } catch (error) {
        toast({ title: "Delete failed", variant: "destructive" });
      }
    }
  };

  return (
    <Card className="border-sidebar-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-4 bg-muted/20">
        <div>
          <CardTitle>Material Catalog</CardTitle>
          <CardDescription>Manage materials that can be scanned.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <ImportMaterialDialog
            existingNames={(materials ?? []).map(m => m.name)}
            onImported={() => queryClient.invalidateQueries({ queryKey: getListMaterialsQueryKey() })}
          />
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpen()} className="uppercase tracking-wide font-bold">
              <Plus className="w-4 h-4 mr-2" /> Add Material
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Material" : "Tambah Material"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nama Material</Label>
                  <Input 
                    value={formData.code} 
                    onChange={e => setFormData({...formData, code: e.target.value.toUpperCase()})} 
                    placeholder="contoh: MCB 4A"
                    className="font-mono uppercase"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Normalisasi</Label>
                  <Input 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                    placeholder="contoh: 3250032"
                    required
                    className="bg-[transparent]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Deskripsi (Opsional)</Label>
                  <Input 
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Kategori Material</Label>
                  <Select value={formData.kategori} onValueChange={(v: "scan" | "non-scan") => setFormData({...formData, kategori: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scan">Scan (Serial Number / Barcode)</SelectItem>
                      <SelectItem value="non-scan">Non-Scan (Manual / Satuan)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {formData.kategori === "scan" 
                      ? "Muncul di menu Scan Material untuk scan barcode/QR" 
                      : "Muncul di menu Material Masuk/Keluar untuk input manual"}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? "Save Changes" : "Buat Material"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials?.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono font-bold">{m.code}</TableCell>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${(m as any).kategori === 'non-scan' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {(m as any).kategori ?? 'scan'}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.description || '-'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => handleOpen(m)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(m.id)}><Trash2 className="w-4 h-4" /></Button>
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

// ─── Import Material Dialog ────────────────────────────────────────────────

interface ImportRow {
  rowNum: number;
  name: string;
  code: string;
  codeAutoGen: boolean;
  description: string;
  kategori: "scan" | "non-scan";
  status: "new" | "exists";
}

function ImportMaterialDialog({
  existingNames,
  onImported,
}: {
  existingNames: string[];
  onImported: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<"upload" | "preview" | "importing" | "done">("upload");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState({ added: 0, skipped: 0, failed: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMutation = useCreateMaterial();
  const { toast } = useToast();

  const parseFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = xlsx.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      // skip first row (header)
      const parsed: ImportRow[] = rawData
        .slice(1)
        .map((row, idx) => {
          const name        = String(row[0] ?? "").trim();
          const rawCode     = String(row[1] ?? "").trim();
          const description = String(row[2] ?? "").trim();
          const rawKategori = String(row[3] ?? "").trim().toLowerCase();

          const code        = rawCode || name.substring(0, 30).toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9\-]/g, "") || `AUTO-${idx + 2}`;
          const codeAutoGen = !rawCode && name !== "";
          const kategori: "scan" | "non-scan" = rawKategori.includes("non") ? "non-scan" : "scan";
          const alreadyExists = existingNames.some(n => n.toLowerCase() === name.toLowerCase());
          const status: ImportRow["status"] = alreadyExists ? "exists" : "new";

          return { rowNum: idx + 2, name, code, codeAutoGen, description, kategori, status };
        })
        .filter(r => r.name !== "");

      if (parsed.length === 0) {
        toast({ title: "File kosong atau tidak ada data valid", variant: "destructive" });
        return;
      }
      setRows(parsed);
      setStage("preview");
    } catch {
      toast({ title: "Gagal membaca file Excel", variant: "destructive" });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  const handleImport = async () => {
    const toAdd = rows.filter(r => r.status === "new");
    let added = 0, failed = 0;
    setProgress(0);
    setStage("importing");

    for (let i = 0; i < toAdd.length; i++) {
      const row = toAdd[i];
      setProgress(Math.round(((i + 1) / toAdd.length) * 100));
      try {
        await createMutation.mutateAsync({
          data: { name: row.name, code: row.code, description: row.description || undefined, kategori: row.kategori },
        });
        added++;
      } catch {
        failed++;
      }
    }

    setResult({ added, skipped: rows.filter(r => r.status === "exists").length, failed });
    setStage("done");
    if (added > 0) onImported();
  };

  const reset = () => { setStage("upload"); setRows([]); setProgress(0); setResult({ added: 0, skipped: 0, failed: 0 }); };

  const newCount    = rows.filter(r => r.status === "new").length;
  const existsCount = rows.filter(r => r.status === "exists").length;

  return (
    <Dialog open={isOpen} onOpenChange={o => { setIsOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="font-semibold">
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Import Excel
        </Button>
      </DialogTrigger>
      <DialogContent className={stage === "preview" ? "max-w-5xl" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Import Data Material dari Excel
          </DialogTitle>
        </DialogHeader>

        {/* ── Stage 1: Upload ─────────────────────────────────────── */}
        {stage === "upload" && (
          <div className="py-2 space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
              <p className="font-semibold text-foreground">Format kolom Excel yang diharapkan:</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {([["A", "Name"], ["B", "Code"], ["C", "Description"], ["D", "Kategori"]] as const).map(([col, field]) => (
                  <div key={col} className="bg-background border rounded px-2 py-2">
                    <div className="font-bold text-primary text-base">{col}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{field}</div>
                  </div>
                ))}
              </div>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Baris pertama dianggap <strong>header</strong> dan akan dilewati.</li>
                <li>Material dengan <strong>Nama (A) yang sama</strong> di database akan dilewati otomatis.</li>
                <li>Kolom B kosong → kode digenerate otomatis dari nama.</li>
                <li>Kolom kosong lainnya dibiarkan kosong.</li>
                <li>Kolom D: isi "non-scan" untuk material manual, lainnya default "scan".</li>
              </ul>
            </div>

            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors select-none ${
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="font-semibold text-base">Klik atau drag & drop file Excel di sini</p>
              <p className="text-xs text-muted-foreground mt-1">Mendukung .xlsx dan .xls</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ""; }}
              />
            </div>
          </div>
        )}

        {/* ── Stage 2: Preview ────────────────────────────────────── */}
        {stage === "preview" && (
          <div className="py-2 space-y-4">
            <div className="flex gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold dark:bg-emerald-900/30 dark:text-emerald-400">
                <Plus className="w-3.5 h-3.5" /> {newCount} akan ditambah
              </span>
              {existsCount > 0 && (
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-semibold dark:bg-amber-900/30 dark:text-amber-400">
                  {existsCount} sudah ada — dilewati
                </span>
              )}
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-10">#</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Name (A)</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Code (B)</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Description (C)</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Kategori (D)</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr
                      key={r.rowNum}
                      className={`border-t transition-colors ${r.status === "exists" ? "opacity-40 bg-muted/20" : "hover:bg-muted/10"}`}
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.rowNum}</td>
                      <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={r.name}>{r.name}</td>
                      <td className="px-3 py-2 font-mono text-xs max-w-[130px] truncate" title={r.code}>
                        {r.code}
                        {r.codeAutoGen && (
                          <span className="ml-1 text-amber-500 text-[10px]" title="Digenerate otomatis dari nama">★</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={r.description}>
                        {r.description || <span className="italic text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          r.kategori === "non-scan"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                        }`}>
                          {r.kategori}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {r.status === "new"    && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Baru</span>}
                        {r.status === "exists" && <span className="px-2 py-0.5 rounded text-xs font-semibold bg-muted text-muted-foreground">Sudah Ada</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.some(r => r.codeAutoGen) && (
              <p className="text-xs text-muted-foreground">
                ★ Kode digenerate otomatis dari nama karena kolom B kosong.
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={reset}>← Ganti File</Button>
              <Button
                onClick={handleImport}
                disabled={newCount === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import {newCount} Material
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Stage 3: Importing ──────────────────────────────────── */}
        {stage === "importing" && (
          <div className="py-14 flex flex-col items-center gap-5">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="font-semibold text-lg">Mengimpor material...</p>
            <div className="w-full bg-muted rounded-full h-2.5">
              <div
                className="bg-primary h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{progress}% selesai</p>
          </div>
        )}

        {/* ── Stage 4: Done ───────────────────────────────────────── */}
        {stage === "done" && (
          <div className="py-10 flex flex-col items-center gap-5 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500" />
            <h3 className="text-xl font-bold">Import Selesai!</h3>
            <div className="flex gap-3 flex-wrap justify-center">
              <span className="px-4 py-2 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-semibold">
                ✓ {result.added} berhasil ditambah
              </span>
              {result.skipped > 0 && (
                <span className="px-4 py-2 rounded-lg bg-muted text-muted-foreground font-semibold">
                  {result.skipped} dilewati (sudah ada)
                </span>
              )}
              {result.failed > 0 && (
                <span className="px-4 py-2 rounded-lg bg-destructive/10 text-destructive font-semibold">
                  {result.failed} gagal
                </span>
              )}
            </div>
            <Button className="w-full mt-2" onClick={() => { setIsOpen(false); reset(); }}>
              Tutup
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


function UsersTab() {
  const { data: users, isLoading } = useListUsers();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ username: "", password: "", role: "user" as "master" | "user" });

  const handleOpen = (user?: any) => {
    if (user) {
      setEditingId(user.id);
      setFormData({ username: user.username, password: "", role: user.role });
    } else {
      setEditingId(null);
      setFormData({ username: "", password: "", role: "user" });
    }
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const payload: any = { username: formData.username, role: formData.role };
        if (formData.password) payload.password = formData.password;
        await updateMutation.mutateAsync({ id: editingId, data: payload });
        toast({ title: "User updated" });
      } else {
        if (!formData.password) {
          toast({ title: "Password required for new user", variant: "destructive" });
          return;
        }
        await createMutation.mutateAsync({ data: formData });
        toast({ title: "User created" });
      }
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      setIsOpen(false);
    } catch (error) {
      toast({ title: "Operation failed", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Delete this user?")) {
      try {
        await deleteMutation.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "User deleted" });
      } catch (error) {
        toast({ title: "Delete failed", variant: "destructive" });
      }
    }
  };

  return (
    <Card className="border-sidebar-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/50 pb-4 bg-muted/20">
        <div>
          <CardTitle>System Users</CardTitle>
          <CardDescription>Manage operator and master access.</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpen()} className="uppercase tracking-wide font-bold">
              <Plus className="w-4 h-4 mr-2" /> Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit User" : "New User"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input 
                    value={formData.username} 
                    onChange={e => setFormData({...formData, username: e.target.value})} 
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>{editingId ? "New Password (Optional)" : "Password"}</Label>
                  <Input 
                    type="password"
                    value={formData.password} 
                    onChange={e => setFormData({...formData, password: e.target.value})} 
                    required={!editingId}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={formData.role} onValueChange={(v: "master"|"user") => setFormData({...formData, role: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Operator (User)</SelectItem>
                      <SelectItem value="master">Admin (Master)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? "Save Changes" : "Create User"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium font-mono">{u.username}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${u.role === 'master' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {u.role}
                    </span>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => handleOpen(u)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDelete(u.id)}><Trash2 className="w-4 h-4" /></Button>
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


function BackupTab() {
  const { token } = useAuth();
  const { toast } = useToast();

  // Manual backup/restore
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [lastManualBackup, setLastManualBackup] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);

  // Auto backup schedule
  type AutoConfig = { enabled: boolean; interval: string; hour: number; minute: number; keep_count: number; gdrive_enabled: boolean };
  const [autoConfig, setAutoConfig] = useState<AutoConfig>({ enabled: false, interval: "daily", hour: 2, minute: 0, keep_count: 7, gdrive_enabled: false });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [backupFiles, setBackupFiles] = useState<Array<{ filename: string; size: number; createdAt: string }>>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Google Drive state
  const [gdriveConnected, setGdriveConnected] = useState(false);
  const [gdriveEmail, setGdriveEmail] = useState<string | null>(null);
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isDisconnectingDrive, setIsDisconnectingDrive] = useState(false);

  useEffect(() => {
    loadAutoConfig();
    loadBackupFiles();
    loadDriveStatus();

    // Detect post-OAuth redirect from Google
    const params = new URLSearchParams(window.location.search);
    if (params.get("gdrive") === "connected") {
      const email = params.get("email") ?? "";
      toast({ title: "Google Drive Terhubung! ✅", description: `Akun ${email} berhasil disambungkan.` });
      loadDriveStatus();
      loadAutoConfig();
      // Clean URL without reloading
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("gdrive") === "error") {
      const msg = params.get("msg") ?? "Terjadi kesalahan";
      toast({ title: "Gagal Terhubung ke Google Drive", description: msg, variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const loadAutoConfig = async () => {
    try {
      const res = await fetch("/api/auto-backup/config", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setAutoConfig({
          enabled: d.enabled,
          interval: d.interval,
          hour: d.hour,
          minute: d.minute,
          keep_count: d.keep_count,
          gdrive_enabled: d.gdrive_enabled ?? false,
        });
        setLastRunAt(d.last_run_at ?? null);
      }
    } catch {}
  };

  const loadBackupFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const res = await fetch("/api/auto-backup/list", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setBackupFiles(d.files ?? []);
      }
    } catch {} finally {
      setIsLoadingFiles(false);
    }
  };

  const loadDriveStatus = async () => {
    try {
      const res = await fetch("/api/auto-backup/google/status", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setGdriveConnected(d.connected);
        setGdriveEmail(d.email ?? null);
      }
    } catch {}
  };

  const handleConnectDrive = async () => {
    setIsConnectingDrive(true);
    try {
      const res = await fetch("/api/auto-backup/google/auth-url", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Gagal mendapatkan URL autentikasi Google.");
      const { url } = await res.json();
      // Open in the same tab so the redirect back works
      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
      setIsConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    if (!confirm(`Putuskan koneksi akun Google "${gdriveEmail}" dari Auto Backup?\n\nBackup lokal di server tetap tersimpan.`)) return;
    setIsDisconnectingDrive(true);
    try {
      const res = await fetch("/api/auto-backup/google/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal memutuskan koneksi");
      setGdriveConnected(false);
      setGdriveEmail(null);
      setAutoConfig(c => ({ ...c, gdrive_enabled: false }));
      toast({ title: "Google Drive diputuskan", description: "Backup otomatis ke Drive dinonaktifkan." });
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsDisconnectingDrive(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const res = await fetch("/api/auto-backup/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(autoConfig),
      });
      if (!res.ok) throw new Error("Gagal menyimpan");
      toast({ title: "Konfigurasi disimpan", description: "Jadwal auto backup telah diperbarui." });
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleRunNow = async () => {
    setIsRunningNow(true);
    try {
      const res = await fetch("/api/auto-backup/run-now", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Backup gagal");
      const d = await res.json();
      toast({ title: "Backup berhasil!", description: `Disimpan: ${d.filename}` });
      loadBackupFiles();
      loadAutoConfig();
    } catch (err: any) {
      toast({ title: "Backup gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsRunningNow(false);
    }
  };

  const handleDownloadServerFile = async (filename: string) => {
    try {
      const res = await fetch(`/api/auto-backup/download/${encodeURIComponent(filename)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal mengunduh");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Gagal mengunduh", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteServerFile = async (filename: string) => {
    if (!confirm(`Hapus file backup "${filename}"?`)) return;
    try {
      const res = await fetch(`/api/auto-backup/file/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal menghapus");
      toast({ title: "File backup dihapus" });
      loadBackupFiles();
    } catch (err: any) {
      toast({ title: "Gagal menghapus", description: err.message, variant: "destructive" });
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const res = await fetch("/api/backup", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Backup gagal"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_${format(new Date(), "yyyyMMdd_HHmmss")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setLastManualBackup(new Date().toISOString());
      toast({ title: "Backup berhasil", description: "File backup telah diunduh." });
    } catch (err: any) {
      toast({ title: "Backup gagal", description: err?.message, variant: "destructive" });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreFile) return;
    if (!confirm("⚠️ PERINGATAN: Restore akan menghapus SEMUA data yang ada dan menggantinya dengan data dari file backup.\n\nLanjutkan?")) return;
    setIsRestoring(true);
    setRestoreResult(null);
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(backup),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Restore gagal");
      setRestoreResult(result.restored);
      toast({ title: "Restore berhasil!", description: "Halaman akan dimuat ulang dalam 3 detik..." });
      setTimeout(() => window.location.reload(), 3000);
    } catch (err: any) {
      toast({ title: "Restore gagal", description: err?.message, variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const formatBytes = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Auto Backup Settings ───────────────────────────────────────────── */}
      <Card className="border-blue-500/30 shadow-sm">
        <CardHeader className="bg-blue-50/50 dark:bg-blue-950/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
            <Clock className="w-5 h-5" /> Auto Backup Terjadwal
          </CardTitle>
          <CardDescription>
            Backup otomatis berjalan di server sesuai jadwal. File disimpan lokal dan opsional ke Google Drive.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-5">

          {/* Enable schedule toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/20">
            <div>
              <p className="font-semibold text-sm">Aktifkan Auto Backup</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {autoConfig.enabled ? "Aktif — backup berjalan otomatis" : "Nonaktif — tidak ada backup otomatis"}
              </p>
            </div>
            <button
              id="auto-backup-toggle"
              onClick={() => setAutoConfig(c => ({ ...c, enabled: !c.enabled }))}
              className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none ${autoConfig.enabled ? "bg-blue-600" : "bg-muted-foreground/30"}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoConfig.enabled ? "translate-x-6" : "translate-x-0"}`} />
            </button>
          </div>

          {/* Interval & time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Interval</label>
              <select
                value={autoConfig.interval}
                onChange={e => setAutoConfig(c => ({ ...c, interval: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="daily">Setiap Hari</option>
                <option value="weekly">Setiap Minggu</option>
                <option value="monthly">Setiap Bulan</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Jam Eksekusi</label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number" min={0} max={23}
                  value={autoConfig.hour}
                  onChange={e => setAutoConfig(c => ({ ...c, hour: Number(e.target.value) }))}
                  className="w-20 text-center font-mono"
                />
                <span className="text-muted-foreground font-bold">:</span>
                <Input
                  type="number" min={0} max={59}
                  value={String(autoConfig.minute).padStart(2, "0")}
                  onChange={e => setAutoConfig(c => ({ ...c, minute: Number(e.target.value) }))}
                  className="w-20 text-center font-mono"
                />
              </div>
            </div>
          </div>

          {/* Keep count */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> Simpan {autoConfig.keep_count} file backup terbaru</label>
            <input
              type="range" min={1} max={30} value={autoConfig.keep_count}
              onChange={e => setAutoConfig(c => ({ ...c, keep_count: Number(e.target.value) }))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-muted-foreground"><span>1</span><span>30</span></div>
          </div>

          {/* ── Google Drive Section ─────────────────────────────────────── */}
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[#4285F4]/10 via-[#34A853]/10 to-[#EA4335]/10 border-b border-border">
              {/* Google Drive coloured icon */}
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                <path d="M43.65 25L29.9 0c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.5z" fill="#ea4335"/>
                <path d="M43.65 25L57.4 0H29.9z" fill="#00832d"/>
                <path d="M59.8 53H87.3c0-1.55-.4-3.1-1.2-4.5L72.55 25H43.65z" fill="#2684fc"/>
                <path d="M27.5 53l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h51.5c1.6 0 3.15-.4 4.5-1.2L60.5 53H27.5z" fill="#ffba00"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Google Drive</p>
                <p className="text-xs text-muted-foreground">Upload otomatis backup ke Google Drive Anda</p>
              </div>
              {/* Connected badge */}
              {gdriveConnected && (
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Terhubung
                </span>
              )}
            </div>

            <div className="px-4 py-4 space-y-3 bg-background">
              {!gdriveConnected ? (
                /* Not connected state */
                <div className="flex flex-col items-center gap-3 py-2">
                  <p className="text-sm text-muted-foreground text-center">
                    Hubungkan akun Google untuk mengaktifkan backup otomatis ke Google Drive.
                  </p>
                  <Button
                    id="connect-google-drive-btn"
                    onClick={handleConnectDrive}
                    disabled={isConnectingDrive}
                    variant="outline"
                    className="gap-2 border-[#4285F4]/50 hover:bg-[#4285F4]/5 hover:border-[#4285F4] text-foreground font-medium"
                  >
                    {isConnectingDrive ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Link2 className="w-4 h-4 text-[#4285F4]" />
                    )}
                    Hubungkan Akun Google
                  </Button>
                </div>
              ) : (
                /* Connected state */
                <div className="space-y-3">
                  {/* Account chip */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4285F4] to-[#34A853] flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {gdriveEmail?.[0]?.toUpperCase() ?? "G"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{gdriveEmail}</p>
                        <p className="text-xs text-muted-foreground">Google Account</p>
                      </div>
                    </div>
                    <Button
                      id="disconnect-google-drive-btn"
                      variant="ghost"
                      size="sm"
                      onClick={handleDisconnectDrive}
                      disabled={isDisconnectingDrive}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 ml-2"
                    >
                      {isDisconnectingDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2Off className="w-4 h-4" />}
                      <span className="ml-1 hidden sm:inline">Putuskan</span>
                    </Button>
                  </div>

                  {/* Upload to Drive toggle */}
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 bg-muted/10">
                    <div className="flex items-center gap-2">
                      <CloudUpload className="w-4 h-4 text-[#4285F4]" />
                      <div>
                        <p className="text-sm font-medium">Upload ke Google Drive</p>
                        <p className="text-xs text-muted-foreground">
                          {autoConfig.gdrive_enabled
                            ? "Setiap backup diunggah ke folder \"Inventory Backups\" di Drive"
                            : "Upload ke Drive dinonaktifkan"}
                        </p>
                      </div>
                    </div>
                    <button
                      id="gdrive-upload-toggle"
                      onClick={() => setAutoConfig(c => ({ ...c, gdrive_enabled: !c.gdrive_enabled }))}
                      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none shrink-0 ${autoConfig.gdrive_enabled ? "bg-[#4285F4]" : "bg-muted-foreground/30"}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoConfig.gdrive_enabled ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>

                  {autoConfig.gdrive_enabled && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 bg-blue-50/50 dark:bg-blue-950/20 rounded-md px-3 py-2 border border-blue-100 dark:border-blue-900">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      File backup disimpan lokal di server <strong>dan</strong> diunggah ke Google Drive Anda secara otomatis.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* ── End Google Drive Section ─────────────────────────────────── */}

          {/* Last run status */}
          {lastRunAt && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 bg-muted/30 rounded p-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              Backup terakhir: {format(new Date(lastRunAt), "dd MMM yyyy, HH:mm:ss")}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button id="save-backup-schedule-btn" onClick={handleSaveConfig} disabled={isSavingConfig} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wide">
              {isSavingConfig ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Menyimpan...</> : "Simpan Jadwal"}
            </Button>
            <Button id="run-backup-now-btn" onClick={handleRunNow} disabled={isRunningNow} variant="outline" className="gap-2">
              {isRunningNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              Jalankan Sekarang
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Server Backup Files ────────────────────────────────────────────── */}
      <Card className="border-violet-500/30 shadow-sm">
        <CardHeader className="bg-violet-50/50 dark:bg-violet-950/20 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-violet-700 dark:text-violet-400">
                <HardDrive className="w-5 h-5" /> Riwayat Backup Server
              </CardTitle>
              <CardDescription>File backup yang tersimpan di server ({backupFiles.length} file).</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={loadBackupFiles} title="Refresh">
              <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingFiles ? (
            <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : backupFiles.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <HardDrive className="w-10 h-10 mx-auto mb-2 opacity-20" />
              Belum ada file backup di server.<br />Klik "Jalankan Sekarang" untuk membuat backup pertama.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {backupFiles.map((f) => (
                <div key={f.filename} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono font-medium truncate">{f.filename}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(f.createdAt), "dd MMM yyyy, HH:mm")} · {formatBytes(f.size)}
                    </p>
                  </div>
                  <div className="flex gap-1 ml-3 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleDownloadServerFile(f.filename)} title="Unduh">
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleDeleteServerFile(f.filename)} title="Hapus">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Manual Export ─────────────────────────────────────────────────── */}
      <Card className="border-emerald-500/30 shadow-sm">
        <CardHeader className="bg-emerald-50/50 dark:bg-emerald-950/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <Download className="w-5 h-5" /> Export Manual
          </CardTitle>
          <CardDescription>Download snapshot semua data sebagai file JSON ke perangkat Anda.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {lastManualBackup && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Backup terakhir: {format(new Date(lastManualBackup), "dd MMM yyyy, HH:mm:ss")}
            </p>
          )}
          <Button id="manual-download-backup-btn" onClick={handleBackup} disabled={isBackingUp} className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-wide">
            {isBackingUp ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Membuat Backup...</> : <><Download className="w-5 h-5 mr-2" />Download Backup</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Restore ───────────────────────────────────────────────────────── */}
      <Card className="border-amber-500/30 shadow-sm">
        <CardHeader className="bg-amber-50/50 dark:bg-amber-950/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <Upload className="w-5 h-5" /> Import / Restore
          </CardTitle>
          <CardDescription>Pulihkan database dari file backup yang sebelumnya diekspor.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-400">
            <p className="font-semibold flex items-center gap-1"><ShieldAlert className="w-4 h-4" /> Peringatan</p>
            <p className="mt-1 text-xs">Restore akan menghapus semua data saat ini dan menggantinya dengan isi backup. Tindakan ini tidak dapat dibatalkan.</p>
          </div>
          <div
            className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
            onClick={() => document.getElementById("master-restore-file-input")?.click()}
          >
            <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground opacity-50" />
            {restoreFile ? (
              <div><p className="font-medium text-foreground">{restoreFile.name}</p><p className="text-xs text-muted-foreground mt-1">{(restoreFile.size / 1024).toFixed(1)} KB</p></div>
            ) : (
              <div><p className="text-muted-foreground text-sm">Klik untuk memilih file backup</p><p className="text-xs text-muted-foreground mt-1">hanya file .json</p></div>
            )}
            <input id="master-restore-file-input" type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setRestoreFile(f); setRestoreResult(null); } }} />
          </div>
          {restoreResult && (
            <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-4 text-sm space-y-2">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Restore Berhasil</p>
              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                <span>Users:</span><span className="font-mono font-bold text-foreground">{restoreResult.users}</span>
                <span>Material:</span><span className="font-mono font-bold text-foreground">{restoreResult.materials}</span>
                <span>Sesi scan-in:</span><span className="font-mono font-bold text-foreground">{restoreResult.scanIns}</span>
                <span>Item scan:</span><span className="font-mono font-bold text-foreground">{restoreResult.scanItems}</span>
                <span>Sesi scan-out:</span><span className="font-mono font-bold text-foreground">{restoreResult.scanOuts}</span>
                <span>Material masuk:</span><span className="font-mono font-bold text-foreground">{restoreResult.nonScanMasuk}</span>
                <span>Material keluar:</span><span className="font-mono font-bold text-foreground">{restoreResult.nonScanKeluar}</span>
              </div>
            </div>
          )}
          <Button id="restore-from-backup-btn" onClick={handleRestore} disabled={!restoreFile || isRestoring} className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold uppercase tracking-wide">
            {isRestoring ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Memulihkan...</> : <><Upload className="w-5 h-5 mr-2" />Restore dari Backup</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Spreadsheet Tab ─────────────────────────────────────────────────────────

function SpreadsheetTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedSheetName, setSavedSheetName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ count: number; sample: string[] } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sheets/config", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.spreadsheet_id) {
          setSavedId(d.spreadsheet_id);
          setSpreadsheetId(d.spreadsheet_id);
        }
        if (d?.sheet_name) {
          setSavedSheetName(d.sheet_name);
          setSheetName(d.sheet_name);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    const raw = spreadsheetId.trim();
    if (!raw) {
      toast({ title: "ID Spreadsheet tidak boleh kosong", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/sheets/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ spreadsheet_id: raw, sheet_name: sheetName.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Gagal menyimpan");
      setSavedId(d.spreadsheet_id);
      setSpreadsheetId(d.spreadsheet_id);
      setSavedSheetName(d.sheet_name ?? null);
      setTestResult(null);
      setTestError(null);
      const sheetInfo = d.sheet_name ? ` · Tab: "${d.sheet_name}"` : " · Tab: (default/pertama)";
      toast({ title: "Konfigurasi Spreadsheet disimpan ✅", description: `ID: ${d.spreadsheet_id}${sheetInfo}` });
    } catch (err: any) {
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch("/api/sheets/stock", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Gagal membaca spreadsheet");
      const sample = d.stock.slice(0, 5).map((r: any) => `${r.materialName} → ${r.stockExcel}`);
      setTestResult({ count: d.stock.length, sample });
      toast({ title: "Koneksi berhasil! ✅", description: `${d.stock.length} material ditemukan di spreadsheet.` });
    } catch (err: any) {
      setTestError(err.message);
      toast({ title: "Gagal membaca spreadsheet", description: err.message, variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Main config card */}
      <Card className="border-green-500/30 shadow-sm">
        <CardHeader className="bg-green-50/50 dark:bg-green-950/20 border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
            {/* Google Sheets icon */}
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path d="M29 1H9C6.79 1 5 2.79 5 5v38c0 2.21 1.79 4 4 4h30c2.21 0 4-1.79 4-4V15L29 1z" fill="#23A566"/>
              <path d="M29 1l14 14H29V1z" fill="#159F54"/>
              <rect x="14" y="21" width="20" height="2" rx="1" fill="white" fillOpacity="0.9"/>
              <rect x="14" y="26" width="20" height="2" rx="1" fill="white" fillOpacity="0.9"/>
              <rect x="14" y="31" width="14" height="2" rx="1" fill="white" fillOpacity="0.9"/>
            </svg>
            Connect Google Spreadsheet
          </CardTitle>
          <CardDescription>
            Hubungkan Google Spreadsheet untuk menampilkan kolom "Stock Excel" di Dashboard.
            Data diambil dari kolom C (nama material, mulai baris 9) dan kolom J (nilai stok).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">

          {/* ID input */}
          <div className="space-y-2">
            <Label htmlFor="spreadsheet-id-input" className="font-semibold">Google Spreadsheet ID atau URL</Label>
            <Input
              id="spreadsheet-id-input"
              value={spreadsheetId}
              onChange={e => setSpreadsheetId(e.target.value)}
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Bisa paste URL lengkap seperti{" "}
              <code className="bg-muted px-1 rounded text-[11px]">
                https://docs.google.com/spreadsheets/d/<strong>1BxiMV...</strong>/edit
              </code>
              , sistem akan otomatis mengekstrak ID-nya.
            </p>
          </div>

          {/* Sheet/Tab Name input */}
          <div className="space-y-2">
            <Label htmlFor="sheet-name-input" className="font-semibold">
              Nama Tab / Sheet
              <span className="ml-2 text-xs font-normal text-muted-foreground">(opsional)</span>
            </Label>
            <Input
              id="sheet-name-input"
              value={sheetName}
              onChange={e => setSheetName(e.target.value)}
              placeholder="Sheet1"
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Nama tab sheet tempat data berada (lihat nama tab di bagian bawah file Google Sheets).
              Kosongkan jika data ada di tab <strong>pertama</strong> (default).
            </p>
          </div>

          {/* Saved badge */}
          {savedId && (
            <div className="flex flex-col gap-1 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>ID: <code className="font-mono text-xs">{savedId}</code></span>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <span className="text-xs text-muted-foreground">
                  Tab: <strong>{savedSheetName ? `"${savedSheetName}"` : "(default/tab pertama)"}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Requirement notice */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm text-amber-700 dark:text-amber-400 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Syarat agar bisa membaca spreadsheet:
            </p>
            <ol className="list-decimal list-inside space-y-0.5 text-xs">
              <li>Akun Google sudah terkoneksi di tab <strong>Backup → Google Drive</strong></li>
              <li>Spreadsheet harus di-<strong>share</strong> ke akun Google tersebut (minimal Viewer), atau diset <strong>Anyone with the link can view</strong></li>
            </ol>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              id="save-spreadsheet-btn"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold uppercase tracking-wide"
            >
              {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Menyimpan...</> : "Simpan ID"}
            </Button>
            <Button
              id="test-spreadsheet-btn"
              onClick={handleTest}
              disabled={isTesting || !savedId}
              variant="outline"
              className="gap-2"
            >
              {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Test Koneksi
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 p-4 text-sm space-y-2">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                Berhasil! {testResult.count} material ditemukan di spreadsheet.
              </p>
              {testResult.sample.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Contoh data (5 pertama):</p>
                  {testResult.sample.map((s, i) => (
                    <p key={i} className="font-mono text-xs bg-muted/50 rounded px-2 py-0.5">{s}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {testError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
              <p className="font-semibold flex items-center gap-1"><ShieldAlert className="w-4 h-4" /> Gagal membaca spreadsheet</p>
              <p className="text-xs mt-1">{testError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How-to card */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="border-b border-border/40">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Format Spreadsheet yang Diharapkan
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-muted-foreground space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="py-2 px-3 text-left text-muted-foreground">Baris</th>
                  <th className="py-2 px-3 text-center font-bold text-green-700">Kolom C</th>
                  <th className="py-2 px-3 text-center text-muted-foreground">D–I</th>
                  <th className="py-2 px-3 text-center font-bold text-blue-700">Kolom J</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-muted/20">
                  <td className="py-1.5 px-3 text-muted-foreground">1–8</td>
                  <td className="py-1.5 px-3 text-center" colSpan={3}>Header / informasi lainnya (diabaikan)</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3 text-muted-foreground">9</td>
                  <td className="py-1.5 px-3 text-center text-green-700">MCB 4A</td>
                  <td className="py-1.5 px-3 text-center text-muted-foreground">...</td>
                  <td className="py-1.5 px-3 text-center text-blue-700">150</td>
                </tr>
                <tr className="bg-muted/10">
                  <td className="py-1.5 px-3 text-muted-foreground">10</td>
                  <td className="py-1.5 px-3 text-center text-green-700">KABEL NYM 3x1.5</td>
                  <td className="py-1.5 px-3 text-center text-muted-foreground">...</td>
                  <td className="py-1.5 px-3 text-center text-blue-700">230</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3 text-muted-foreground">dst...</td>
                  <td className="py-1.5 px-3 text-center text-green-700">...</td>
                  <td className="py-1.5 px-3 text-center text-muted-foreground">...</td>
                  <td className="py-1.5 px-3 text-center text-blue-700">...</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs">
            Nilai di kolom C dicocokkan dengan <strong>kode material</strong> di Dashboard (case-insensitive).
            Nilai dari kolom J ditampilkan di kolom <strong>"Stock Excel"</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
