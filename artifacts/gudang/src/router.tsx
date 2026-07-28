import { useAuth } from "@/lib/auth";
import { Redirect, Route, Switch } from "wouter";
import { Layout } from "@/components/layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Scan from "@/pages/scan";
import Riwayat from "@/pages/riwayat";
import Master from "@/pages/master";
import Backup from "@/pages/backup";
import MaterialMasuk from "@/pages/material-masuk";
import MaterialKeluar from "@/pages/material-keluar";
import BarcodeTools from "@/pages/barcode-tools";
import MaterialBekas from "@/pages/material-bekas";

function ProtectedRoute({ component: Component, roles = ["user", "master", "guest"] }: { component: any, roles?: string[] }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  
  if (!user) {
    return <Redirect to="/login" />;
  }

  if (!roles.includes(user.role)) {
    return <Redirect to="/dashboard" />;
  }

  return <Component />;
}

export default function AppRouter() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      <Route path="/:path*">
        <Layout>
          <Switch>
            <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} roles={["user", "master", "guest"]} />} />
            <Route path="/scan" component={() => <ProtectedRoute component={Scan} roles={["user", "master"]} />} />
            <Route path="/material-masuk" component={() => <ProtectedRoute component={MaterialMasuk} roles={["user", "master"]} />} />
            <Route path="/material-keluar" component={() => <ProtectedRoute component={MaterialKeluar} roles={["user", "master"]} />} />
            <Route path="/riwayat" component={() => <ProtectedRoute component={Riwayat} roles={["user", "master", "guest"]} />} />
            <Route path="/master" component={() => <ProtectedRoute component={Master} roles={["master"]} />} />
            <Route path="/master/:path*" component={() => <ProtectedRoute component={Master} roles={["master"]} />} />
            <Route path="/backup" component={() => <ProtectedRoute component={Backup} roles={["master"]} />} />
            <Route path="/barcode-tools" component={() => <ProtectedRoute component={BarcodeTools} roles={["user", "master"]} />} />
            <Route path="/material-bekas" component={() => <ProtectedRoute component={MaterialBekas} roles={["user", "master"]} />} />
            <Route>404 Not Found</Route>
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}
