import { useState, useRef, useEffect, useCallback } from "react";
import { useListMaterials, useCreateScanIn, useUpdateScanIn, useAddScanInItem, useDeleteScanInItem, useDeleteScanIn, getListScanInQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { QrCode, Trash2, Camera, Keyboard, CheckCircle2, Play, Square, Loader2, XCircle, Printer } from "lucide-react";
import { LabelPreviewDialog } from "@/components/label-preview-dialog";
import { type LabelData } from "@/lib/print-label";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { useQueryClient } from "@tanstack/react-query";

export default function ScanInView() {
  const { user, token } = useAuth();
  // Per-user session key so multiple users on same browser don't share sessions
  const SESSION_KEY = user ? `active_scan_in_session_id_${user.id}` : "active_scan_in_session_id";
  const [labelPreview, setLabelPreview] = useState<LabelData | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const audioContextRef = useRef<AudioContext | null>(null);

  const { data: materials, isLoading: isLoadingMaterials } = useListMaterials();
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");

  const [activeSession, setActiveSession] = useState<any>(null);
  const [scannedItems, setScannedItems] = useState<{id: number, serialNumber: string}[]>([]);
  const [generatedQr, setGeneratedQr] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

  const [scanMethod, setScanMethod] = useState<"camera" | "manual">("manual");
  const [manualInput, setManualInput] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const lastScanTime = useRef<number>(0);
  const lastProcessTime = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ref to avoid stale closure in rAF loop
  const cameraRunning = useRef(false);
  const activeSessionRef = useRef<any>(null);

  const createScanInMutation = useCreateScanIn();
  const updateScanInMutation = useUpdateScanIn();
  const deleteScanInMutation = useDeleteScanIn();
  const addItemMutation = useAddScanInItem();
  const deleteItemMutation = useDeleteScanInItem();

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY);
    if (!savedId || !token) {
      setIsRestoringSession(false);
      return;
    }
    fetch(`/api/scan-in/${savedId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(session => {
        if (session && session.status === "scanning") {
          setActiveSession(session);
          setScannedItems(session.items ?? []);
          toast({ title: "Sesi dilanjutkan", description: `Box ${session.boxLabel} — ${session.items?.length ?? 0} item tersimpan.` });
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      })
      .catch(() => localStorage.removeItem(SESSION_KEY))
      .finally(() => setIsRestoringSession(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const playBeep = useCallback((success = true) => {
    try {
      const ctx = getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(success ? 880 : 300, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.15);
    } catch (_) {}
  }, []);

  const handleStartSession = async () => {
    if (!selectedMaterialId || !user) return;
    try {
      const result = await createScanInMutation.mutateAsync({
        data: { materialId: parseInt(selectedMaterialId), userId: user.id }
      });
      setActiveSession(result);
      setScannedItems([]);
      setGeneratedQr(null);
      localStorage.setItem(SESSION_KEY, String(result.id));
      if (scanMethod === "manual") {
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch {
      toast({ title: "Gagal memulai sesi", variant: "destructive" });
    }
  };

  const handleScanItem = useCallback(async (serialNumber: string) => {
    const session = activeSessionRef.current;
    if (!session) return;
    const sn = serialNumber.trim();
    if (!sn) return;

    if (sn.length !== 28) {
      toast({ title: "Serial tidak valid", description: "Serial number harus tepat 28 karakter.", variant: "destructive" });
      playBeep(false);
      return;
    }

    setScannedItems(prev => {
      if (prev.some(item => item.serialNumber === sn)) {
        toast({ title: "Duplikat", description: "Serial ini sudah discan.", variant: "destructive" });
        playBeep(false);
        return prev;
      }
      return prev;
    });

    // check duplicate outside state setter for async flow
    try {
      const item = await addItemMutation.mutateAsync({ id: session.id, data: { serialNumber: sn } });
      setScannedItems(prev => {
        if (prev.some(i => i.serialNumber === sn)) return prev;
        return [item, ...prev];
      });
      playBeep(true);
      setManualInput("");
      if (scanMethod === "manual") inputRef.current?.focus();
    } catch (error: any) {
      playBeep(false);
      setManualInput("");
      if (scanMethod === "manual") inputRef.current?.focus();
      toast({ title: "Scan gagal", description: error?.message || "Gagal menambah item. Mungkin duplikat.", variant: "destructive" });
    }
  }, [addItemMutation, playBeep, scanMethod, toast]);

  const handleDeleteItem = async (itemId: number) => {
    if (!activeSession) return;
    try {
      await deleteItemMutation.mutateAsync({ id: activeSession.id, itemId });
      setScannedItems(prev => prev.filter(i => i.id !== itemId));
      toast({ title: "Item dihapus" });
    } catch {
      toast({ title: "Hapus gagal", variant: "destructive" });
    }
  };

  const handleCompleteSession = async () => {
    if (!activeSession) return;
    if (scannedItems.length === 0) {
      toast({ title: "Belum ada item", description: "Scan minimal 1 item sebelum selesai.", variant: "destructive" });
      return;
    }
    try {
      await updateScanInMutation.mutateAsync({ id: activeSession.id, data: { status: "completed" } });
      const qrText = scannedItems.map(i => i.serialNumber).join('\n');
      const qrDataUrl = await QRCode.toDataURL(qrText, { errorCorrectionLevel: 'M', margin: 2, width: 300 });
      setGeneratedQr(qrDataUrl);
      localStorage.removeItem(SESSION_KEY);
      queryClient.invalidateQueries({ queryKey: getListScanInQueryKey() });
      toast({ title: "Sesi selesai", description: `${scannedItems.length} item berhasil discan.` });
      stopCamera();
    } catch {
      toast({ title: "Gagal menyelesaikan", variant: "destructive" });
    }
  };

  const handleReset = () => {
    setActiveSession(null);
    setScannedItems([]);
    setGeneratedQr(null);
    setSelectedMaterialId("");
    localStorage.removeItem(SESSION_KEY);
    stopCamera();
  };

  const handleCancelSession = async () => {
    if (!activeSession) return;
    try {
      await deleteScanInMutation.mutateAsync({ id: activeSession.id });
      localStorage.removeItem(SESSION_KEY);
      queryClient.invalidateQueries({ queryKey: getListScanInQueryKey() });
      setActiveSession(null);
      setScannedItems([]);
      setGeneratedQr(null);
      setSelectedMaterialId("");
      stopCamera();
      toast({ title: "Sesi dibatalkan", description: "Semua item yang discan telah dihapus." });
    } catch {
      toast({ title: "Gagal membatalkan sesi", variant: "destructive" });
    } finally {
      setIsCancelConfirmOpen(false);
    }
  };

  // Camera: use ref-based flag to avoid stale closure in rAF loop
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: "Kamera tidak didukung", variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        }
      });
      // Enable continuous autofocus for close-up QR scanning
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] });
        } catch { /* not all browsers support this */ }
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play();
        cameraRunning.current = true;
        setIsCameraActive(true);
        requestRef.current = requestAnimationFrame(tick);
      }
    } catch {
      toast({ title: "Kamera Error", description: "Tidak bisa akses kamera. Cek izin kamera.", variant: "destructive" });
    }
  };

  const stopCamera = () => {
    cameraRunning.current = false;
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = undefined;
    }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const tick = useCallback(() => {
    if (!cameraRunning.current) return;
    const now = Date.now();
    if (
      videoRef.current &&
      canvasRef.current &&
      videoRef.current.readyState >= videoRef.current.HAVE_ENOUGH_DATA &&
      now - lastProcessTime.current >= 200
    ) {
      lastProcessTime.current = now;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Pass 1: raw frame — jsQR works best on unmodified images
        const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let code = jsQR(raw.data, raw.width, raw.height, { inversionAttempts: "attemptBoth" });
        // Pass 2: contrast-boosted fallback for blurry/dark frames
        if (!code) {
          const d = raw.data;
          for (let i = 0; i < d.length; i += 4) {
            const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v = Math.min(255, Math.max(0, (luma - 128) * 1.8 + 128));
            d[i] = d[i + 1] = d[i + 2] = v;
          }
          ctx.putImageData(raw, 0, 0);
          const boosted = ctx.getImageData(0, 0, canvas.width, canvas.height);
          code = jsQR(boosted.data, boosted.width, boosted.height, { inversionAttempts: "attemptBoth" });
        }
        if (code && now - lastScanTime.current > 1500) {
          lastScanTime.current = now;
          handleScanItem(code.data);
        }
      }
    }
    if (cameraRunning.current) {
      requestRef.current = requestAnimationFrame(tick);
    }
  }, [handleScanItem]);

  useEffect(() => {
    if (scanMethod === "camera" && activeSession && !generatedQr) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [scanMethod, activeSession, generatedQr]);

  if (isRestoringSession) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-muted-foreground gap-3">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Memuat sesi...</span>
      </div>
    );
  }

  if (generatedQr) {
    return (
      <>
      <Card className="border-emerald-500/30 bg-emerald-50/10 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto bg-emerald-100 text-emerald-600 w-16 h-16 flex items-center justify-center rounded-full mb-4">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <CardTitle className="text-2xl">Sesi Selesai</CardTitle>
          <p className="text-muted-foreground mt-2">
            Box Label: <strong className="text-foreground font-mono bg-muted px-2 py-1 rounded">{activeSession?.boxLabel}</strong>
          </p>
          <p className="text-muted-foreground">
            Total Items: <strong className="text-foreground">{scannedItems.length}</strong>
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-center pt-6">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-border">
            <img src={generatedQr} alt="Box QR Code" className="w-64 h-64 object-contain" />
          </div>
          <p className="text-sm text-center text-muted-foreground mt-6 max-w-sm">
            Print QR code ini dan tempelkan ke dus fisik. Berisi semua serial number item yang discan.
          </p>
        </CardContent>
        <CardFooter className="justify-center gap-3 pt-2 pb-6 flex-wrap">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              const w = window.open("", "_blank");
              if (w) {
                w.document.write(`<!DOCTYPE html><html><head><title>Print QR</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}img{max-width:100%;height:auto}@media print{body{margin:0}}</style></head><body><img src="${generatedQr}" onload="window.print();window.close()"/></body></html>`);
                w.document.close();
              }
            }}
          >
            <QrCode className="w-4 h-4" />
            Print QR
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              if (!activeSession) return;
              setLabelPreview({
                qrValue: activeSession.boxLabel,
                title: activeSession.boxLabel,
                materialName: activeSession.materialName,
                qty: `${scannedItems.length} item`,
                type: "Scan Masuk",
                date: format(new Date(), "dd MMM yyyy HH:mm"),
                operator: user?.username,
              });
            }}
          >
            <Printer className="w-4 h-4" />
            Cetak Label
          </Button>
          <Button onClick={handleReset} size="lg" className="px-8">Sesi Baru</Button>
        </CardFooter>
      </Card>

      <LabelPreviewDialog
        open={labelPreview !== null}
        onOpenChange={(open) => { if (!open) setLabelPreview(null); }}
        data={labelPreview}
      />
      </>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-12">
      <div className="md:col-span-5 lg:col-span-4 space-y-6">
        <Card className="border-primary/20 shadow-sm">
          <CardHeader>
            <CardTitle>Detail Sesi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!activeSession ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Pilih Material</label>
                  <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId} disabled={isLoadingMaterials}>
                    <SelectTrigger className="h-12 font-mono">
                      <SelectValue placeholder="Pilih Material..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-[50vh] overflow-y-auto">
                      {materials?.filter(m => (m as any).kategori === 'scan' || !(m as any).kategori).map(m => (
                        <SelectItem key={m.id} value={m.id.toString()}>{m.code} - {m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleStartSession}
                  disabled={!selectedMaterialId || createScanInMutation.isPending}
                  className="w-full h-12 uppercase tracking-wide font-bold"
                >
                  {createScanInMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2" />}
                  Mulai Scan
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted/50 p-4 rounded-lg border border-border space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Material</p>
                    <p className="font-mono font-medium">{activeSession.materialName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Box Label</p>
                    <p className="font-mono text-lg font-bold text-primary">{activeSession.boxLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Terscan</p>
                    <p className="text-2xl font-bold">{scannedItems.length} <span className="text-sm font-normal text-muted-foreground">items</span></p>
                  </div>
                </div>
                <Button
                  onClick={handleCompleteSession}
                  disabled={scannedItems.length === 0 || updateScanInMutation.isPending || deleteScanInMutation.isPending}
                  className="w-full h-12 uppercase tracking-wide font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {updateScanInMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Square className="w-5 h-5 mr-2 fill-current" />}
                  Selesaikan Box
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsCancelConfirmOpen(true)}
                  disabled={updateScanInMutation.isPending || deleteScanInMutation.isPending}
                  className="w-full h-10 text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                >
                  {deleteScanInMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />}
                  Batalkan Sesi
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {activeSession && (
          <Card className="border-sidebar-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Metode Input</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex rounded-md shadow-sm">
                <Button
                  variant={scanMethod === "manual" ? "default" : "outline"}
                  className="flex-1 rounded-r-none h-12"
                  onClick={() => setScanMethod("manual")}
                >
                  <Keyboard className="w-4 h-4 mr-2" />
                  Manual / USB
                </Button>
                <Button
                  variant={scanMethod === "camera" ? "default" : "outline"}
                  className="flex-1 rounded-l-none h-12"
                  onClick={() => setScanMethod("camera")}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Kamera
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="md:col-span-7 lg:col-span-8">
        <Card className="h-full min-h-[500px] flex flex-col border-sidebar-border shadow-sm">
          <CardHeader className="border-b border-border/50 pb-4 bg-muted/20">
            <CardTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5" />
              Area Scanner
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col">
            {!activeSession ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                <QrCode className="w-24 h-24 mb-4 opacity-20" />
                <p className="text-lg">Pilih material dan mulai sesi</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-border/50 bg-background sticky top-0 z-10">
                  {scanMethod === "manual" ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); handleScanItem(manualInput); }}
                      className="flex gap-2"
                    >
                      <Input
                        ref={inputRef}
                        placeholder="Scan atau ketik 28 karakter serial number..."
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        className="h-14 font-mono text-lg"
                        autoFocus
                      />
                      <Button type="submit" className="h-14 px-6" disabled={!manualInput || addItemMutation.isPending}>
                        Tambah
                      </Button>
                    </form>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative w-full max-w-md mx-auto bg-black rounded-lg overflow-hidden" style={{aspectRatio: '1/1'}}>
                        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
                        <canvas ref={canvasRef} className="hidden" />
                        {/* Corner guides */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="relative w-3/5 h-3/5">
                            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl" />
                            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr" />
                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl" />
                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br" />
                            {/* Scan line */}
                            <div className="absolute inset-x-0 h-0.5 bg-primary/80 shadow-[0_0_6px_2px_rgba(250,204,21,0.7)] animate-[scanline_2s_ease-in-out_infinite]" />
                          </div>
                        </div>
                        {!isCameraActive && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-center text-muted-foreground">Arahkan kamera ke QR code serial number</p>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-auto p-4 max-h-[400px]">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 sticky top-0 bg-card py-2">
                    Item Terscan ({scannedItems.length})
                  </h3>
                  {scannedItems.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
                      Siap scan item
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {scannedItems.map((item, index) => (
                        <div key={item.id} className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-md animate-in slide-in-from-left-2">
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground w-6 text-right text-xs font-mono">{scannedItems.length - index}.</span>
                            <span className="font-mono font-medium tracking-tight text-sm">{item.serialNumber}</span>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <style>{`
        @keyframes scanline {
          0% { top: 0; }
          50% { top: calc(100% - 2px); }
          100% { top: 0; }
        }
      `}</style>

      <AlertDialog open={isCancelConfirmOpen} onOpenChange={setIsCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan Sesi Scan?</AlertDialogTitle>
            <AlertDialogDescription>
              Sesi <strong className="font-mono">{activeSession?.boxLabel}</strong> akan dihapus beserta{" "}
              <strong>{scannedItems.length} item</strong> yang sudah discan. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteScanInMutation.isPending}>Kembali</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelSession}
              disabled={deleteScanInMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteScanInMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
