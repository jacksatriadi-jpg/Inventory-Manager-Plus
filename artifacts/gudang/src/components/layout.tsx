import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ScanLine, History, Database, LogOut, UserCircle, DatabaseBackup, RefreshCw, PackagePlus, PackageMinus, Eye, QrCode, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const isGuest = user?.role === "guest";

  const menuItems = isGuest
    ? [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/riwayat", label: "Riwayat", icon: History },
      ]
    : [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/scan", label: "Scan Material", icon: ScanLine },
        { href: "/material-masuk", label: "Material Masuk", icon: PackagePlus },
        { href: "/material-keluar", label: "Material Keluar", icon: PackageMinus },
        { href: "/riwayat", label: "Riwayat", icon: History },
        { href: "/barcode-tools", label: "Barcode Tools", icon: QrCode },
        { href: "/material-bekas", label: "Material Bekas", icon: PackageOpen },
        ...(user?.role === "master" ? [
          { href: "/master", label: "Master", icon: Database },
          { href: "/master?tab=backup", label: "Backup & Restore", icon: DatabaseBackup },
        ] : []),
      ];

  const AccountMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center gap-2 h-9 px-3 hover:bg-sidebar-accent/20">
          <UserCircle className="w-5 h-5" />
          <span className="text-sm font-semibold max-w-[120px] truncate hidden sm:inline">{user?.username}</span>
          <RefreshCw className="w-3.5 h-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-semibold">{user?.username}</span>
          <span className="text-xs text-muted-foreground capitalize font-normal">{user?.role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer"
          onClick={logout}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Ganti Akun / Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground border-r flex flex-col hidden md:flex">
        <div className="p-4 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground flex items-center gap-3">
          <div className="bg-white text-sidebar-primary p-1.5 rounded text-xl font-bold font-mono">SGP</div>
          <div>
            <h1 className="font-bold leading-tight">Sistem Gudang </h1>
            <p className="text-xs opacity-80 uppercase tracking-widest">pemaron</p>
          </div>
        </div>
        {isGuest && (
          <div className="px-3 py-2 bg-amber-500/20 border-b border-amber-500/30 flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-300 font-medium">Mode Tamu — Baca Saja</span>
          </div>
        )}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {menuItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 mb-4">
            {isGuest
              ? <Eye className="w-8 h-8 text-amber-400/70" />
              : <UserCircle className="w-8 h-8 text-sidebar-accent-foreground opacity-70" />
            }
            <div>
              <p className="text-sm font-semibold">{user?.username}</p>
              <p className="text-xs text-sidebar-accent-foreground capitalize opacity-70">
                {isGuest ? "tamu" : user?.role}
              </p>
            </div>
          </div>
          <Button
            variant={isGuest ? "outline" : "destructive"}
            className={`w-full justify-start text-sm ${isGuest ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300" : ""}`}
            onClick={logout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            {isGuest ? "Keluar dari Mode Tamu" : "Keluar"}
          </Button>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden bg-sidebar text-sidebar-foreground border-b p-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground p-1 rounded font-bold font-mono text-sm">
              SGP
            </div>
            <span className="font-bold text-sm">SISTEM GUDANG PEMARON</span>
          </div>
          <AccountMenu />
        </header>

        {/* Desktop Top Bar */}
        <header className="hidden md:flex items-center justify-end px-6 py-2 border-b bg-card/50">
          <AccountMenu />
        </header>
        
        {/* Mobile Nav */}
        <div className="md:hidden flex overflow-x-auto border-b bg-card">
          {menuItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-2 px-4 py-3 whitespace-nowrap text-sm font-medium border-b-2 transition-colors ${
                  isActive 
                    ? "border-primary text-primary-foreground bg-primary/10" 
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/5"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
