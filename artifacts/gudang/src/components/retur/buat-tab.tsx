// Tab BUAT: pengawas membuat dokumen retur — foto TUG10 (mandatori, kompresi 1280/0.72),
// MULTI-MATERIAL: satu dokumen berisi beberapa grup material; tiap grup punya repeater unit
// dan ceklist dari template material masing-masing (material tidak boleh dobel dalam 1 dokumen).
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, FileText, ImageOff, ImagePlus, Loader2, PackageX, Paperclip, Plus, Trash2, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_RESULT_OPTIONS, FormDefinition, ReturTemplateItem, fmtTanggal, readFileCompressed, returApi, useReturMaterials } from "./shared";
import { MaterialPicker } from "./material-picker";
import { clearReturDraft, deleteServerDraft, draftHasContent, fetchServerDraft, liteDraft, loadReturDraft, photoSignature, pushServerDraft, ReturDraft, saveReturDraft } from "./draft-store";

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

interface ItemCfg { options: string[] | null; tipeInput: "opsi" | "teks"; fotoWajib: boolean }

// Satu grup material dalam dokumen: material + unit + config template + state sampling.
interface MatGroup {
  key: number;
  materialId: string;
  labels: string[];
  cfgByLabel: Record<string, ItemCfg>;
  units: UnitForm[];
  formDef: FormDefinition | null;
  samplingMode: boolean;
  jumlahUnit: string;
  lampiranFiles: { name: string; dataUrl: string }[];
  templateLoading: boolean;
  templateError: string | null;
}

let groupKeySeq = 1;
const emptyGroup = (): MatGroup => ({
  key: groupKeySeq++,
  materialId: "",
  labels: [],
  cfgByLabel: {},
  units: [],
  formDef: null,
  samplingMode: false,
  jumlahUnit: "",
  lampiranFiles: [],
  templateLoading: false,
  templateError: null,
});

const makeUnit = (n: number, labels: string[]): UnitForm => ({
  label: `Unit ${n}`,
  items: labels.map((label) => ({ label, hasil: "", catatan: "", foto: "" })),
  formData: {},
});

export function BuatTab() {
  const { toast } = useToast();
  const { data: materials } = useReturMaterials();
  // Material tanpa template ceklist/formulir tidak bisa dipakai retur (guard juga di API).
  const [tplOkIds, setTplOkIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    returApi<{ status: { id: number; ok: boolean }[] }>("/template-status")
      .then((d) => setTplOkIds(new Set(d.status.filter((s) => s.ok).map((s) => String(s.id)))))
      .catch(() => { /* gagal load: biarkan API yang menegah saat simpan */ });
  }, []);
  const { user } = useAuth();

  const [tug10, setTug10] = useState("");
  const [catatan, setCatatan] = useState("");
  const [groups, setGroups] = useState<MatGroup[]>(() => [emptyGroup()]);
  const [saving, setSaving] = useState(false);

  const tug10InputRef = useRef<HTMLInputElement>(null);
  const itemFileRef = useRef<HTMLInputElement>(null);
  const itemGalleryRef = useRef<HTMLInputElement>(null); // ambil foto dari galeri device (tanpa capture)
  const tug10GalleryRef = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<{ group: number; unit: number; item: number } | null>(null);
  const lampiranRefs = useRef<Record<number, HTMLInputElement | null>>({});
  // Token per grup: respons template lama (grup ganti material cepat) tidak menimpa state baru.
  const loadToken = useRef<Record<number, number>>({});

  const updateGroup = (gi: number, patch: Partial<MatGroup>) =>
    setGroups((prev) => prev.map((g, i) => (i !== gi ? g : { ...g, ...patch })));

  const nameOf = (id: string | number) =>
    (materials ?? []).find((m) => String(m.id) === String(id))?.name ?? String(id);

  // Material MCB/MCCB tidak punya komponen pemeriksaan (form = Data Material + JUMLAH).
  const isMcbCode = (code?: string | null) => /^\s*(MCB|MCCB)\s+/i.test(code ?? "");

  // Muat template ceklist + definisi form untuk material milik grup gi (paralel, per grup).
  // keepSampling: saat memulihkan draft, jumlahUnit & lampiran tersimpan JANGAN direset
  // (berbeda dengan kasus ganti material manual yang memang mengosongkan state sampling).
  const loadMaterialIntoGroup = (gi: number, materialId: string, keepSampling = false) => {
    const token = (loadToken.current[gi] = (loadToken.current[gi] ?? 0) + 1);
    if (!materialId) {
      updateGroup(gi, { materialId: "", labels: [], units: [], cfgByLabel: {}, formDef: null, samplingMode: false, jumlahUnit: "", lampiranFiles: [], templateLoading: false, templateError: null });
      return;
    }
    updateGroup(gi, { materialId, templateLoading: true, templateError: null });
    Promise.all([
      returApi<{ items: ReturTemplateItem[] }>(`/template/${materialId}`),
      returApi<{ formKey: string | null; definition: FormDefinition | null; samplingEnabled?: boolean }>(`/form-def/${materialId}`)
        .catch(() => ({ formKey: null, definition: null, samplingEnabled: false })),
    ])
      .then(([t, fd]) => {
        if (loadToken.current[gi] !== token) return;
        const ls = (t.items ?? []).map((i) => i.label);
        setGroups((prev) => prev.map((g, i) => {
          if (i !== gi) return g;
          return {
            ...g,
            labels: ls,
            cfgByLabel: Object.fromEntries((t.items ?? []).map((it) => [it.label, { options: it.options, tipeInput: it.tipeInput ?? "opsi", fotoWajib: it.fotoWajibPengawas !== false }])),
            // Unit lama tetap ada; item lama dipertahankan utk label yang sama.
            units: g.units.length === 0
              ? [makeUnit(1, ls)]
              : g.units.map((u, ui) => ({
                  ...u,
                  label: `Unit ${ui + 1}`,
                  items: ls.map((l) => u.items.find((x) => x.label === l) ?? { label: l, hasil: "", catatan: "", foto: "" }),
                  formData: u.formData ?? {},
                })),
            formDef: fd.formKey ? fd.definition : null,
            samplingMode: fd.samplingEnabled === true,
            jumlahUnit: keepSampling ? g.jumlahUnit : "",
            lampiranFiles: keepSampling ? g.lampiranFiles : [],
            templateLoading: false,
            templateError: null,
          };
        }));
      })
      .catch((e) => {
        if (loadToken.current[gi] !== token) return;
        updateGroup(gi, { templateLoading: false, templateError: (e as Error).message });
        toast({ title: "Gagal memuat template", description: (e as Error).message, variant: "destructive" });
      });
  };

  // ---------- DRAFT: autosave ke IndexedDB + pemulihan saat mount ----------
  // Refresh halaman / pindah tab tidak lagi menghapus isian (permintaan Jack, Nov 2026).
  const draftKey = user?.username ?? null;
  const [draftInfo, setDraftInfo] = useState<{ savedAt: number; fromServer?: boolean } | null>(null);
  const draftReadyRef = useRef<string | null>(null); // username yang sudah dicoba dipulihkan
  const restoringRef = useRef(false); // autosave jangan menimpa draft sebelum restore selesai
  const lastPushSigRef = useRef<string | null>(null); // signature foto draft terakhir yang sukses dikirim ke server
  const draftPayloadRef = useRef<{ tug10: string; catatan: string; groups: ReturDraft["groups"] }>({ tug10: "", catatan: "", groups: [] });
  draftPayloadRef.current = {
    tug10,
    catatan,
    groups: groups.map((g) => ({ materialId: g.materialId, units: g.units, jumlahUnit: g.jumlahUnit, lampiranFiles: g.lampiranFiles })),
  };

  const buildDraftNow = (): ReturDraft => ({ savedAt: Date.now(), ...draftPayloadRef.current });

  const persistDraftNow = () => {
    if (!draftKey || restoringRef.current) return;
    const d = buildDraftNow();
    if (draftHasContent(d)) void saveReturDraft(draftKey, d);
    else void clearReturDraft(draftKey);
  };
  const persistRef = useRef(persistDraftNow);
  persistRef.current = persistDraftNow;

  // Sinkron ke server (debounce lebih panjang — payload bisa berisi foto).
  // Lite push dipakai selama susunan foto tidak berubah (hemat kuota HP).
  const pushDraftToServer = () => {
    if (!draftKey || restoringRef.current) return;
    const d = buildDraftNow();
    if (!draftHasContent(d)) return;
    const sig = photoSignature(d);
    const lite = lastPushSigRef.current !== null && sig === lastPushSigRef.current;
    void pushServerDraft(lite ? liteDraft(d) : d, lite).then((ok) => {
      if (ok) lastPushSigRef.current = sig;
    });
  };
  const pushRef = useRef(pushDraftToServer);
  pushRef.current = pushDraftToServer;

  // Pulihkan draft milik user ini — sekali per username, bukan per render.
  // Sumber: IndexedDB lokal DAN salinan server; yang lebih baru dipakai
  // (draft dari device lain ikut dipulihkan, lalu di-cache ke IndexedDB).
  useEffect(() => {
    if (!draftKey || draftReadyRef.current === draftKey) return;
    draftReadyRef.current = draftKey;
    restoringRef.current = true;
    let cancelled = false;
    void (async () => {
      const [local, remote] = await Promise.all([loadReturDraft(draftKey), fetchServerDraft()]);
      const localOk = local && draftHasContent(local) ? local : null;
      const remoteOk = remote && draftHasContent(remote) ? remote : null;
      let draft: ReturDraft | null = null;
      let fromServer = false;
      if (localOk && remoteOk) {
        fromServer = (remoteOk.savedAt ?? 0) > (localOk.savedAt ?? 0);
        draft = fromServer ? remoteOk : localOk;
      } else if (localOk) { draft = localOk; }
      else if (remoteOk) { draft = remoteOk; fromServer = true; }
      if (cancelled) { restoringRef.current = false; return; }
      // Hanya draft dari SERVER yang boleh dianggap "sudah terkirim" (push berikutnya boleh lite).
      // Draft dari IndexedDB lokal (mis. dibuat sebelum fitur sync / server dihapus) WAJIB push
      // penuh sekali — kalau tidak, foto tidak pernah naik karena server tidak punya apa2 utk di-merge.
      if (draft && fromServer) lastPushSigRef.current = photoSignature(draft);
      if (fromServer && draft) void saveReturDraft(draftKey, draft);
      restoringRef.current = false;
      if (cancelled || !draft) return;
      const restored: MatGroup[] = (draft.groups ?? []).filter((g) => g.materialId).map((g) => ({
        ...emptyGroup(),
        materialId: g.materialId,
        units: (g.units ?? []).map((u) => ({ label: u.label, items: u.items ?? [], formData: u.formData ?? {} })),
        jumlahUnit: g.jumlahUnit ?? "",
        lampiranFiles: g.lampiranFiles ?? [],
      }));
      // tug10/catatan tetap dipulihkan walau belum ada material yang dipilih.
      setTug10(draft.tug10 ?? "");
      setCatatan(draft.catatan ?? "");
      setGroups(restored.length > 0 ? restored : [emptyGroup()]);
      setDraftInfo({ savedAt: draft.savedAt ?? Date.now(), fromServer });
      // Template dimuat ulang per material; isian unit lama dipertahankan (merge by label).
      restored.forEach((g, gi) => loadMaterialIntoGroup(gi, g.materialId, true));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Autosave lokal dengan debounce 800 ms; form kosong = hapus draft.
  useEffect(() => {
    if (!draftKey || restoringRef.current) return;
    const t = setTimeout(persistDraftNow, 800);
    return () => clearTimeout(t);
  }, [tug10, catatan, groups, draftKey]);

  // Autosave server dengan debounce 4 s (ringan untuk kuota; foto hanya naik saat berubah).
  useEffect(() => {
    if (!draftKey || restoringRef.current) return;
    const t = setTimeout(() => pushRef.current(), 4000);
    return () => clearTimeout(t);
  }, [tug10, catatan, groups, draftKey]);

  // Flush saat halaman ditutup atau tab dipindah (penting di HP).
  useEffect(() => {
    const flush = () => persistRef.current();
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const discardDraft = () => {
    if (draftKey) void clearReturDraft(draftKey);
    lastPushSigRef.current = null;
    void deleteServerDraft();
    groups.forEach((_, gi) => { loadToken.current[gi] = (loadToken.current[gi] ?? 0) + 1; });
    setTug10(""); setCatatan(""); setGroups([emptyGroup()]); setDraftInfo(null);
  };

  const addGroup = () => {
    if (groups.length >= 10) { toast({ title: "Maksimal 10 material per dokumen", variant: "destructive" }); return; }
    setGroups((prev) => [...prev, emptyGroup()]);
  };

  const removeGroup = (gi: number) => {
    loadToken.current[gi] = (loadToken.current[gi] ?? 0) + 1; // batalkan fetch yang masih jalan
    setGroups((prev) => (prev.length <= 1 ? [emptyGroup()] : prev.filter((_, i) => i !== gi)));
  };

  const cfgFor = (g: MatGroup, label: string): ItemCfg =>
    g.cfgByLabel[label] ?? { options: null, tipeInput: "opsi", fotoWajib: true };
  const optionsFor = (g: MatGroup, label: string) => cfgFor(g, label).options ?? DEFAULT_RESULT_OPTIONS;

  const pickLampiran = (gi: number, files: FileList | null) => {
    if (!files) return;
    const g = groups[gi];
    // Counter sinkron: state lampiran belum ter-update di dalam loop (FileReader async),
    // jadi batas 10 harus dijaga lewat counter lokal, bukan closure state.
    let count = g.lampiranFiles.length;
    for (const f of Array.from(files)) {
      const okType = f.type === "application/pdf" || f.type.startsWith("image/");
      if (!okType) { toast({ title: `Lampiran "${f.name}": hanya gambar atau PDF`, variant: "destructive" }); continue; }
      if (f.size > 8 * 1024 * 1024) { toast({ title: `Lampiran "${f.name}": maksimal 8 MB`, variant: "destructive" }); continue; }
      if (count >= 10) { toast({ title: "Maksimal 10 dokumen lampiran", variant: "destructive" }); return; }
      count++;
      const reader = new FileReader();
      reader.onload = () => setGroups((prev) => prev.map((gg, i) => i !== gi ? gg : { ...gg, lampiranFiles: [...gg.lampiranFiles, { name: f.name, dataUrl: String(reader.result) }] }));
      reader.readAsDataURL(f);
    }
  };

  const setFormValue = (gi: number, unitIdx: number, key: string, value: string) => {
    setGroups((prev) => prev.map((g, i) => i !== gi ? g
      : { ...g, units: g.units.map((u, ui) => ui !== unitIdx ? u : { ...u, formData: { ...u.formData, [key]: value } }) }));
  };

  const setItem = (gi: number, unitIdx: number, itemIdx: number, patch: Partial<ItemForm>) => {
    setGroups((prev) => prev.map((g, i) => i !== gi ? g
      : { ...g, units: g.units.map((u, ui) => ui !== unitIdx ? u
        : { ...u, items: u.items.map((it, ii) => ii !== itemIdx ? it : { ...it, ...patch }) }) }));
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
      setItem(target.group, target.unit, target.item, { foto: dataUrl });
    } catch { toast({ title: "Gagal memproses foto", variant: "destructive" }); }
  };

  const addUnit = (gi: number) =>
    setGroups((prev) => prev.map((g, i) => i !== gi ? g : { ...g, units: [...g.units, makeUnit(g.units.length + 1, g.labels)] }));

  const removeUnit = (gi: number, idx: number) => {
    setGroups((prev) => prev.map((g, i) => i !== gi ? g
      : { ...g, units: g.units.filter((_, ui) => ui !== idx).map((u, ui) => ({ ...u, label: `Unit ${ui + 1}` })) }));
  };

  const save = async () => {
    if (!tug10) { toast({ title: "Foto TUG10 wajib diunggah", variant: "destructive" }); return; }
    if (!catatan.trim()) { toast({ title: "Nomor Pengembalian (TUG 10) wajib diisi", description: "Masukkan nomor TUG 10 pada kolom Nomor Pengembalian sebelum menyimpan.", variant: "destructive" }); return; }
    if (groups.some((g) => !g.materialId)) {
      toast({ title: "Pilih material untuk semua grup", description: "Grup tanpa material harus dipilih materialnya atau dihapus dulu.", variant: "destructive" }); return;
    }
    const dup = groups.map((g) => g.materialId).filter((v, i, a) => a.indexOf(v) !== i);
    if (dup.length > 0) { toast({ title: "Material ganda dalam satu dokumen", description: `Material "${nameOf(dup[0])}" dipilih lebih dari sekali.`, variant: "destructive" }); return; }
    const formKosong: string[] = [];
    groups.forEach((g) => {
      if (!g.formDef) return; // material tanpa template formulir: isian data material tidak berlaku
      const fl = [...(g.formDef.fields?.left ?? []), ...(g.formDef.fields?.right ?? [])];
      g.units.forEach((u, ui) => fl.forEach((f) => {
        if (!(u.formData?.[f.key] ?? "").trim()) formKosong.push(`${nameOf(g.materialId)} — Unit ${ui + 1} — ${f.label}`);
      }));
    });
    if (formKosong.length > 0) {
      toast({ title: "Data material wajib diisi", description: `Isian formulir belum lengkap: ${formKosong.slice(0, 6).join("; ")}${formKosong.length > 6 ? `; +${formKosong.length - 6} lainnya` : ""}`, variant: "destructive" });
      return;
    }
    const tanpaFoto: string[] = [];
    groups.forEach((g) => {
      g.units.forEach((u, ui) => u.items.forEach((it) => {
        if (it.hasil && !it.foto && cfgFor(g, it.label).fotoWajib) tanpaFoto.push(`${nameOf(g.materialId)} — Unit ${ui + 1} — ${it.label}`);
      }));
    });
    if (tanpaFoto.length > 0) {
      toast({ title: "Item wajib foto belum difoto", description: tanpaFoto.join("; "), variant: "destructive" });
      return;
    }
    for (const g of groups) {
      if (g.units.length === 0) { toast({ title: `Material "${nameOf(g.materialId)}" belum punya unit`, variant: "destructive" }); return; }
      if (g.samplingMode && (g.jumlahUnit.trim() === "" || !/^\d+$/.test(g.jumlahUnit.trim()) || Number(g.jumlahUnit) < 1)) {
        toast({ title: "Jumlah unit wajib diisi", description: `Mode sampling (${nameOf(g.materialId)}): isi jumlah unit bilangan bulat >= 1.`, variant: "destructive" }); return;
      }
    }
    const lampiranMerged = groups.flatMap((g) => g.lampiranFiles);
    setSaving(true);
    try {
      await returApi("", {
        method: "POST",
        body: JSON.stringify({
          tug10Photo: tug10,
          catatan: catatan.trim(),
          ...(lampiranMerged.length > 0 ? { lampiran: lampiranMerged } : {}),
          materials: groups.map((g) => ({
            materialId: Number(g.materialId),
            ...(g.samplingMode && /^\d+$/.test(g.jumlahUnit.trim()) ? { jumlahUnit: Number(g.jumlahUnit.trim()) } : {}),
            units: g.units.map((u) => ({
              label: u.label,
              items: u.items
                .filter((it) => it.hasil)
                .map((it) => ({ label: it.label, hasil: it.hasil, catatan: it.catatan, foto: it.foto })),
              ...(g.formDef ? { formData: Object.fromEntries(Object.entries(u.formData ?? {}).filter(([, v]) => v.trim())) } : {}),
            })),
          })),
        }),
      });
      toast({ title: "Dokumen retur tersimpan", description: "Status: sudah dicek pengawas, menunggu verifikasi gudang. Formulir bisa dicetak dari tab Riwayat — pilih dokumen, klik Cetak Formulir." });
      setTug10(""); setCatatan(""); setGroups([emptyGroup()]);
      if (draftKey) void clearReturDraft(draftKey);
      lastPushSigRef.current = null; // server sudah menghapus draft ini juga
      setDraftInfo(null);
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
      {draftInfo && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Draft retur {draftInfo.fromServer ? "dari perangkat lain" : "dari perangkat ini"} dipulihkan (tersimpan {fmtTanggal(new Date(draftInfo.savedAt).toISOString())}).
            Isian otomatis disimpan kembali &mdash; halaman boleh di-refresh.
          </p>
          <Button variant="outline" size="sm" onClick={discardDraft}>
            <Trash2 className="h-4 w-4 mr-1" /> Buang draft &amp; kosongkan
          </Button>
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
            <CardTitle className="text-base flex items-center gap-2"><PackageX className="h-4 w-4" /> Nomor Pengembalian (TUG 10)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nomor Pengembalian (TUG 10) <span className="text-red-600 font-bold" title="Wajib diisi">*</span></Label>
              <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Masukkan Nomor Pengembalian / Nomor TUG 10... (berlaku untuk semua material di dokumen ini)" rows={4} />
            </div>
            <p className="text-xs text-muted-foreground">Satu dokumen bisa memuat beberapa material berbeda — tiap material punya unit &amp; daftar pemeriksaan sendiri. Tambahkan lewat tombol &quot;Tambah Material&quot; di bawah.</p>
          </CardContent>
        </Card>
      </div>

      {groups.map((g, gi) => {
        const taken = new Set(groups.filter((_, i) => i !== gi).map((gg) => gg.materialId).filter(Boolean));
        return (
          <div key={g.key} className="space-y-4">
            <Card className={groups.length > 1 ? "border-primary/40" : ""}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <PackageX className="h-4 w-4" /> Material{groups.length > 1 ? ` ${gi + 1} — ${g.materialId ? nameOf(g.materialId) : "(belum dipilih)"}` : ""}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {g.templateLoading && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Memuat template...</span>}
                  {groups.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeGroup(gi)}>
                      <Trash2 className="h-4 w-4 mr-1" /> Hapus material
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Material <span className="text-red-600">*</span></Label>
                  <MaterialPicker materials={(materials ?? []).filter((m) => !taken.has(String(m.id)))} value={g.materialId} onChange={(id) => loadMaterialIntoGroup(gi, id)} invalid={!g.materialId} templateOkIds={tplOkIds ?? undefined} />
                  {!g.materialId && <p className="text-xs text-destructive">Wajib dipilih sebelum dokumen dapat disimpan.</p>}
                </div>
              </CardContent>
            </Card>

            {g.samplingMode && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">Mode Sampling{g.materialId ? ` — ${nameOf(g.materialId)}` : ""} — 1 unit contoh untuk semua unit</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">Jumlah unit seluruhnya</Label>
                      <Input type="number" min={1} className="h-9 w-40" value={g.jumlahUnit} onChange={(e) => updateGroup(gi, { jumlahUnit: e.target.value })} placeholder="mis. 25" />
                    </div>
                    <p className="text-xs text-muted-foreground max-w-md">Cukup periksa <b>satu unit contoh</b> di bawah — unit contoh ini mewakili seluruh unit lainnya sejumlah di atas.</p>
                  </div>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" onClick={() => lampiranRefs.current[gi]?.click()}>
                      <Paperclip className="h-4 w-4 mr-2" /> Unggah Dokumen Lampiran
                    </Button>
                    <input ref={(el) => { lampiranRefs.current[gi] = el; }} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { pickLampiran(gi, e.target.files); e.target.value = ""; }} />
                    {g.lampiranFiles.length > 0 && (
                      <div className="space-y-1 max-w-md">
                        {g.lampiranFiles.map((f, fi) => (
                          <div key={fi} className="flex items-center justify-between gap-2 text-sm border rounded-md px-2 py-1">
                            <span className="truncate">{f.name}</span>
                            <Button variant="ghost" size="sm" onClick={() => setGroups((prev) => prev.map((gg, i) => i !== gi ? gg : { ...gg, lampiranFiles: gg.lampiranFiles.filter((_, x) => x !== fi) }))}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Lampiran = dokumen pendukung (foto/PDF; maks 8 MB per file, maks 10 file) — tersimpan di folder Google Drive dokumen ini.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {g.units.map((unit, ui) => (
              <Card key={ui}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                  <CardTitle className="text-base">{groups.length > 1 && g.materialId ? `${nameOf(g.materialId)} — ` : ""}{unit.label}</CardTitle>
                  {g.units.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeUnit(gi, ui)}>
                      <Trash2 className="h-4 w-4 mr-1" /> Hapus unit
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {g.formDef && (
                    <div className="mb-4 rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
                      <div>
                        <p className="text-sm font-medium">Data Material — {g.formDef.formCode}</p>
                        <p className="text-xs text-muted-foreground">Isian ini tercetak pada bagian &quot;A. DATA MATERIAL&quot; formulir inspeksi. <b>Semua isian wajib diisi</b>.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[...(g.formDef.fields?.left ?? []), ...(g.formDef.fields?.right ?? [])].map((f) => (
                          <div key={f.key} className="space-y-1">
                            <Label className="text-xs">{f.label} <span className="text-red-600 font-bold" title="Wajib diisi">*</span>{f.hint ? <span className="text-muted-foreground font-normal"> — {f.hint}</span> : ""}</Label>
                            {f.options ? (
                              <Select value={unit.formData?.[f.key] ?? ""} onValueChange={(v) => setFormValue(gi, ui, f.key, v)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={f.hint ?? f.label} /></SelectTrigger>
                                <SelectContent>
                                  {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input className="h-8 text-xs" placeholder={f.hint ?? f.label}
                                value={unit.formData?.[f.key] ?? ""}
                                onChange={(e) => setFormValue(gi, ui, f.key, e.target.value)} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {unit.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {g.materialId
                        ? g.templateError
                          ? `Gagal memuat template material: ${g.templateError} — muat ulang halaman atau pilih ulang material.`
                          : isMcbCode((materials ?? []).find((m) => String(m.id) === String(g.materialId))?.code)
                            ? "Material MCB/MCCB tidak memerlukan komponen pemeriksaan — tipe dipilih dari dropdown di atas."
                            : "Template material ini kosong — atur daftar komponen di tab Pengaturan (master)."
                        : "Pilih material untuk memuat daftar pemeriksaan."}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Komponen bertanda <span className="text-red-600 font-bold">*</span> wajib difoto (dokumen ditolak bila hasil diisi tanpa foto).</p>
                      {unit.items.map((it, ii) => (
                        <div key={ii} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto] gap-2 items-center border-b border-border/50 pb-2 last:border-0">
                          <span className="text-sm">
                            {it.label}
                            {cfgFor(g, it.label).fotoWajib && (
                              <span className="text-red-600 font-bold ml-1" title="Foto komponen ini wajib">*</span>
                            )}
                          </span>
                          {cfgFor(g, it.label).tipeInput === "teks" ? (
                            <Input className="h-8 text-xs" placeholder="Ketik hasil..." value={it.hasil}
                              onChange={(e) => setItem(gi, ui, ii, { hasil: e.target.value })} />
                          ) : (
                            <Select value={it.hasil || "skip"} onValueChange={(v) => setItem(gi, ui, ii, { hasil: v === "skip" ? "" : v })}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Lewati" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">Kosong (lewati)</SelectItem>
                                {optionsFor(g, it.label).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                          <Input className="h-8 text-xs" placeholder="Catatan (opsional)" value={it.catatan}
                            onChange={(e) => setItem(gi, ui, ii, { catatan: e.target.value })} />
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant={it.hasil && !it.foto && cfgFor(g, it.label).fotoWajib ? "destructive" : "outline"}
                              onClick={() => { photoTarget.current = { group: gi, unit: ui, item: ii }; itemFileRef.current?.click(); }}>
                              <Camera className="h-3.5 w-3.5 mr-1" /> {it.foto ? "Ganti" : "Foto"}
                            </Button>
                            <Button size="sm" variant="outline"
                              onClick={() => { photoTarget.current = { group: gi, unit: ui, item: ii }; itemGalleryRef.current?.click(); }}>
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

            <Button variant="outline" onClick={() => addUnit(gi)} disabled={!g.materialId}>
              <Plus className="h-4 w-4 mr-2" /> {g.samplingMode ? "Tambah Unit Contoh" : "Tambah Unit"}{groups.length > 1 && g.materialId ? ` — ${nameOf(g.materialId)}` : ""}
            </Button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={addGroup}>
          <Plus className="h-4 w-4 mr-2" /> Tambah Material
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
