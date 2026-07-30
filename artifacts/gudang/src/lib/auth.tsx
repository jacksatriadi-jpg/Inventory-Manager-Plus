import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "@workspace/api-client-react";

export type AppUser = User | { id: 0; username: string; role: "guest"; menuAccess?: string[]; createdAt: string };

interface AuthContextType {
  user: AppUser | null;
  token: string | null;
  login: (token: string, user: User) => void;
  loginAsGuest: () => void;
  logout: () => void;
  isLoading: boolean;
  isGuest: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("currentUser");
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch (e) {
        localStorage.removeItem("token");
        localStorage.removeItem("currentUser");
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("currentUser", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const loginAsGuest = () => {
    setToken(null);
    setUser({ id: 0, username: "Tamu", role: "guest", menuAccess: ["/dashboard", "/riwayat"], createdAt: new Date().toISOString() });
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginAsGuest, logout, isLoading, isGuest: user?.role === "guest" }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
