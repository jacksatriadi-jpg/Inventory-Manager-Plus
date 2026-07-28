import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { customFetch, useListMaterials } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ScanLine, PackageOpen, Trash2, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/library";
import * as XLSX from "xlsx";

interface GaransiRecord {
  id: number;
  serialNumber: string;
  materialName: string;
  tahun: number;
  bulan: number;
  userName: string | null;
  createdAt: string;
}

interface UsulHapusRecord {
  id: number;
  serialNumber: string;
  materialName: string;
  tahun: number;
  bulan: number;
  userName: string | null;
  createdAt: string;
}

interface ClassificationPreview {
  target: "garansi" | "usul_hapus";
  tahun: number;
  bulan: number;
  message: string;
}

function parseSN(sn: string): { tahun: number; bulan: number } | null {
  const match = sn.match(/(\d{4})\d[A-Za-z]/);
  if (!match) return null;

  const dateStr = match[1];
  const month = parseInt(dateStr.slice(0, 2));
  const yearShort = parseInt(dateStr.slice(2, 4));

  if (month < 1 || month > 12) return null;

  const year = yearShort < 50 ? 2000 + yearShort : 1900 + yearShort;

  return { tahun: year, bulan: month };
}

function classifySN(sn: string): { valid: boolean; reason?: string; target?: "garansi" | "usul_hapus"; tahun?: number; bulan?: number } {
  const parsed = parseSN(sn);
  if (!parsed) return { valid: false, reason: "Format SN tidak dikenali" };

  if (parsed.tahun > 2021) {
    return { valid: true, target: "garansi", tahun: parsed.tahun, bulan: parsed.bulan };
  }

  return { valid: true, target: "usul_hapus", tahun: parsed.tahun, bulan: parsed.bulan };
}

export default function MaterialBekas() {
  const { user } = useAuth();
  const { data: materials } = useListMaterials();

  // Filter only MCB materials
  const mcbMaterials = materials?.filter(
    (m) => m.name.toLowerCase().includes("mcb") || m.code.toLowerCase().includes("mcb")
  ) ?? [];

  // Tabs
  const [activeTab, setActiveTab] = useState<"scan" | "garansi" | "usul_hapus">("scan");

  // Scan tab state
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [manualSN, setManualSN] = useState<string>("");
  const [scanResult, setScanResult] = useState<{ target: string; message: string; record: any } | null>(null);
  const [scanError, setScanError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [autoClassification, setAutoClassification] = useState<ClassificationPreview | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  // Garansi & Usul Hapus state
  const [garansiRecords, setGaransiRecords] = useState<GaransiRecord[]>([]);
  const [usulHapusRecords, setUsulHapusRecords] = useState<UsulHapusRecord[]>([]);
  const [loadingGaransi, setLoadingGaransi] = useState(true);
  const [loadingUsulHapus, setLoadingUsulHapus] = useState(true);

  const fetchGaransi = useCallback(async () => {
    try {
      const data = await customFetch<GaransiRecord[]>("/api/material-bekas/garansi");
      setGaransiRecords(data);
    } catch {
      setGaransiRecords([]);
    } finally {
      setLoadingGaransi(false);
    }
  }, []);

  const fetchUsulHapus = useCallback(async () => {
    try {
      const data = await customFetch<UsulHapusRecord[]>("/api/material-bekas/usul-hapus");
      setUsulHapusRecords(data);
    } catch {
      setUsulHapusRecords([]);
    } finally {
      setLoadingUsulHapus(false);
    }
  }, []);

  useEffect(() => {
    fetchGaransi();
    fetchUsulHapus();
  }, [fetchGaransi, fetchUsulHapus]);

  // Auto-classify preview when SN reaches 28 characters
  useEffect(() => {
    const sn = manualSN.trim();
    if (sn.length === 28) {
      const result = classifySN(sn);
      if (result.valid && result.target) {
        const message = result.target === "garansi"
          ? `Tahun ${result.tahun} > 2021 → Material Garansi`
          : `Tahun ${result.tahun} ≤ 2021 → Material Usul Hapus`;
        setAutoClassification({
          target: result.target,
          tahun: result.tahun!,
          bulan: result.bulan!,
          message,
        });
      } else {
        setAutoClassification(null);
      }
    } else {
      setAutoClassification(null);
    }
  }, [manualSN]);

  // QR Scanner
  const startScanner = async () => {
    if (!videoRef.current) return;
    setIsScanning(true);
    setScanError("");
    setScanResult(null);

    try {
      const reader = new BrowserMultiFormatReader();
      codeReaderRef.current = reader;

      await reader.decodeFromVideoDevice(
        null,
        videoRef.current,
        (result, err) => {
          if (result) {
            handleScanResult(result.getText());
            stopScanner();
          }
          if (err && err.name !== "NotFoundException") {
            console.error("Scan error:", err);
          }
        }
      );
    } catch (err) {
      console.error("Failed to start scanner:", err);
      setScanError("Gagal mengakses kamera. Pastikan izin kamera diberikan.");
      setIsScanning(false);
    }
  };

  const stopScanner = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  };

  const handleScanResult = (text: string) => {
    setManualSN(text);
  };

  const submitScan = async () => {
    if (!selectedMaterialId) {
      setScanError("Pilih material MCB terlebih dahulu.");
      return;
    }

    const sn = manualSN.trim();
    if (!sn) {
      setScanError("Scan QR code atau masukkan serial number.");
      return;
    }

    if (!user) {
      setScanError("User tidak valid.");
      return;
    }

    const material = mcbMaterials.find((m) => m.id.toString() === selectedMaterialId);
    if (!material) {
      setScanError("Material tidak ditemukan.");
      return;
    }

    setIsSubmitting(true);
    setScanError("");
    setScanResult(null);

    try {
      const response = await fetch("/api/material-bekas/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serialNumber: sn,
          materialName: material.name,
          userId: user.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setScanError(data.error || "Gagal memproses scan.");
        return;
      }

      setScanResult(data);

      // Refresh lists
      if (data.target === "garansi") {
        fetchGaransi();
      } else {
        fetchUsulHapus();
      }

      // Reset SN only, keep selected material
      setManualSN("");
      setAutoClassification(null);
    } catch (err) {
      console.error(err);
      setScanError("Terjadi kesalahan saat memproses scan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export functions
  const exportGaransi = () => {
    const wsData = garansiRecords.map((r) => ({
      "Serial Number": r.serialNumber,
      "Material": r.materialName,
      "Tahun": r.tahun,
      "Bulan": r.bulan,
      "Diinput oleh": r.userName || "-",
      "Tanggal": new Date(r.createdAt).toLocaleString("id-ID"),
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Material Garansi");
    XLSX.writeFile(wb, `Material_Garansi_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportUsulHapus = () => {
    const wsData = usulHapusRecords.map((r) => ({
      "Serial Number": r.serialNumber,
      "Material": r.materialName,
      "Tahun": r.tahun,
      "Bulan": r.bulan,
      "Diinput oleh": r.userName || "-",
      "Tanggal": new Date(r.createdAt).toLocaleString("id-ID"),
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Material Usul Hapus");
    XLSX.writeFile(wb, `Material_Usul_Hapus_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Delete functions
  const deleteGaransi = async (id: number) => {
    if (!confirm("Hapus data ini dari Material Garansi?")) return;
    try {
      await customFetch(`/api/material-bekas/garansi/${id}`, { method: "DELETE" });
      fetchGaransi();
    } catch (err) {
      console.error(err);
      alert("Gagal menghapus data.");
    }
  };

  const deleteUsulHapus = async (id: number) => {
    if (!confirm("Hapus data ini dari Material Usul Hapus?")) return;
    try {
      await customFetch(`/api/material-bekas/usul-hapus/${id}`, { method: "DELETE" });
      fetchUsulHapus();
    } catch (err) {
      console.error(err);
      alert("Gagal menghapus data.");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <PackageOpen className="w-8 h-8 text-primary" />
            Material Bekas
          </h2>
          <p className="text-muted-foreground mt-1">
            Klasifikasi material bekas berdasarkan tahun produksi
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-14 mb-6">
          <TabsTrigger value="scan" className="text-sm font-semibold">
            <ScanLine className="w-4 h-4 mr-2" />
            Scan Material
          </TabsTrigger>
          <TabsTrigger value="garansi" className="text-sm font-semibold">
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Material Garansi
          </TabsTrigger>
          <TabsTrigger value="usul_hapus" className="text-sm font-semibold">
            <Trash2 className="w-4 h-4 mr-2" />
            Material Usul Hapus
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Scan Material (Layak Pakai) */}
        <TabsContent value="scan" className="mt-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanLine className="w-5 h-5" />
                Scan Material Bekas
              </CardTitle>
              <CardDescription>
                Pilih material MCB, lalu scan QR code atau masukkan serial number secara manual
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Material dropdown */}
              <div className="space-y-2">
                <Label>Pilih Material MCB</Label>
                <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih material MCB..." />
                  </SelectTrigger>
                  <SelectContent>
                    {mcbMaterials.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.name} ({m.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* QR Scanner */}
              <div className="space-y-2">
                <Label>Scan QR Code</Label>
                <div className="flex gap-2">
                  <Button
                    onClick={isScanning ? stopScanner : startScanner}
                    variant={isScanning ? "destructive" : "default"}
                    disabled={!selectedMaterialId}
                    className="flex-1"
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Stop Scanner
                      </>
                    ) : (
                      <>
                        <ScanLine className="w-4 h-4 mr-2" />
                        Buka Kamera
                      </>
                    )}
                  </Button>
                </div>
                {isScanning && (
                  <div className="relative rounded-lg overflow-hidden bg-black aspect-video max-w-md mx-auto">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      autoPlay
                      playsInline
                    />
                  </div>
                )}
              </div>

              {/* Manual input */}
              <div className="space-y-2">
                <Label>Atau masukkan Serial Number secara manual</Label>
                <Input
                  value={manualSN}
                  onChange={(e) => setManualSN(e.target.value)}
                  placeholder="Contoh: PLN0325000005402510222Z00630"
                />
                <p className="text-xs text-muted-foreground">
                  Panjang SN: {manualSN.length}/28 karakter
                </p>
              </div>

              {/* Auto classification preview */}
              {autoClassification && (
                <div
                  className={`p-4 rounded-lg border ${
                    autoClassification.target === "garansi"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-red-50 border-red-200 text-red-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {autoClassification.target === "garansi" ? (
                      <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {autoClassification.message}
                      </p>
                      <p className="text-sm opacity-80 mt-1">
                        Bulan {String(autoClassification.bulan).padStart(2, "0")} {autoClassification.tahun}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit button */}
              <Button
                onClick={submitScan}
                disabled={isSubmitting || !selectedMaterialId || !manualSN.trim() || manualSN.trim().length !== 28}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Memproses...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Proses Klasifikasi
                  </>
                )}
              </Button>

              {/* Result */}
              {scanResult && (
                <div
                  className={`p-4 rounded-lg border ${
                    scanResult.target === "garansi"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-red-50 border-red-200 text-red-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {scanResult.target === "garansi" ? (
                      <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold">{scanResult.message}</p>
                      <p className="text-sm opacity-80 mt-1">
                        Serial Number: {scanResult.record.serialNumber}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {scanError && (
                <div className="p-4 rounded-lg border bg-red-50 border-red-200 text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {scanError}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Material Garansi */}
        <TabsContent value="garansi" className="mt-0 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Material Garansi
              </h3>
              <p className="text-sm text-muted-foreground">
                Material dengan tahun produksi di atas 2021
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchGaransi}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportGaransi} disabled={garansiRecords.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-1" />
                Export Excel
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingGaransi ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : garansiRecords.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Belum ada data Material Garansi</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-semibold">Serial Number</th>
                        <th className="text-left p-3 font-semibold">Material</th>
                        <th className="text-center p-3 font-semibold">Tahun</th>
                        <th className="text-center p-3 font-semibold">Bulan</th>
                        <th className="text-left p-3 font-semibold">Diinput oleh</th>
                        <th className="text-left p-3 font-semibold">Tanggal</th>
                        <th className="text-center p-3 font-semibold w-20">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {garansiRecords.map((r) => (
                        <tr key={r.id} className="border-t hover:bg-muted/20">
                          <td className="p-3 font-mono text-xs">{r.serialNumber}</td>
                          <td className="p-3">{r.materialName}</td>
                          <td className="p-3 text-center">{r.tahun}</td>
                          <td className="p-3 text-center">{String(r.bulan).padStart(2, "0")}</td>
                          <td className="p-3">{r.userName || "-"}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString("id-ID")}
                          </td>
                          <td className="p-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteGaransi(r.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: Material Usul Hapus */}
        <TabsContent value="usul_hapus" className="mt-0 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                Material Usul Hapus
              </h3>
              <p className="text-sm text-muted-foreground">
                Material dengan tahun produksi 2021 ke bawah
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchUsulHapus}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={exportUsulHapus} disabled={usulHapusRecords.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-1" />
                Export Excel
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {loadingUsulHapus ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : usulHapusRecords.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Trash2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Belum ada data Material Usul Hapus</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-semibold">Serial Number</th>
                        <th className="text-left p-3 font-semibold">Material</th>
                        <th className="text-center p-3 font-semibold">Tahun</th>
                        <th className="text-center p-3 font-semibold">Bulan</th>
                        <th className="text-left p-3 font-semibold">Diinput oleh</th>
                        <th className="text-left p-3 font-semibold">Tanggal</th>
                        <th className="text-center p-3 font-semibold w-20">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usulHapusRecords.map((r) => (
                        <tr key={r.id} className="border-t hover:bg-muted/20">
                          <td className="p-3 font-mono text-xs">{r.serialNumber}</td>
                          <td className="p-3">{r.materialName}</td>
                          <td className="p-3 text-center">{r.tahun}</td>
                          <td className="p-3 text-center">{String(r.bulan).padStart(2, "0")}</td>
                          <td className="p-3">{r.userName || "-"}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString("id-ID")}
                          </td>
                          <td className="p-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteUsulHapus(r.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
