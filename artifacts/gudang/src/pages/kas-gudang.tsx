import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Trash2, Camera, Loader2, ScanText, ImageOff, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface KasRecord {
  id: number;
  tipe: "masuk" | "keluar";
  metode: "manual" | "ocr";
  jumlah: number;
  keterangan: string | null;
  hasBukti: boolean;
  userName: string;
  createdAt: string;
}
interface Summary { totalMasuk: number; totalKeluar: number; saldo: number; jumlahTransaksi: number; }

const fmt = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(n);

// ─── OCR: muat tesseract.js dari CDN (client-side, tanpa dependency build) ──
let tesseractPromise: Promise<any> | null = null;
function loadTesseract(): Promise<any> {
  const w = window as any;
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = () => resolve(w.Tesseract);
    s.onerror = () => { tesseractPromise = null; reject(new Error("Gagal memuat engine OCR (cek koneksi internet)")); };
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

function toNumberId(s: string): number | null {
  // Format Indonesia: titik = pemisah ribuan, koma = desimal
  const cleaned = s.replace(/\./g, "").replace(/,(\d{1,2})$/, "").replace(/,/g, "");
  const v = parseInt(cleaned, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Baca nominal rupiah dari hasil OCR bukti transfer / nota pembelian
function parseAmountFromOcr(text: string): number | null {
  const norm = text.replace(/\s+/g, " ");
  const candidates: number[] = [];
  let m: RegExpExecArray | null;
  // "Rp 1.500.000" / "Rp.1.500.000" / "IDR 1,500,000"
  const rpRe = /(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/gi;
  while ((m = rpRe.exec(norm))) { const v = toNumberId(m[1]); if (v) candidates.push(v); }
  // "Jumlah/Total/Nominal: 15.000"
  const labelRe = /(?:jumlah|total|nominal|transfer|bayar)[^\d]{0,15}(\d{1,3}(?:[.,]\d{3})+)/gi;
  while ((m = labelRe.exec(norm))) { const v = toNumberId(m[1]); if (v) candidates.push(v); }
  // Angka berdiri sendiri dengan pemisah ribuan (>= 4 digit)
  const numRe = /\b\d{1,3}(?:\.\d{3})+\b|\b\d{1,3}(?:,\d{3})+\b/g;
  while ((m = numRe.exec(norm))) { const v = toNumberId(m[0]); if (v) candidates.push(v); }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

export default function KasGudang() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [summary, setSummary]       = useState<Summary | null>(null);
  const [records, setRecords]       = useState<KasRecord[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [search, setSearch]         = useState("");

  const [tipe, setTipe]             = useState<"masuk" | "keluar">("masuk");
  const [metode, setMetode]         = useState<"manual" | "ocr">("manual");
  const [jumlah, setJumlah]         = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [buktiImage, setBuktiImage] = useState<string | null>(null); // data URL
  const [ocrStatus, setOcrStatus]   = useState<"idle" | "reading" | "done" | "fail">("idle");
  const [ocrText, setOcrText]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<KasRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [buktiView, setBuktiView] = useState<number | null>(null);
  const [buktiData, setBuktiData] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sumRes, recRes] = await Promise.all([
        fetch("/api/kas/summary"),
        fetch(`/api/kas/transaksi${search ? `?search=${encodeURIComponent(search)}` : ""}`),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (recRes.ok) setRecords(await recRes.json());
    } catch { /* ignore */ } finally { setIsLoading(false); }
  }, [search]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ title: "File harus berupa gambar", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setBuktiImage(dataUrl);
      setMetode("ocr");
      setOcrStatus("reading");
      setOcrText("");
      try {
        const Tesseract = await loadTesseract();
        const { data } = await Tesseract.recognize(dataUrl, "eng", { logger: () => {} });
        const text: string = data.text || "";
        setOcrText(text);
        const amount = parseAmountFromOcr(text);
        if (amount) {
          setJumlah(String(amount));
          setOcrStatus("done");
          toast({ title: "Nominal terbaca", description: fmt(amount) + " — periksa sebelum simpan" });
        } else {
          setOcrStatus("fail");
          toast({ title: "Nominal tidak terbaca", description: "Silakan input manual nominalnya", variant: "destructive" });
        }
      } catch (e: any) {
        setOcrStatus("fail");
        toast({ title: "OCR gagal", description: e?.message || "Coba lagi", variant: "destructive" });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!user) return;
    const amt = Number(jumlah.replace(/\D/g, ""));
    if (!amt || amt <= 0) { toast({ title: "Nominal tidak valid", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kas/transaksi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipe, metode, jumlah: amt,
          keterangan: keterangan.trim() || (tipe === "masuk" ? "Kas masuk" : "Kas keluar"),
          buktiImage: buktiImage,
          userId: user.id,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Gagal menyimpan", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: tipe === "masuk" ? "Kas masuk tercatat" : "Kas keluar tercatat", description: fmt(amt) });
      setJumlah(""); setKeterangan(""); setBuktiImage(null);
      setOcrStatus("idle"); setOcrText(""); setMetode("manual");
      loadData();
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/kas/transaksi/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) { toast({ title: "Transaksi dihapus" }); setDeleteTarget(null); loadData(); }
      else toast({ title: "Gagal menghapus", variant: "destructive" });
    } finally { setDeleting(false); }
  };

  const openBukti = async (id: number) => {
    setBuktiView(id); setBuktiData(null);
    try {
      const res = await fetch(`/api/kas/transaksi/${id}`);
      if (res.ok) { const d = await res.json(); setBuktiData(d.buktiImage); }
    } catch { /* ignore */ }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-primary/10 rounded-lg"><Wallet className="w-6 h-6 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">Kas Gudang</h1>
          <p className="text-sm text-muted-foreground">Pengelolaan kas kecil gudang — manual & auto-baca dari foto bukti</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="p-3 bg-green-500/10 rounded-full"><ArrowDownCircle className="w-6 h-6 text-green-600" /></div>
          <div><p className="text-xs uppercase font-semibold text-muted-foreground">Total Kas Masuk</p><p className="text-xl font-bold text-green-600">{summary ? fmt(summary.totalMasuk) : "-"}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="p-3 bg-red-500/10 rounded-full"><ArrowUpCircle className="w-6 h-6 text-red-600" /></div>
          <div><p className="text-xs uppercase font-semibold text-muted-foreground">Total Kas Keluar</p><p className="text-xl font-bold text-red-600">{summary ? fmt(summary.totalKeluar) : "-"}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-full"><Wallet className="w-6 h-6 text-primary" /></div>
          <div><p className="text-xs uppercase font-semibold text-muted-foreground">Saldo Kas</p><p className="text-xl font-bold">{summary ? fmt(summary.saldo) : "-"}</p></div>
        </CardContent></Card>
      </div>

      {/* Form input */}
      <Card>
        <CardHeader><CardTitle className="text-base">Catat Transaksi</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant={tipe === "masuk" ? "default" : "outline"} className={tipe === "masuk" ? "bg-green-600 hover:bg-green-700" : ""} onClick={() => setTipe("masuk")}>
              <ArrowDownCircle className="w-4 h-4 mr-2" /> Kas Masuk
            </Button>
            <Button variant={tipe === "keluar" ? "default" : "outline"} className={tipe === "keluar" ? "bg-red-600 hover:bg-red-700" : ""} onClick={() => setTipe("keluar")}>
              <ArrowUpCircle className="w-4 h-4 mr-2" /> Kas Keluar
            </Button>
            <div className="flex-1" />
            <Button variant={metode === "manual" ? "secondary" : "ghost"} size="sm" onClick={() => setMetode("manual")}>Manual</Button>
            <Button variant={metode === "ocr" ? "secondary" : "ghost"} size="sm" onClick={() => setMetode("ocr")}>
              <ScanText className="w-4 h-4 mr-1.5" /> Foto Bukti (Auto)
            </Button>
          </div>

          {metode === "ocr" && (
            <div className="border-2 border-dashed rounded-lg p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {tipe === "masuk" ? "Unggah foto bukti transfer — nominal akan otomatis dibaca dan terinput ke kas masuk."
                                  : "Unggah foto nota pembelian — nominal akan otomatis dibaca dan masuk ke kas keluar."}
              </p>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => handleFile(e.target.files?.[0] ?? null)} />
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Camera className="w-4 h-4 mr-2" /> Pilih / Foto Bukti
                </Button>
                {ocrStatus === "reading" && <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Membaca nominal...</span>}
                {ocrStatus === "done" && <Badge className="bg-green-600">Nominal terbaca — periksa dulu</Badge>}
                {ocrStatus === "fail" && <Badge variant="destructive">Gagal membaca — input manual di kolom nominal</Badge>}
              </div>
              {buktiImage && (
                <div className="flex items-start gap-3">
                  <img src={buktiImage} alt="bukti" className="max-h-40 rounded border" />
                  <Button variant="ghost" size="sm" onClick={() => { setBuktiImage(null); setOcrStatus("idle"); }}>
                    <ImageOff className="w-4 h-4 mr-1" /> Hapus foto
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nominal (Rp)</Label>
              <Input inputMode="numeric" placeholder={tipe === "masuk" ? "mis. 150000" : "mis. 75000"}
                value={jumlah} onChange={e => setJumlah(e.target.value.replace(/[^\d]/g, ""))} />
              {jumlah && <p className="text-sm text-muted-foreground">{fmt(Number(jumlah))}</p>}
            </div>
            <div className="space-y-2">
              <Label>Keterangan</Label>
              <Input placeholder={tipe === "masuk" ? "mis. Transfer dari Bendahara" : "mis. Beli ATK / nota belanja"}
                value={keterangan} onChange={e => setKeterangan(e.target.value)} />
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !jumlah} className={tipe === "masuk" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Simpan {tipe === "masuk" ? "Kas Masuk" : "Kas Keluar"}
          </Button>
        </CardContent>
      </Card>

      {/* Riwayat */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Riwayat Transaksi Kas</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="Cari keterangan/operator..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-56" />
            <Button variant="outline" size="sm" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : records.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Belum ada transaksi kas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-center">Bukti</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id}>
                    <td className="whitespace-nowrap text-sm">{new Date(r.createdAt).toLocaleString("id-ID")}</td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <Badge className={r.tipe === "masuk" ? "bg-green-600 w-fit" : "bg-red-600 w-fit"}>{r.tipe === "masuk" ? "MASUK" : "KELUAR"}</Badge>
                        {r.metode === "ocr" && <Badge variant="outline" className="w-fit text-xs">auto-OCR</Badge>}
                      </div>
                    </td>
                    <td className="text-sm max-w-[220px] truncate">{r.keterangan ?? "-"}</td>
                    <td className={`text-right font-semibold whitespace-nowrap ${r.tipe === "masuk" ? "text-green-600" : "text-red-600"}`}>
                      {r.tipe === "masuk" ? "+" : "-"} {fmt(r.jumlah)}
                    </td>
                    <td className="text-sm">{r.userName}</td>
                    <td className="text-center">
                      {r.hasBukti ? (
                        <Button variant="ghost" size="sm" onClick={() => openBukti(r.id)}><Camera className="w-4 h-4" /></Button>
                      ) : <span className="text-muted-foreground text-xs">-</span>}
                    </td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(r)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog lihat bukti */}
      <Dialog open={buktiView !== null} onOpenChange={open => { if (!open) { setBuktiView(null); setBuktiData(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Foto Bukti Transaksi</DialogTitle></DialogHeader>
          {buktiData === null ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
            : buktiData ? <img src={buktiData} alt="bukti transaksi" className="max-h-[70vh] mx-auto rounded" />
            : <p className="text-muted-foreground">Bukti tidak ditemukan.</p>}
        </DialogContent>
      </Dialog>

      {/* Konfirmasi hapus */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus transaksi ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && `${deleteTarget.tipe === "masuk" ? "Kas masuk" : "Kas keluar"} ${fmt(deleteTarget.jumlah)} — ${deleteTarget.keterangan ?? "-"}`}
            </AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
