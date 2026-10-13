import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Smile, Clock, Camera, Trash2 } from "lucide-react";

interface Karyawan { id: number; nama: string; }
interface AbsenRow {
  id: number; karyawanId: number; karyawan: string; tanggal: string;
  jarakMeter: number | null; hasSelfie: boolean; fee: number | null;
}

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const tgl = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);

export default function Absensi() {
  const { toast } = useToast();
  const [karyawan, setKaryawan] = useState<Karyawan[]>([]);
  const [absensi, setAbsensi] = useState<AbsenRow[]>([]);
  const [tglAbsen, setTglAbsen] = useState(today());
  const [loading, setLoading] = useState(true);

  const [selfieDialog, setSelfieDialog] = useState<{ karyawanId: number; nama: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingLocRef = useRef<{ lat: number; lng: number } | null>(null);

  const [selfieView, setSelfieView] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kRes, aRes] = await Promise.all([
        fetch("/api/kas/lembur/karyawan"),
        fetch("/api/kas/lembur/absensi"),
      ]);
      if (kRes.ok) setKaryawan(await kRes.json());
      if (aRes.ok) setAbsensi(await aRes.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

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
      body: JSON.stringify({ karyawanId, tanggal: tglAbsen, jenis: "gps", lat, lng, selfieImage }),
    });
    if (res.ok) {
      const d = await res.json();
      toast({ title: "Absensi tercatat", description: d.jarakMeter != null ? `Terverifikasi di lokasi kerja (${d.jarakMeter} m dari titik). Fee akan diisi bendahara.` : "Fee akan diisi bendahara." });
      load();
    } else { const d = await res.json().catch(() => ({})); toast({ title: "Absensi ditolak", description: d.error, variant: "destructive" }); }
  };

  const absen = async (k: Karyawan) => {
    let loc: { lat: number; lng: number };
    // PENTING: jangan tampilkan toast/overlay sebelum getCurrentPosition —
    // Chrome Android menolak pop-up izin lokasi saat ada overlay aktif
    try { loc = await getBrowserLocation(); }
    catch (e: any) { toast({ title: "GPS gagal", description: e?.message, variant: "destructive" }); return; }
    pendingLocRef.current = loc;
    setSelfieDialog({ karyawanId: k.id, nama: k.nama });
  };

  const batalAbsen = async (rec: AbsenRow) => {
    const res = await fetch(`/api/kas/lembur/absensi/${rec.id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Absensi dibatalkan" }); load(); }
    else { const d = await res.json().catch(() => ({})); toast({ title: "Gagal membatalkan", description: d.error, variant: "destructive" }); }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch {
      toast({ title: "Kamera tidak tersedia", description: "Absen tetap dilanjutkan tanpa foto wajah", variant: "destructive" });
      if (pendingLocRef.current && selfieDialog) {
        await doAbsen(selfieDialog.karyawanId, pendingLocRef.current.lat, pendingLocRef.current.lng, null);
        closeSelfie();
      }
    }
  };
  useEffect(() => { if (selfieDialog) startCamera(); /* eslint-disable-next-line */ }, [selfieDialog]);

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

  const openSelfie = async (id: number) => {
    try {
      const res = await fetch(`/api/kas/lembur/absensi/${id}`);
      if (res.ok) { const d = await res.json(); setSelfieView(d.selfieImage); }
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" />Absensi Lembur</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Tanggal:</span>
            <Input type="date" value={tglAbsen} onChange={e => setTglAbsen(e.target.value)} className="h-9 w-40" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tanggal terpilih: <b>{tgl(tglAbsen)}</b>
            {(() => { const d = new Date(tglAbsen + "T00:00:00").getDay(); return d !== 0 && d !== 6 ? <span className="text-amber-600"> — bukan hari Sabtu/Minggu</span> : null; })()}
            {" "}· klik <MapPin className="w-3.5 h-3.5 inline" /> <b>Absen</b>: sistem mengambil GPS perangkat lalu meminta <b>foto selfie</b>. Absensi langsung tersimpan ke riwayat; <b>fee diisi oleh bendahara</b>.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Karyawan</TableHead>
                <TableHead className="text-center">Status Absen</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Memuat...</TableCell></TableRow>}
              {!loading && karyawan.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Belum ada karyawan terdaftar. Hubungi bendahara.</TableCell></TableRow>
              )}
              {karyawan.map(k => {
                const rec = absensi.find(a => a.karyawanId === k.id && a.tanggal === tglAbsen);
                return (
                  <TableRow key={k.id}>
                    <td className="font-medium">{k.nama}</td>
                    <td className="text-center">
                      {rec ? (
                        <div className="flex flex-col items-center gap-1">
                          <Badge className="bg-green-600"><MapPin className="w-3 h-3 mr-1" />HADIR{rec.jarakMeter != null ? ` · ${rec.jarakMeter} m` : ""}</Badge>
                          {rec.hasSelfie && <Badge variant="outline" className="text-blue-600 border-blue-600"><Smile className="w-3 h-3 mr-1" />selfie ✓</Badge>}
                          {rec.fee != null
                            ? <Badge variant="outline" className="text-red-600 border-red-600">fee {fmt(rec.fee)}</Badge>
                            : <span className="text-xs text-muted-foreground">fee: menunggu bendahara</span>}
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => absen(k)}>
                          <MapPin className="w-4 h-4 mr-1.5" /> Absen
                        </Button>
                      )}
                    </td>
                    <td className="text-right">
                      {rec && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => batalAbsen(rec)}><Trash2 className="w-4 h-4" /></Button>}
                    </td>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
                    <td className="whitespace-nowrap text-sm">{tgl(a.tanggal)}</td>
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
                    <td className="text-right whitespace-nowrap">{a.fee != null ? <span className="text-red-600 font-semibold">{fmt(a.fee)}</span> : <span className="text-muted-foreground text-xs">diisi bendahara</span>}</td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog selfie saat absen */}
      <Dialog open={selfieDialog !== null} onOpenChange={open => { if (!open) closeSelfie(); }}>
        <DialogContent onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader><DialogTitle>Absen Lembur — Foto Wajah</DialogTitle></DialogHeader>
          {selfieDialog && (<>
            <p className="text-sm text-muted-foreground">
              Karyawan: <b>{selfieDialog.nama}</b> · GPS sudah terbaca. Ambil <b>foto selfie</b> untuk melengkapi absensi.
            </p>
            <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3]">
              <video ref={videoRef} className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} muted playsInline />
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
    </div>
  );
}
