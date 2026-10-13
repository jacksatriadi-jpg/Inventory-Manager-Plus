import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MapPin, Smile, Clock } from "lucide-react";

interface AbsenRow {
  id: number; karyawanId: number; karyawan: string; tanggal: string;
  jarakMeter: number | null; hasSelfie: boolean; fee: number | null;
}

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const tgl = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function Absensi() {
  const [absensi, setAbsensi] = useState<AbsenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selfieView, setSelfieView] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/kas/lembur/absensi");
      if (res.ok) setAbsensi(await res.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

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
          <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" />Riwayat Absensi Lembur</CardTitle>
          <span className="text-xs text-muted-foreground">hanya melihat — tidak dapat mengubah</span>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-center text-muted-foreground py-6">Memuat...</p>
            : absensi.length === 0 ? <p className="text-center text-muted-foreground py-6">Belum ada absensi lembur.</p> : (
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
                    <td className="text-right whitespace-nowrap">{a.fee != null ? <span className="text-red-600 font-semibold">{fmt(a.fee)}</span> : <span className="text-muted-foreground text-xs">belum diinput</span>}</td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={selfieView !== null} onOpenChange={open => { if (!open) setSelfieView(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Foto Selfie Absensi Lembur</DialogTitle></DialogHeader>
          {selfieView ? <img src={selfieView} alt="selfie absensi" className="max-h-[70vh] mx-auto rounded" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
