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
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Trash2, Camera, Loader2, ScanText, ImageOff, RefreshCw,
  FileDown, Printer, Clock, Pencil, UserPlus, MapPin, Smile,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";

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
  // Format Indonesia: titik = pemisah ribuan, koma = desimal, spasi = pemisah ribuan
  const cleaned = s.replace(/ /g, "").replace(/\./g, "").replace(/,(\d{1,2})$/, "").replace(/,/g, "");
  const v = parseInt(cleaned, 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Koreksi kesalahan baca OCR yang umum pada digit (hanya diterapkan ke kelompok angka)
const OCR_DIGIT_FIX: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0", q: "0",
  I: "1", l: "1", "|": "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  B: "8",
  G: "6", b: "6",
  T: "7",
  g: "9",
};
const fixOcrDigits = (s: string) => s.replace(/[A-Za-z|]/g, ch => OCR_DIGIT_FIX[ch] ?? ch);

// Baca nominal rupiah dari hasil OCR bukti transfer / nota pembelian.
// Skor: angka di dekat label "Rp" / "Jumlah/Total" lebih dipercaya daripada angka berdiri
// sendiri (nomor referensi/tanggal sering lebih besar dari nominal → jangan pilih max buta).
function parseAmountFromOcr(text: string): number | null {
  const norm = text.replace(/\s+/g, " ");
  const cands: { v: number; score: number }[] = [];
  const add = (raw: string, score: number) => {
    const v = toNumberId(fixOcrDigits(raw));
    if (v && v >= 100 && v <= 99_999_999_999) cands.push({ v, score });
  };
  let m: RegExpExecArray | null;
  // "Rp 1.500.000" / "Rp.1.500.000" / "IDR 1,500,000" / "Rp 1 500 000"
  // + salah baca umum "Rp" oleh OCR (Rb, Rd, Rn, Pd)
  const rpRe = /(?:Rp\.?|R[bnd][pdl]?\.?|IDR)\s*([0-9](?:[0-9.,]|\s\d{3})*)/gi;
  while ((m = rpRe.exec(norm))) add(m[1], 3);
  // "Jumlah/Total/Nominal/Tagihan: 15.000"
  const labelRe = /(?:jumlah|total|nominal|transfer|bayar|tagihan)[^\d]{0,15}(\d{1,3}(?:[.,]\d{3})+)/gi;
  while ((m = labelRe.exec(norm))) add(m[1], 3);
  // Angka berdiri sendiri dengan pemisah ribuan (>= 4 digit)
  const numRe = /\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{1,3}(?:\s\d{3})+\b/g;
  while ((m = numRe.exec(norm))) add(m[0], 1);
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score || b.v - a.v);
  return cands[0].v;
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

  // ── Lembur ──
  const [view, setView]                   = useState<"kas" | "lembur">("kas");
  const [karyawan, setKaryawan]           = useState<{ id: number; nama: string }[]>([]);
  const [absensi, setAbsensi]             = useState<any[]>([]);
  const [tglLembur, setTglLembur]         = useState(() => new Date().toISOString().slice(0, 10));
  const [editKaryawan, setEditKaryawan]   = useState<{ id: number; nama: string } | null>(null);
  const [newKaryawan, setNewKaryawan]     = useState("");
  const [feeInputs, setFeeInputs]         = useState<Record<number, string>>({});

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

  const loadLembur = useCallback(async () => {
    try {
      const [kRes, aRes] = await Promise.all([
        fetch("/api/kas/lembur/karyawan"),
        fetch("/api/kas/lembur/absensi"),
      ]);
      if (kRes.ok) setKaryawan(await kRes.json());
      if (aRes.ok) setAbsensi(await aRes.json());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadLembur(); }, [loadLembur]);

  // ── handler lembur ──
  const [selfieDialog, setSelfieDialog] = useState<{ karyawanId: number; nama: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const getBrowserLocation = (): Promise<{ lat: number; lng: number }> => new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Browser tidak mendukung GPS")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.message === "User denied Geolocation" ? "Izin GPS ditolak — izinkan lokasi di browser" : "Gagal membaca GPS: " + err.message)),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  const doAbsen = async (karyawanId: number, lat: number, lng: number, selfieImage: string | null) => {
    const res = await fetch("/api/kas/lembur/absensi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ karyawanId, tanggal: tglLembur, jenis: "gps", lat, lng, selfieImage }),
    });
    if (res.ok) {
      const d = await res.json();
      toast({ title: "Absensi lembur tercatat", description: d.jarakMeter != null ? `Terverifikasi di lokasi kerja (${d.jarakMeter} m dari titik)` : undefined });
      loadLembur();
    } else { const d = await res.json().catch(() => ({})); toast({ title: "Absensi ditolak", description: d.error, variant: "destructive" }); }
  };

  // Klik absen → minta GPS, lalu buka kamera selfie
  const toggleAbsen = async (karyawanId: number, nama: string) => {
    const existing = absensi.find(a => a.karyawanId === karyawanId && a.tanggal === tglLembur);
    if (existing) {
      const res = await fetch(`/api/kas/lembur/absensi/${existing.id}`, { method: "DELETE" });
      if (res.ok) { toast({ title: "Absensi dibatalkan" }); loadLembur(); loadData(); }
      return;
    }
    let loc: { lat: number; lng: number };
    try {
      // PENTING: jangan tampilkan toast/overlay sebelum getCurrentPosition —
      // Chrome Android menolak pop-up izin lokasi saat ada overlay aktif
      loc = await getBrowserLocation();
    } catch (e: any) { toast({ title: "GPS gagal", description: e?.message, variant: "destructive" }); return; }
    setSelfieDialog({ karyawanId, nama });
    // simpan loc di ref agar dipakai saat capture
    pendingLocRef.current = loc;
  };
  const pendingLocRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => { if (selfieDialog) startCamera(); /* eslint-disable-next-line */ }, [selfieDialog]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch {
      toast({ title: "Kamera tidak tersedia", description: "Absen tetap bisa dilanjutkan tanpa foto wajah", variant: "destructive" });
      if (pendingLocRef.current && selfieDialog) {
        await doAbsen(selfieDialog.karyawanId, pendingLocRef.current.lat, pendingLocRef.current.lng, null);
        closeSelfie();
      }
    }
  };
  const closeSelfie = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setSelfieDialog(null);
    pendingLocRef.current = null;
  };
  const captureSelfie = () => {
    const video = videoRef.current;
    if (!video || !pendingLocRef.current || !selfieDialog) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width, 0); ctx.scale(-1, 1); // mirror selfie
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    doAbsen(selfieDialog.karyawanId, pendingLocRef.current.lat, pendingLocRef.current.lng, dataUrl);
    closeSelfie();
  };

  const [selfieView, setSelfieView] = useState<string | null>(null);
  const openSelfie = async (id: number) => {
    try {
      const res = await fetch(`/api/kas/lembur/absensi/${id}`);
      if (res.ok) { const d = await res.json(); setSelfieView(d.selfieImage); }
    } catch { /* ignore */ }
  };

  // ── lokasi kerja lembur ──
  const [lokasi, setLokasi] = useState<any | null>(null);
  const [editLokasi, setEditLokasi] = useState(false);
  const [locForm, setLocForm] = useState({ lat: "", lng: "", radius: "100", label: "" });

  const loadLokasi = useCallback(async () => {
    try { const res = await fetch("/api/kas/lembur/lokasi"); if (res.ok) setLokasi(await res.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadLokasi(); }, [loadLokasi]);

  const ambilLokasiSekarang = async () => {
    try {
      // Tanpa toast dulu: overlay membuat Chrome Android menolak pop-up izin lokasi
      const loc = await getBrowserLocation();
      setLocForm(f => ({ ...f, lat: loc.lat.toFixed(6), lng: loc.lng.toFixed(6) }));
      toast({ title: "Koordinat diambil dari posisi saat ini" });
    } catch (e: any) { toast({ title: "GPS gagal", description: (e?.message || "") + " — Bisa juga isi manual dari Google Maps.", variant: "destructive" }); }
  };
  const saveLokasi = async () => {
    const res = await fetch("/api/kas/lembur/lokasi", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: locForm.lat, lng: locForm.lng, radiusMeter: Number(locForm.radius), label: locForm.label }),
    });
    if (res.ok) { toast({ title: "Lokasi kerja lembur tersimpan" }); setEditLokasi(false); loadLokasi(); }
    else { const d = await res.json().catch(() => ({})); toast({ title: "Gagal", description: d.error, variant: "destructive" }); }
  };

  const saveFee = async (id: number) => {
    const raw = feeInputs[id];
    const fee = raw === "" || raw === undefined ? null : Number(raw);
    const res = await fetch(`/api/kas/lembur/absensi/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fee, userId: user?.id }),
    });
    if (res.ok) { toast({ title: "Fee tersimpan", description: fee ? fmt(fee) + " tercatat sebagai kas keluar" : "Fee dihapus" }); loadLembur(); loadData(); }
    else toast({ title: "Gagal menyimpan fee", variant: "destructive" });
  };

  const saveKaryawan = async (id: number | null, nama: string) => {
    const res = await fetch(id ? `/api/kas/lembur/karyawan/${id}` : "/api/kas/lembur/karyawan", {
      method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nama }),
    });
    if (res.ok) { toast({ title: id ? "Nama diperbarui" : "Karyawan ditambahkan" }); setEditKaryawan(null); setNewKaryawan(""); loadLembur(); }
    else { const d = await res.json().catch(() => ({})); toast({ title: "Gagal", description: d.error, variant: "destructive" }); }
  };

  // ── export mutasi kas ──
  const exportColumns = [
    { key: "tanggal", label: "Tanggal", w: 18 },
    { key: "tipe", label: "Tipe", w: 8 },
    { key: "metode", label: "Metode", w: 8 },
    { key: "keterangan", label: "Keterangan", w: 34 },
    { key: "jumlah", label: "Nominal", w: 16 },
    { key: "operator", label: "Operator", w: 14 },
  ];
  const exportRows = () => records.map(r => ({
    tanggal: new Date(r.createdAt).toLocaleString("id-ID"),
    tipe: r.tipe.toUpperCase(),
    metode: r.metode === "ocr" ? "Auto-OCR" : "Manual",
    keterangan: r.keterangan ?? "-",
    jumlah: (r.tipe === "masuk" ? "+" : "-") + new Intl.NumberFormat("id-ID").format(r.jumlah),
    operator: r.userName,
  }));

  const handleExportExcel = () => {
    if (records.length === 0) { toast({ title: "Tidak ada data", variant: "destructive" }); return; }
    const aoa: (string | number)[][] = [
      ["Laporan Mutasi Kas Gudang"],
      [`Dicetak: ${new Date().toLocaleString("id-ID")}  |  ${records.length} transaksi`],
      [],
      exportColumns.map(c => c.label),
      ...exportRows().map(r => [r.tanggal, r.tipe, r.metode, r.keterangan, r.jumlah, r.operator]),
      [],
      ["Total Kas Masuk", "", "", "", new Intl.NumberFormat("id-ID").format(summary?.totalMasuk ?? 0)],
      ["Total Kas Keluar", "", "", "", new Intl.NumberFormat("id-ID").format(summary?.totalKeluar ?? 0)],
      ["Saldo", "", "", "", new Intl.NumberFormat("id-ID").format(summary?.saldo ?? 0)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = exportColumns.map(c => ({ wch: c.w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mutasi Kas");
    XLSX.writeFile(wb, `mutasi-kas-gudang-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportPDF = () => {
    if (records.length === 0) { toast({ title: "Tidak ada data", variant: "destructive" }); return; }
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Laporan Mutasi Kas Gudang", margin, 16);
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
    doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}  |  ${records.length} transaksi`, margin, 22);
    doc.setTextColor(0);
    const colX = [margin, margin + 32, margin + 46, margin + 58, pageW - margin - 32, pageW - margin - 16];
    let y = 30;
    doc.setFontSize(8); doc.setFont("helvetica", "bold");
    ["Tanggal", "Tipe", "Metode", "Keterangan", "Nominal", "Operator"].forEach((h, i) => doc.text(h, colX[i], y));
    y += 2; doc.setLineWidth(0.2); doc.line(margin, y, pageW - margin, y); y += 4;
    doc.setFont("helvetica", "normal");
    for (const r of exportRows()) {
      if (y > pageH - 15) { doc.addPage(); y = 16; }
      const ket = doc.splitTextToSize(r.keterangan, pageW - margin - 16 - (colX[3]) - 2)[0] ?? "";
      doc.text(r.tanggal, colX[0], y);
      doc.text(r.tipe, colX[1], y);
      doc.text(r.metode, colX[2], y);
      doc.text(ket, colX[3], y);
      doc.text(r.jumlah, colX[4], y);
      doc.text(r.operator, colX[5], y);
      y += 5;
    }
    y += 2; doc.setLineWidth(0.3); doc.line(margin, y, pageW - margin, y); y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(`Total Kas Masuk: ${fmt(summary?.totalMasuk ?? 0)}`, margin, y); y += 5;
    doc.text(`Total Kas Keluar: ${fmt(summary?.totalKeluar ?? 0)}`, margin, y); y += 5;
    doc.text(`Saldo: ${fmt(summary?.saldo ?? 0)}`, margin, y);
    doc.save(`mutasi-kas-gudang-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Kompres foto bukti: max sisi 1280px, JPEG q0.72 — cukup terbaca utk OCR/arsip,
  // tapi tidak membebani database (biasanya turun dari beberapa MB jadi <300KB)
  const compressImage = (dataUrl: string): Promise<string> => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1280;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL("image/jpeg", 0.72);
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  // Pra-pemrosesan untuk OCR: grayscale + tingkatkan kontras + upscale gambar kecil.
  // (Arsip yang disimpan tetap versi kompresi 1280px; ini hanya untuk pembacaan.)
  const preprocessForOcr = (dataUrl: string): Promise<string> => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const MIN = 1600, MAXDIM = 2000;
      if (Math.max(w, h) < MIN) { const s = MIN / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      else if (Math.max(w, h) > MAXDIM) { const s = MAXDIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const idata = ctx.getImageData(0, 0, w, h);
        const d = idata.data;
        // hitung rata-rata untuk auto-contrast
        let sum = 0;
        const gray = new Uint8ClampedArray(d.length / 4);
        for (let i = 0; i < d.length; i += 4) {
          const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
          gray[i / 4] = g; sum += g;
        }
        const mean = sum / (d.length / 4);
        // contrast factor sederhana berbasis rata-rata (1.5x–2x)
        const factor = mean > 128 ? 1.8 : 1.5;
        for (let i = 0; i < gray.length; i++) {
          let g = ((gray[i] - mean) * factor) + 128;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          const p = i * 4;
          d[p] = d[p + 1] = d[p + 2] = g;
        }
        ctx.putImageData(idata, 0, 0);
      } catch { /* canvas tainted? pakai gambar mentah */ }
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ title: "File harus berupa gambar", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const original = reader.result as string;
      const dataUrl = await compressImage(original);
      setBuktiImage(dataUrl);
      setMetode("ocr");
      setOcrStatus("reading");
      setOcrText("");
      try {
        const Tesseract = await loadTesseract();
        // OCR dari gambar ASLI (sebelum kompresi) agar detail angka tidak hilang
        const ocrInput = await preprocessForOcr(original);
        const { data } = await Tesseract.recognize(ocrInput, "eng", { logger: () => {} });
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
      {view === "kas" && (<>
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
            <Button variant={view === "lembur" ? "default" : "outline"} className={view === "lembur" ? "bg-amber-600 hover:bg-amber-700" : ""} onClick={() => setView(view === "lembur" ? "kas" : "lembur")}>
              <Clock className="w-4 h-4 mr-2" /> Lembur
            </Button>
            <div className="flex-1" />
            <Button variant={metode === "manual" ? "secondary" : "ghost"} size="sm" onClick={() => setMetode("manual")}>Manual</Button>
            <Button variant={metode === "ocr" ? "secondary" : "ghost"} size="sm" onClick={() => setMetode("ocr")}>
              <ScanText className="w-4 h-4 mr-1.5" /> Foto Bukti (Auto)
            </Button>
          </div>

          <div className="border-2 border-dashed rounded-lg p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {metode === "ocr"
                ? (tipe === "masuk" ? "Unggah foto bukti transfer — nominal akan otomatis dibaca dan terinput ke kas masuk."
                                    : "Unggah foto nota pembelian — nominal akan otomatis dibaca dan masuk ke kas keluar.")
                : "Opsional: lampirkan foto bukti transfer / nota pembelian sebagai arsip (tersimpan di riwayat)."}
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
              {buktiImage && ocrStatus === "idle" && <Badge variant="outline">Foto terlampir sebagai arsip</Badge>}
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
            <Button variant="outline" size="sm" onClick={handleExportExcel}><FileDown className="w-4 h-4 mr-1.5" /> Excel</Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF}><Printer className="w-4 h-4 mr-1.5" /> PDF</Button>
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

      </>)}

      {/* ═══ PANEL LEMBUR ═══ */}
      {view === "lembur" && (<>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /> Absensi Lembur (Sabtu/Minggu)</CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Tanggal:</Label>
              <Input type="date" value={tglLembur} onChange={e => setTglLembur(e.target.value)} className="h-9 w-40" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pengaturan lokasi kerja */}
            <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
              {lokasi ? (
                <span className="text-sm">
                  Lokasi kerja: <b>{lokasi.label || "Tanpa nama"}</b> ({lokasi.lat}, {lokasi.lng}) · radius <b>{lokasi.radiusMeter} m</b>
                </span>
              ) : (
                <span className="text-sm text-amber-600">Lokasi kerja belum diatur — absensi belum divalidasi GPS. Atur dulu di bawah ini.</span>
              )}
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => { setLocForm({ lat: lokasi?.lat ?? "", lng: lokasi?.lng ?? "", radius: String(lokasi?.radiusMeter ?? 100), label: lokasi?.label ?? "" }); setEditLokasi(true); }}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Atur Lokasi
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Tanggal terpilih: <b>{new Date(tglLembur + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b>
              {(() => { const d = new Date(tglLembur + "T00:00:00").getDay(); return d !== 0 && d !== 6 ? <span className="text-amber-600"> — bukan hari Sabtu/Minggu</span> : null; })()}
              {" "}· klik <MapPin className="w-3.5 h-3.5 inline" /> <b>Absen</b>: sistem mengambil GPS perangkat lalu meminta <b>foto selfie</b> via kamera HP. Absensi ditolak jika karyawan tidak berada dalam radius lokasi kerja. Fee diisi bendahara dan otomatis tercatat sebagai kas keluar.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead className="text-center">Absen (GPS + Selfie)</TableHead>
                  <TableHead className="text-right">Fee Lembur (Rp)</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {karyawan.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Belum ada karyawan. Tambahkan di bawah.</TableCell></TableRow>
                )}
                {karyawan.map(k => {
                  const rec = absensi.find(a => a.karyawanId === k.id && a.tanggal === tglLembur);
                  const feeVal = feeInputs[rec?.id] ?? (rec?.fee != null ? String(rec.fee) : "");
                  return (
                    <TableRow key={k.id}>
                      <td className="font-medium">{k.nama}</td>
                      <td className="text-center">
                        {rec ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge className="bg-green-600"><MapPin className="w-3 h-3 mr-1" />HADIR{rec.jarakMeter != null ? ` · ${rec.jarakMeter} m` : ""}</Badge>
                            {rec.hasSelfie && <Badge variant="outline" className="text-blue-600 border-blue-600"><Smile className="w-3 h-3 mr-1" />selfie ✓</Badge>}
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => toggleAbsen(k.id, k.nama)}>
                            <MapPin className="w-4 h-4 mr-1.5" /> Absen
                          </Button>
                        )}
                      </td>
                      <td className="text-right">
                        {rec ? (
                          <div className="flex items-center justify-end gap-2">
                            <Input inputMode="numeric" placeholder="0" className="h-8 w-32 text-right"
                              value={feeVal} onChange={e => setFeeInputs(p => ({ ...p, [rec.id]: e.target.value.replace(/[^\d]/g, "") }))} />
                            <Button variant="outline" size="sm" onClick={() => saveFee(rec.id)}>Simpan</Button>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">-</span>}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditKaryawan({ id: k.id, nama: k.nama })}><Pencil className="w-4 h-4" /></Button>
                          {rec && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => toggleAbsen(k.id, k.nama)}><Trash2 className="w-4 h-4" /></Button>}
                        </div>
                      </td>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-sm">Tambah karyawan</Label>
                <Input placeholder="Nama karyawan..." value={newKaryawan} onChange={e => setNewKaryawan(e.target.value)} className="h-9 w-56" />
              </div>
              <Button variant="outline" onClick={() => newKaryawan.trim() && saveKaryawan(null, newKaryawan.trim())}>
                <UserPlus className="w-4 h-4 mr-2" /> Tambah
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Riwayat Absensi Lembur</CardTitle></CardHeader>
          <CardContent>
            {absensi.length === 0 ? <p className="text-center text-muted-foreground py-6">Belum ada absensi lembur.</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Karyawan</TableHead>
                    <TableHead className="text-center">Verifikasi</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {absensi.map(a => (
                    <TableRow key={a.id}>
                      <td className="whitespace-nowrap text-sm">{new Date(a.tanggal + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</td>
                      <td className="font-medium">{a.karyawan}</td>
                      <td className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <MapPin className="w-3 h-3 mr-1" />GPS{a.jarakMeter != null ? ` · ${a.jarakMeter} m` : ""}
                          </Badge>
                          {a.hasSelfie
                            ? <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600" onClick={() => openSelfie(a.id)}><Smile className="w-3 h-3 mr-1" />lihat selfie</Button>
                            : <span className="text-xs text-muted-foreground">tanpa foto</span>}
                        </div>
                      </td>
                      <td className="text-right whitespace-nowrap">{a.fee != null ? <span className="text-red-600 font-semibold">{fmt(a.fee)}</span> : <span className="text-muted-foreground text-xs">belum diinput</span>}</td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </>)}

      {/* Dialog selfie saat absen */}
      <Dialog open={selfieDialog !== null} onOpenChange={open => { if (!open) closeSelfie(); }}>
        <DialogContent onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader><DialogTitle>Absen Lembur — Foto Wajah</DialogTitle></DialogHeader>
          {selfieDialog && (<>
            <p className="text-sm text-muted-foreground">
              Karyawan: <b>{selfieDialog.nama}</b> · GPS sudah terbaca. Ambil <b>foto selfie</b> untuk melengkapi absensi.
            </p>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3]">
              <video ref={videoRef} className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} muted playsInline
                onCanPlay={() => {}} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeSelfie}>Batal</Button>
              <Button onClick={captureSelfie}><Camera className="w-4 h-4 mr-2" />Ambil Foto & Absen</Button>
            </div>
          </>)}
        </DialogContent>
      </Dialog>

      {/* Dialog lihat selfie tersimpan */}
      <Dialog open={selfieView !== null} onOpenChange={open => { if (!open) setSelfieView(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Foto Selfie Absensi Lembur</DialogTitle></DialogHeader>
          {selfieView ? <img src={selfieView} alt="selfie absensi" className="max-h-[70vh] mx-auto rounded" /> : null}
        </DialogContent>
      </Dialog>

      {/* Dialog atur lokasi kerja lembur */}
      <Dialog open={editLokasi} onOpenChange={setEditLokasi}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atur Lokasi Kerja Lembur</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Absensi hanya diterima jika GPS karyawan berada dalam radius dari titik ini. Bisa ambil koordinat dari posisi Anda sekarang (berdiri di lokasi kerja).</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Latitude</Label><Input value={locForm.lat} onChange={e => setLocForm(f => ({ ...f, lat: e.target.value }))} placeholder="-7.xxx" /></div>
              <div className="space-y-1"><Label>Longitude</Label><Input value={locForm.lng} onChange={e => setLocForm(f => ({ ...f, lng: e.target.value }))} placeholder="110.xxx" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Radius (meter)</Label><Input inputMode="numeric" value={locForm.radius} onChange={e => setLocForm(f => ({ ...f, radius: e.target.value.replace(/[^\d]/g, "") }))} /></div>
              <div className="space-y-1"><Label>Nama Lokasi</Label><Input value={locForm.label} onChange={e => setLocForm(f => ({ ...f, label: e.target.value }))} placeholder="mis. Gudang Pemaron" /></div>
            </div>
            <Button variant="outline" size="sm" onClick={ambilLokasiSekarang}><MapPin className="w-4 h-4 mr-2" />Ambil dari posisi saya sekarang</Button>
            <p className="text-xs text-muted-foreground">
              Jika izin lokasi gagal diminta browser, isi manual: buka <a className="underline" href="https://maps.google.com" target="_blank" rel="noreferrer">maps.google.com</a> dari HP di lokasi kerja → klik kanan/tahan titik → salin koordinatnya ke kolom di atas.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditLokasi(false)}>Batal</Button>
              <Button onClick={saveLokasi}>Simpan Lokasi</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog edit nama karyawan */}
      <Dialog open={editKaryawan !== null} onOpenChange={open => { if (!open) setEditKaryawan(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Nama Karyawan</DialogTitle></DialogHeader>
          {editKaryawan && (<>
            <Input value={editKaryawan.nama} onChange={e => setEditKaryawan({ ...editKaryawan, nama: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditKaryawan(null)}>Batal</Button>
              <Button onClick={() => editKaryawan.nama.trim() && saveKaryawan(editKaryawan.id, editKaryawan.nama.trim())}>Simpan</Button>
            </div>
          </>)}
        </DialogContent>
      </Dialog>

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
