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

## ⚠️ TODO — Google Drive Backup Setup (Pending — Do On Termux)

The Google Drive auto-backup feature has been fully coded but requires the following steps
to be completed **on the Termux/server environment** before it will work.

**Production domain:** `https://app.gudangpemaron.my.id`

---

### Step 1 — Install Node packages (Termux shell)

```sh
# Make sure you are in the project directory first
cd ~/Inventory-Manager-Plus    # or wherever the repo lives in Termux

pnpm add googleapis --filter @workspace/api-server
```

> `googleapis` is pure JavaScript — no native bindings, fully compatible with Termux.

---

### Step 2 — Create a Google Cloud Project (free, any Gmail account)

1. Open **https://console.cloud.google.com** in a browser (phone or PC)
2. Create a new project → name it e.g. **"Inventory Backup"**
3. Left menu → **APIs & Services** → **Library** → search **Google Drive API** → **Enable**
4. Left menu → **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Under **Authorized redirect URIs**, add **exactly**:
   ```
   https://app.gudangpemaron.my.id/api/auto-backup/google/callback
   ```
7. Click **Create** → copy the **Client ID** and **Client Secret**

> ⚠️ If the redirect URI doesn't match exactly (including `https://`), Google will reject the OAuth flow.

---

### Step 3 — Set Environment Variables (Termux)

Termux doesn't have a "Secrets" panel — set env vars in a `.env` file at the project root:

```sh
# In the project root on Termux
cat >> .env << 'EOF'
GOOGLE_CLIENT_ID=paste_your_client_id_here
GOOGLE_CLIENT_SECRET=paste_your_client_secret_here
GOOGLE_REDIRECT_URI=https://app.gudangpemaron.my.id/api/auto-backup/google/callback
EOF
```

**Make sure your server loads `.env`** — check if the startup script already does `source .env` or uses `dotenv`. If not, add this before starting the API server:

```sh
export $(grep -v '^#' .env | xargs)
```

Or add all three lines directly to `~/.bashrc` / `~/.zshrc` to persist across Termux sessions:

```sh
echo 'export GOOGLE_CLIENT_ID="your_client_id"' >> ~/.bashrc
echo 'export GOOGLE_CLIENT_SECRET="your_client_secret"' >> ~/.bashrc
echo 'export GOOGLE_REDIRECT_URI="https://app.gudangpemaron.my.id/api/auto-backup/google/callback"' >> ~/.bashrc
source ~/.bashrc
```

---

### Step 4 — Rebuild and restart

```sh
pnpm run build
# Then restart your api-server process (e.g. with pm2 or tmux)
pm2 restart api-server   # if using pm2
# or
tmux send-keys -t api 'C-c' && pnpm --filter @workspace/api-server run start
```

---

### Step 5 — Connect the account in the UI

1. Open **https://app.gudangpemaron.my.id** and log in as **admin (master)**
2. Go to **Master** → **Backup** tab
3. In the **Auto Backup Terjadwal** card, find the **Google Drive** section
4. Click **Hubungkan Akun Google** — this opens Google's consent screen
5. Choose your Gmail account and approve access
6. After redirect, the connected Gmail address will appear in the card
7. Toggle **Upload ke Google Drive** → ON
8. Click **Simpan Jadwal**

---

### How It Works (After Setup)

- Every scheduled auto-backup and manual **"Jalankan Sekarang"** will:
  1. Save the file locally on the server under `backups/`
  2. Upload the same file to a folder named **"Inventory Backups"** in the connected Google Drive
- Drive upload failure (e.g. no internet) does **NOT** affect the local backup — it is always saved first
- Access tokens are refreshed automatically — no need to re-connect every day
- To switch Google accounts: click **Putuskan** → re-connect with the new account
- Backup files appear in **Google Drive → My Drive → Inventory Backups**

---

### Termux Compatibility Notes

| Concern | Status |
|---|---|
| `googleapis` npm package | ✅ Pure JS, no native bindings, works on Termux |
| File upload via `fs.createReadStream` | ✅ Standard Node.js — works on Termux |
| OAuth redirect (needs HTTPS) | ✅ Using `https://app.gudangpemaron.my.id` |
| Token storage (PostgreSQL) | ✅ Stored in DB — no keychain/credential manager needed |
| Auto token refresh | ✅ Handled in code, no OS-level scheduler needed |

---

### Files Changed For This Feature

- `artifacts/api-server/package.json` — added `googleapis`
- `artifacts/api-server/src/app.ts` — DB migration for `gdrive_*` columns in `backup_config`
- `artifacts/api-server/src/lib/google-drive.ts` — NEW: OAuth + Drive upload library
- `artifacts/api-server/src/lib/backup-scheduler.ts` — auto-upload after local save
- `artifacts/api-server/src/routes/backup.ts` — 4 new Google OAuth routes
- `artifacts/gudang/src/pages/master.tsx` — Google Drive UI section in BackupTab
