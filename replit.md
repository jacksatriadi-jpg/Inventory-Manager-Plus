# Manajemen Inventori Gudang

Aplikasi manajemen inventori gudang berbasis web untuk melacak material masuk dan keluar menggunakan scan QR code / barcode.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/gudang run dev` — run the frontend (port 24430, preview at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- QR scanning: jsQR (camera), qrcode (generation)
- Export: jsPDF, xlsx

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/` — Drizzle table definitions (users, materials, scanSessions)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/gudang/src/pages/` — Frontend pages
- `artifacts/gudang/src/lib/auth-context.tsx` — Auth context + localStorage token management

## Architecture decisions

- Token auth via Base64-encoded payload (userId:username:timestamp) stored in localStorage — lightweight, no JWT library needed
- Password hashing via SHA256 + static salt (no bcrypt dependency in server)
- History endpoint builds records from scan_in (completed) + scan_out tables on the fly
- Serial numbers are globally unique across all scan sessions (UNIQUE constraint)
- QR code data for a box = all serial numbers joined by newline, used for scan-out matching

## Product

- **Login** — username/password with role-based access (master/user)
- **Dashboard** — total material in/out/stock, per-material stats, recent activity feed, filter by material
- **Scan Material** — Scan masuk (select material → scan serial numbers → generate QR) and Scan keluar (scan box QR)
- **Riwayat** — History of all scans, export to PDF/XLSX, print QR codes, master can delete records
- **Master** (master only) — Manage materials and users

## Default accounts

- `admin` / `admin123` — role: master
- `operator1` / `user123` — role: user

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always rebuild libs (`pnpm run typecheck:libs`) after schema changes before typechecking the API server
- The `LoginResponse` schema was renamed to `AuthResult` in openapi.yaml to avoid TS2308 collision with Orval-generated type names
- After installing new pnpm packages in the frontend artifact, restart the gudang workflow for Vite to pick them up cleanly

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## ⚠️ TODO — Google Drive Backup Setup (Pending — Do On Server)

The Google Drive auto-backup feature has been fully coded but requires the following steps
to be completed **on the Replit/server environment** before it will work.

### Step 1 — Install the googleapis package

Run this in the Replit shell:

```sh
pnpm add googleapis --filter @workspace/api-server
```

### Step 2 — Create a Google Cloud Project (free, any Gmail account)

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "Inventory Backup")
3. In the left menu → **APIs & Services** → **Library**
4. Search for **Google Drive API** → click **Enable**
5. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Under **Authorized redirect URIs**, add:
   ```
   https://<your-replit-app-domain>/api/auto-backup/google/callback
   ```
   (Replace `<your-replit-app-domain>` with your actual Replit domain, e.g. `myapp.replit.app`)
8. Click **Create** — copy the **Client ID** and **Client Secret**

### Step 3 — Set Environment Variables on Replit

In Replit → **Secrets** tab, add:

| Secret Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Paste your Client ID from Step 2 |
| `GOOGLE_CLIENT_SECRET` | Paste your Client Secret from Step 2 |
| `GOOGLE_REDIRECT_URI` | `https://<your-replit-app-domain>/api/auto-backup/google/callback` |

### Step 4 — Rebuild and restart

```sh
pnpm run build
```

Then restart the api-server workflow.

### Step 5 — Connect the account in the UI

1. Log in as **admin (master)**
2. Go to **Master** → **Backup** tab
3. In the **Auto Backup Terjadwal** card, find the **Google Drive** section
4. Click **Hubungkan Akun Google** → approve the Google consent screen
5. After redirect back, the connected Gmail address will appear
6. Toggle **Upload ke Google Drive** → ON
7. Click **Simpan Jadwal**

### How It Works (After Setup)

- Every scheduled auto-backup (and manual "Jalankan Sekarang") will:
  1. Save the file locally on the server under `backups/`
  2. Upload the same file to a folder named **"Inventory Backups"** in the connected Google Drive
- If Drive upload fails (e.g. network error), the local backup is still safely saved
- Tokens are refreshed automatically — no need to re-connect
- To switch accounts: click **Putuskan** → **Hubungkan** with a different Google account

### Files Changed For This Feature

- `artifacts/api-server/package.json` — added `googleapis`
- `artifacts/api-server/src/app.ts` — DB migration for `gdrive_*` columns
- `artifacts/api-server/src/lib/google-drive.ts` — NEW: OAuth + Drive upload library
- `artifacts/api-server/src/lib/backup-scheduler.ts` — auto-upload after local save
- `artifacts/api-server/src/routes/backup.ts` — 4 new Google OAuth routes
- `artifacts/gudang/src/pages/master.tsx` — Google Drive UI section in BackupTab
