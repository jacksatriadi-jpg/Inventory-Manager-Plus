import fs from "fs";
import { google } from "googleapis";
import { logger } from "./logger";

// Service Account auth — verified against Google Docs (2026-11-24):
// - SA CAN read files shared with its email (list/get/download + sheets read)
// - SA CANNOT CREATE FILES in personal My Drive (no storage quota — 403 storageQuotaExceeded)
//   Only shared drives (Workspace) or OAuth delegation allow SA uploads, so retur Drive
//   upload stays on OAuth. Never create/write files via SA in personal Gmail folders.

export const SHEETS_READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

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

let sheetsClientCache: any = null;

export async function getServiceAccountSheets(): Promise<any> {
  if (sheetsClientCache) return sheetsClientCache;
  const p = getSAKeyPath();
  if (!p) throw new Error("Service account key tidak valid atau tidak bisa dibaca (GOOGLE_SERVICE_ACCOUNT_KEY_PATH).");
  let email = "unknown";
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!j?.client_email || !j?.private_key || !j?.project_id) {
      throw new Error("missing client_email/private_key/project_id");
    }
    email = j.client_email;
  } catch (e: any) {
    throw new Error(`Service account key tidak valid: ${e?.message ?? e}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFilename: p,
    scopes: [SHEETS_READ_SCOPE],
  });
  sheetsClientCache = google.sheets({ version: "v4", auth: auth as any });
  logger.info({ email }, "Service Account: Sheets client initialized");
  return sheetsClientCache;
}
