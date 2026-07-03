import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Redirect /backup → /master?tab=backup
 * The full backup UI lives in the Master page's Backup tab.
 */
export default function Backup() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/master?tab=backup");
  }, []);
  return null;
}
