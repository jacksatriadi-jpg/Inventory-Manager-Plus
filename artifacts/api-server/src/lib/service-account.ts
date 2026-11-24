import fs from "fs";
import { google } from "googleapis";
import { logger } from "./logger";

// Service Account auth (Google Docs verified 2026-11-24):
// - SA can create/upload files in folders shared with its email (Editor)
// - SA-created files in shared folders are visible to the folder owner
// - SA has no storage quota of its own; files in the user's folder count against the user's quota
// - SA-owned files are deleted if the SA is deleted (critical for backup)
// - Ownership cannot be transferred to the SA (transfer fails)

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const SHEETS_READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

// Minimal client type so call sites stay duck-typed (googleapis typing is loose).
export interface DriveClient {
  files: {
    list(params: any): Promise<any>;
    create(params: any): Promise<any>;
    get(params: any, options?: any): Promise<any>;
    delete(params: any): Promise<any>;
  };
}
export interface SheetsClient {
  spreadsheets: {
    values: {
      get(params: any): Promise<any>;
    };
  };
}

function getSAKeyPath(): string | null {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!p || typeof p !== "string") return null;
  try {
    return fs.statSync(p).isFile() ? p : null;
  } catch {
    return null;
  }
}

export function isServiceAccountConfigured(): boolean {
  return getSAKeyPath() !== null;
}

let cachedEmail: string | null | undefined;
export function getServiceAccountEmail(): string | null {
  if (cachedEmail !== undefined) return cachedEmail;
  const p = getSAKeyPath();
  if (!p) return (cachedEmail = null);
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    cachedEmail = (typeof j?.client_email === "string" && j.client_email) || null;
  } catch {
    cachedEmail = null;
  }
  return cachedEmail ?? null;
}

let cachedKey: any = null;
function loadKey(): any | null {
  if (cachedKey) return cachedKey;
  const p = getSAKeyPath();
  if (!p) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!j?.client_email || !j?.private_key || !j?.project_id) return null;
    cachedKey = j;
    return j;
  } catch {
    return null;
  }
}

let driveClientCache: DriveClient | null = null;
let sheetsClientCache: SheetsClient | null = null;

export async function getServiceAccountDrive(): Promise<DriveClient> {
  if (driveClientCache) return driveClientCache;
  const key = loadKey();
  if (!key) throw new Error("Service account key tidak valid atau tidak bisa dibaca (GOOGLE_SERVICE_ACCOUNT_KEY_PATH).");
  const auth = new google.auth.GoogleAuth({
    keyFilename: getSAKeyPath() as string,
    scopes: [DRIVE_SCOPE],
  });
  driveClientCache = google.drive({ version: "v3", auth: auth as any }) as unknown as DriveClient;
  logger.info({ email: key.client_email }, "Service Account: Drive client initialized");
  return driveClientCache;
}

export async function getServiceAccountSheets(): Promise<SheetsClient> {
  if (sheetsClientCache) return sheetsClientCache;
  const key = loadKey();
  if (!key) throw new Error("Service account key tidak valid atau tidak bisa dibaca (GOOGLE_SERVICE_ACCOUNT_KEY_PATH).");
  const auth = new google.auth.GoogleAuth({
    keyFilename: getSAKeyPath() as string,
    scopes: [SHEETS_READ_SCOPE],
  });
  sheetsClientCache = google.sheets({ version: "v4", auth: auth as any }) as unknown as SheetsClient;
  logger.info({ email: key.client_email }, "Service Account: Sheets client initialized");
  return sheetsClientCache;
}

// Reset cache (used by tests / config reload)
export function resetServiceAccountCache(): void {
  cachedEmail = undefined;
  cachedKey = null;
  driveClientCache = null;
  sheetsClientCache = null;
}
