import { useState, useRef, useEffect, useCallback } from "react";
import { useCreateScanOut, useAddScanOutItem, getListScanOutQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { QrCode, Camera, Keyboard, CheckCircle2, Play, Square, Loader2, ArrowUpRight, Package } from "lucide-react";
import jsQR from "jsqr";
import { useQueryClient } from "@tanstack/react-query";

export default function ScanOutView() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const audioContextRef = useRef<AudioContext | null>(null);

  const [activeSession, setActiveSession] = useState<any>(null);
  const [scannedBoxes, setScannedBoxes] = useState<any[]>([]);

  const [scanMethod, setScanMethod] = useState<"camera" | "manual">("manual");
  const [manualInput, setManualInput] = useState("");
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const lastScanTime = useRef<number>(0);
  const lastProcessTime = useRef<number>(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to avoid stale closure in rAF loop
  const cameraRunning = useRef(false);
  const activeSessionRef = useRef<any>(null);

  const createScanOutMutation = useCreateScanOut();
  const addItemMutation = useAddScanOutItem();

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

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
      oscillator.type = success ? "sine" : "sawtooth";
      oscillator.frequency.setValueAtTime(success ? 880 : 250, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.15 : 0.3));
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.3);
    } catch (_) {}
  }, []);

  const handleStartSession = async () => {
    if (!user) return;
    try {
      const result = await createScanOutMutation.mutateAsync({ data: { userId: user.id } });
      setActiveSession(result);
      setScannedBoxes([]);
      if (scanMethod === "manual") setTimeout(() => inputRef.current?.focus(), 100);
    } catch {
      toast({ title: "Gagal memulai sesi", variant: "destructive" });
    }
  };

  const handleManualInput = (value: string) => {
    setManualInput(value);
    setIsScannerActive(true);
    if (scannerTimerRef.current) clearTimeout(scannerTimerRef.current);
    if (value.trim()) {
      scannerTimerRef.current = setTimeout(() => {
        setIsScannerActive(false);
        handleScanBox(value);
        setManualInput("");
        setTimeout(() => inputRef.current?.focus(), 50);
      }, 350);
    } else {
      setIsScannerActive(false);
    }
  };

  const handleScanBox = useCallback(async (qrData: string) => {
    const session = activeSessionRef.current;
    if (!session) return;
    const data = qrData.trim();
    if (!data) return;

    try {
      await addItemMutation.mutateAsync({ id: session.id, data: { qrData: data } });
      const snCount = data.split('\n').filter(l => l.trim()).length;
      setScannedBoxes(prev => [{
        id: Date.now(),
        count: snCount,
        preview: data.slice(0, 28),
        time: new Date()
      }, ...prev]);
      playBeep(true);
      setManualInput("");
      toast({ title: "Box berhasil discan", description: `${snCount} item ditandai keluar.` });
      if (scanMethod === "manual") inputRef.current?.focus();
    } catch (error: any) {
      playBeep(false);
      setManualInput("");
      setTimeout(() => inputRef.current?.focus(), 50);
      toast({
        title: "Scan gagal",
        description: error?.message || "QR tidak valid, box tidak ditemukan, atau sudah pernah dispatch.",
        variant: "destructive"
      });
    }
  }, [addItemMutation, playBeep, scanMethod, toast]);

  const handleCompleteSession = () => {
    setActiveSession(null);
    setScannedBoxes([]);
    stopCamera();
    queryClient.invalidateQueries({ queryKey: getListScanOutQueryKey() });
    toast({ title: "Sesi dispatch selesai" });
  };

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
          handleScanBox(code.data);
        }
      }
    }
    if (cameraRunning.current) {
      requestRef.current = requestAnimationFrame(tick);
    }
  }, [handleScanBox]);

  useEffect(() => {
    if (scanMethod === "camera" && activeSession) startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [scanMethod, activeSession]);

  return (
    <div className="grid gap-6 md:grid-cols-12">
      <div className="md:col-span-5 lg:col-span-4 space-y-6">
        <Card className="border-amber-500/30 shadow-sm">
          <CardHeader className="bg-amber-50/50 dark:bg-amber-950/20 border-b border-border/50">
            <CardTitle className="text-amber-700 dark:text-amber-500 flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5" /> Sesi Dispatch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {!activeSession ? (
              <Button
                onClick={handleStartSession}
                disabled={createScanOutMutation.isPending}
                className="w-full h-14 uppercase tracking-wide font-bold bg-amber-600 hover:bg-amber-700 text-white"
              >
                {createScanOutMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2" />}
                Mulai Dispatch
              </Button>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted/50 p-4 rounded-lg border border-border space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Dus Terdispatch</p>
                    <p className="text-3xl font-bold font-mono text-amber-600">{scannedBoxes.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Total Items</p>
                    <p className="text-xl font-bold">{scannedBoxes.reduce((acc, curr) => acc + curr.count, 0)}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleCompleteSession}
                  className="w-full h-12 uppercase tracking-wide font-bold"
                >
                  <Square className="w-5 h-5 mr-2 fill-current" />
                  Selesai Dispatch
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {activeSession && (
          <Card className="border-sidebar-border">
            <CardContent className="p-4">
              <div className="flex rounded-md shadow-sm">
                <Button variant={scanMethod === "manual" ? "default" : "outline"} className="flex-1 rounded-r-none h-12" onClick={() => setScanMethod("manual")}>
                  <Keyboard className="w-4 h-4 mr-2" /> Manual
                </Button>
                <Button variant={scanMethod === "camera" ? "default" : "outline"} className="flex-1 rounded-l-none h-12" onClick={() => setScanMethod("camera")}>
                  <Camera className="w-4 h-4 mr-2" /> Kamera
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
              Scan QR Code Dus
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 flex flex-col">
            {!activeSession ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                <Package className="w-24 h-24 mb-4 opacity-20" />
                <p className="text-lg text-center max-w-sm">Mulai sesi dispatch untuk scan dus keluar gudang.</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="p-4 border-b border-border/50 bg-amber-50/30 dark:bg-amber-950/10">
                  {scanMethod === "manual" ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <textarea
                          ref={inputRef}
                          rows={1}
                          placeholder="Arahkan scanner QR eksternal ke sini, lalu tahan di atas QR code pada dus..."
                          value={manualInput}
                          onChange={(e) => handleManualInput(e.target.value)}
                          className="w-full px-4 py-3 text-sm font-mono border border-input rounded-md bg-background resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-amber-400/60 transition-shadow"
                          style={{ height: "56px" }}
                          autoFocus
                        />
                        {isScannerActive && (
                          <div className="absolute right-3 top-3 flex items-center gap-1.5 text-amber-600 pointer-events-none">
                            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                            <span className="text-xs font-semibold">Membaca...</span>
                          </div>
                        )}
                        {addItemMutation.isPending && (
                          <div className="absolute right-3 top-3 flex items-center gap-1.5 text-emerald-600 pointer-events-none">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span className="text-xs font-semibold">Dispatch...</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground text-center">
                        Scanner akan otomatis dispatch setelah QR terbaca — atau klik tombol di bawah
                      </p>
                      <Button
                        type="button"
                        className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white font-bold uppercase tracking-wide"
                        disabled={!manualInput.trim() || addItemMutation.isPending}
                        onClick={() => {
                          if (scannerTimerRef.current) clearTimeout(scannerTimerRef.current);
                          handleScanBox(manualInput);
                          setManualInput("");
                          setTimeout(() => inputRef.current?.focus(), 50);
                        }}
                      >
                        <ArrowUpRight className="w-4 h-4 mr-2" />
                        Dispatch Manual
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative w-full max-w-md mx-auto bg-black rounded-lg overflow-hidden" style={{aspectRatio: '1/1'}}>
                        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
                        <canvas ref={canvasRef} className="hidden" />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="relative w-3/5 h-3/5">
                            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-amber-400 rounded-tl" />
                            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-amber-400 rounded-tr" />
                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-amber-400 rounded-bl" />
                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-amber-400 rounded-br" />
                            <div className="absolute inset-x-0 h-0.5 bg-amber-400/80 shadow-[0_0_6px_2px_rgba(251,191,36,0.7)] animate-[scanline_2s_ease-in-out_infinite]" />
                          </div>
                        </div>
                        {!isCameraActive && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-center text-muted-foreground">Arahkan kamera ke QR code pada dus</p>
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-auto p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                    Log Dispatch ({scannedBoxes.length} dus)
                  </h3>
                  <div className="space-y-3">
                    {scannedBoxes.length === 0 && (
                      <div className="text-center p-8 text-muted-foreground border-2 border-dashed border-border rounded-lg">
                        Menunggu scan dus
                      </div>
                    )}
                    {scannedBoxes.map((box) => (
                      <div key={box.id} className="flex items-center justify-between p-4 bg-card border border-border rounded-lg shadow-sm animate-in slide-in-from-left-2">
                        <div className="flex items-center gap-4">
                          <div className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 p-2 rounded-md">
                            <Package className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="font-semibold">{box.count} items</p>
                            <p className="text-xs text-muted-foreground font-mono">{box.preview}</p>
                          </div>
                        </div>
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      </div>
                    ))}
                  </div>
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
    </div>
  );
}
