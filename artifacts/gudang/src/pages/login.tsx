import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { PackageOpen, Loader2, Eye } from "lucide-react";
import { shouldLandOnRetur } from "@/components/retur/shared";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { login, loginAsGuest } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const loginMutation = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast({ title: "Error", description: "Masukkan username dan password", variant: "destructive" });
      return;
    }
    loginMutation.mutate(
      { data: { username, password } },
      {
        onSuccess: (data) => {
          login(data.token, data.user);
          setLocation(shouldLandOnRetur(data.user) ? "/retur" : "/dashboard");
        },
        onError: () => {
          toast({ title: "Login gagal", description: "Username atau password salah", variant: "destructive" });
        },
      }
    );
  };

  const handleGuestLogin = () => {
    loginAsGuest();
    setLocation("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <Card className="w-full max-w-md border-primary/20 shadow-2xl relative z-10 bg-card/95 backdrop-blur">
        <CardHeader className="space-y-3 pb-6">
          <div className="flex justify-center mb-2">
            <div className="bg-primary/20 p-4 rounded-xl ring-1 ring-primary/30">
              <PackageOpen className="w-12 h-12 text-primary" />
            </div>
          </div>
          <div className="text-center space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight">Sistem Gudang Pemaron</CardTitle>
            <CardDescription className="text-sm uppercase tracking-widest font-mono text-muted-foreground font-semibold">
              Manajemen Stock Count Material
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs uppercase font-bold tracking-wider text-muted-foreground">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Operator ID"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-12 bg-background/50 border-input font-mono text-lg transition-colors focus:bg-background"
                disabled={loginMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase font-bold tracking-wider text-muted-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 bg-background/50 border-input font-mono text-lg transition-colors focus:bg-background"
                disabled={loginMutation.isPending}
              />
            </div>
            <Button
              type="submit"
              className="w-full h-12 text-lg font-semibold tracking-wide uppercase transition-all"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Authenticating...</>
              ) : "Login"}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-3 text-muted-foreground">atau</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-11 border-dashed border-muted-foreground/40 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-all gap-2"
            onClick={handleGuestLogin}
          >
            <Eye className="w-4 h-4" />
            <span>Masuk sebagai Tamu</span>
            <span className="text-xs opacity-50 font-normal">(baca saja)</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
