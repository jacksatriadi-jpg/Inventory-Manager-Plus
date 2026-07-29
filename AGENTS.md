# Inventory Manager Plus — Project Overview for AI Agents

## What It Is

Inventory management webapp for PT PLN (Indonesia's state electricity company) — manages MCB (Miniature Circuit Breaker) materials with barcode scanning, stock tracking, and material classification (garansi vs usul hapus).

## Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | React + TypeScript + Vite + shadcn/ui |
| **Backend** | Express 5 + TypeScript |
| **Database** | PostgreSQL (`master_db`) |
| **ORM** | Drizzle ORM |
| **Package manager** | pnpm workspaces |
| **Build** | esbuild (API), Vite (frontend) |
| **Deploy** | STB device (192.168.100.160) via screen session |

## Project Structure

```
Inventory-Manager-Plus/
├── artifacts/
│   ├── api-server/          # Express backend
│   │   ├── src/
│   │   │   ├── routes/      # API endpoints (one file per feature)
│   │   │   ├── lib/         # Google Drive, Google Sheets clients
│   │   │   └── index.ts     # Express app entry
│   │   └── build.mjs        # esbuild config
│   │
│   ├── gudang/              # React frontend
│   │   ├── src/
│   │   │   ├── pages/       # Feature pages (one file per page)
│   │   │   ├── components/  # shadcn/ui + custom components
│   │   │   ├── lib/         # auth, API client
│   │   │   └── App.tsx      # Router + layout
│   │   └── vite.config.ts
│   │
│   └── mockup-sandbox/      # Design experiments (not deployed)
│
├── lib/                      # Shared libraries
│   ├── db/                   # Drizzle schema + DB connection
│   │   └── src/schema/       # Table definitions (one file per entity)
│   ├── api-zod/              # Shared Zod validation schemas
│   ├── api-spec/             # OpenAPI spec
│   └── api-client-react/     # Generated React API hooks
│
└── scripts/                  # Utility scripts
```

## Key Pages & Their Routes

| Page | Frontend file | Backend route | Description |
|------|--------------|---------------|-------------|
| Dashboard | `dashboard.tsx` | `dashboard.ts` | Stock overview, Google Sheets stock fetch |
| Master | `master.tsx` | `materials.ts`, `users.ts` | Material master data, user management, spreadsheet config |
| Scan In | `scan-in.tsx` | `scanIn.ts` | Material incoming (barcode scan) |
| Scan Out | `scan-out.tsx` | `scanOut.ts` | Material outgoing (barcode scan) |
| Material Masuk | `material-masuk.tsx` | `materialMasuk.ts` | History of materials received |
| Material Keluar | `material-keluar.tsx` | `materialKeluar.ts` | History of materials dispatched |
| Material Bekas | `material-bekas.tsx` | `materialBekas.ts` | Used materials — auto-classify to garansi/usul_hapus by production year |
| Riwayat | `riwayat.tsx` | `history.ts` | Audit log / transaction history |
| Backup | `backup.tsx` | `backup.ts` | DB backup/restore, Google Drive integration |
| Barcode Tools | `barcode-tools.tsx` | — | QR code generator |

## Database Tables

| Table | Schema file | Purpose |
|-------|------------|---------|
| `materials` | `materials.ts` | Master material data (name, code, kategori, stock) |
| `users` | `users.ts` | User accounts |
| `material_bekas_garansi` | `materialBekas.ts` | Used materials under warranty (year > 2021) |
| `material_bekas_usul_hapus` | `materialBekas.ts` | Used materials proposed for disposal (year ≤ 2021) |
| `scan_sessions` | `scanSessions.ts` | Scan session tracking |
| `non_scan_sessions` | `nonScanSessions.ts` | Non-scan session tracking |

## Material Bekas Classification Logic

Serial Number format: 17-char prefix + 4-digit MMYY + suffix = 28 chars total.
- Extract MMYY from characters 18-21 (regex: `^.{17}(\d{4})`)
- Year > 2021 → `material_bekas_garansi`
- Year ≤ 2021 → `material_bekas_usul_hapus`

## Authentication

- Login endpoint: `POST /api/auth/login`
- Default admin: `admin` / `admin123`
- Password hash: SHA256(password + "gudang_salt_2024")
- JWT token in Authorization header

## Google Integrations

### Google Drive (Auto Backup)
- Endpoints: `/api/auto-backup/google/*`
- Requires: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- Scopes: `drive.file` + `userinfo.email`

### Google Sheets (Stock Sync)
- Endpoints: `/api/sheets/config`, `/api/sheets/stock`, `/api/sheets/diagnose`
- Reads Column C (material name) + Column J (stock) from row 9+
- Displayed as "Stock Excel" column on dashboard

## Deployment

See `stb-deploy-workflow` skill for the complete deploy process.

**Quick summary:**
1. Edit files locally → `git commit` → `git push origin update6`
2. STB: `git stash && git pull origin update6 && git stash pop`
3. Build frontend: `pnpm --filter @workspace/gudang run build` (requires Node 22 via NVM)
4. Restart: `screen -dmS webapp /usr/local/bin/start-webapp.sh`
5. Verify: `curl http://localhost:8080/` → HTTP 200

**Critical:** Frontend build is SEPARATE from API server build. `start-webapp.sh` only builds the API server.

## Conventions

- One route file per feature in `artifacts/api-server/src/routes/`
- One page file per feature in `artifacts/gudang/src/pages/`
- One schema file per entity in `lib/db/src/schema/`
- Branch: `update6`
- Indonesian language for UI text
