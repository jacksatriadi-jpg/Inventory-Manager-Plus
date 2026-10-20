// Halaman "Retur Material": dokumen TUG10 + checklist dua tahap (pengawas → gudang).
// Tab via query ?tab= (pola master.tsx) dengan gating per peran:
//   buat       → semua retur user (pengawas)
//   verifikasi → gudang (menuAccess "retur:gudang" atau master)
//   riwayat    → gudang
//   pengaturan → master
// Tab yang tidak diizinkan / tidak ada → diarahkan ke default per peran (gudang→verifikasi, selain itu→buat).
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardCheck, History, PackageX, Settings, ShieldCheck } from "lucide-react";
import { isReturGudang, isReturUser } from "@/components/retur/shared";
import { BuatTab } from "@/components/retur/buat-tab";
import { VerifikasiTab } from "@/components/retur/verifikasi-tab";
import { RiwayatTab } from "@/components/retur/riwayat-tab";
import { PengaturanTab } from "@/components/retur/pengaturan-tab";

export default function Retur() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const gudang = isReturGudang(user);
  const master = user?.role === "master";

  const params = new URLSearchParams(search ?? "");
  const requested = params.get("tab");
  const dokParam = params.get("dok");
  const dok = dokParam && /^\d+$/.test(dokParam) ? Number(dokParam) : null;

  const allowed = [
    "buat",
    ...(gudang ? ["verifikasi", "riwayat"] : []),
    ...(master ? ["pengaturan"] : []),
  ];
  const defaultTab = gudang ? "verifikasi" : "buat";
  const tab = requested && allowed.includes(requested) ? requested : defaultTab;

  useEffect(() => {
    if ((search ?? "").includes("drive=connected")) {
      toast({ title: "Google Drive Retur terhubung ✅", description: "Akun Drive untuk modul retur siap dipakai." });
    }
  }, [search, toast]);

  // Tab tidak valid / tidak diizinkan → normalisasi URL ke default per peran.
  useEffect(() => {
    if (requested !== tab) {
      setLocation(`/retur?tab=${tab}${dok ? `&dok=${dok}` : ""}`, { replace: true });
    }
  }, [requested, tab, dok, setLocation]);

  if (!isReturUser(user)) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldCheck className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-xl font-bold">Akses Material Retur belum diberikan</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Minta administrator memberi akses menu "Material Retur" (atau kapabilitas "Retur — Petugas Gudang") melalui menu Master → Users.
        </p>
      </div>
    );
  }

  const cols = allowed.length === 4 ? "grid-cols-2 sm:grid-cols-4"
    : allowed.length === 3 ? "grid-cols-3"
    : "grid-cols-1";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <PackageX className="w-8 h-8 text-primary" />
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Material Retur</h2>
          <p className="text-muted-foreground mt-1">Dokumen TUG10 + pemeriksaan dua tahap: pengawas lalu verifikasi gudang.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(t) => setLocation(`/retur?tab=${t}`)} className="w-full">
        <TabsList className={`h-12 w-full max-w-2xl grid ${cols}`}>
          <TabsTrigger value="buat" className="text-sm sm:text-base">
            <ClipboardCheck className="w-4 h-4 mr-2" /> Buat Retur
          </TabsTrigger>
          {gudang && (
            <TabsTrigger value="verifikasi" className="text-sm sm:text-base">
              <ShieldCheck className="w-4 h-4 mr-2" /> Verifikasi
            </TabsTrigger>
          )}
          {gudang && (
            <TabsTrigger value="riwayat" className="text-sm sm:text-base">
              <History className="w-4 h-4 mr-2" /> Riwayat
            </TabsTrigger>
          )}
          {master && (
            <TabsTrigger value="pengaturan" className="text-sm sm:text-base">
              <Settings className="w-4 h-4 mr-2" /> Pengaturan
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="buat" className="mt-6">
          <BuatTab />
        </TabsContent>
        {gudang && (
          <TabsContent value="verifikasi" className="mt-6">
            <VerifikasiTab initialDok={tab === "verifikasi" ? dok : null} />
          </TabsContent>
        )}
        {gudang && (
          <TabsContent value="riwayat" className="mt-6">
            <RiwayatTab />
          </TabsContent>
        )}
        {master && (
          <TabsContent value="pengaturan" className="mt-6">
            <PengaturanTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
