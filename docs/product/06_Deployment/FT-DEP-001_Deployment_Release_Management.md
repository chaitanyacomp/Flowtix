# FT ERP — Deployment & Release Management Standard

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-001 |
| **Title** | Deployment & Release Management Standard |
| **Version** | 1.14.2 |
| **Status** | Active — Operational Standard (Batches 1–11 + Milestones 2–4 commercial delivery) |
| **Effective date** | 2026-07-09 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture / Release Operations |
| **Audience** | Release managers, implementation partners, system administrators, product owners, support leads |
| **Classification** | Product — Deployment Operations Standard (LAN / Client-Server) |

**Parent / governing documents:**

- [Volume 9 — Deployment & Operations Architecture](../09_Deployment_and_Operations_Architecture/README.md) (FT-PD-090 – FT-PD-094)
- [FT-PD-090 — Deployment & Release Architecture](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)
- [FT-PD-091 — Installation, Upgrade & Migration Architecture](../09_Deployment_and_Operations_Architecture/Chapter_02_Installation_Upgrade_and_Migration_Architecture.md)
- [FT-PD-092 — Operational Monitoring, Support & Maintenance](../09_Deployment_and_Operations_Architecture/Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md)
- [FT-PD-093 — Backup, Recovery, BCP & DR](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)
- [FT-PD-103 — Documentation Governance](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md)
- [Volume 2 — Business Architecture](../02_Business_Architecture/README.md)
- [Volume 4 — Workflow Engine](../04_Workflow_Engine/README.md)
- [FT-PD-066 — UI/UX Design System](../06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md)
- [Change Policy](../release/CHANGE_POLICY.md)

**Authority relationship:**

| Layer | Role |
|-------|------|
| **Volume 9 (FT-PD-090+)** | Technology-neutral **architecture law** (DEP-*, INS-*, OPS-*, RES-*) |
| **FT-DEP-001 (this document)** | **Operational standard** for the approved LAN client-server deployment model — folder layout, packaging, backup, migration, update/rollback SOPs |
| **Implementation (`deployment/`)** | Committed scripts for Batches 1–11 + Milestone 2 + Milestone 3 (create-release, setup, WinSW, Inno installer, verify-install, firewall helper, static SPA hosting, install-validate, configure-env, db-safety, install-recovery, collect-diagnostics, certify-install). Source of tools lives under `deployment/`; release packages copy them to `tools/`. |

**Rule:** This document **implements** Volume 9 for the local-server / LAN model. It **SHALL NOT** override workflow semantics (Volume 4), business pipelines (Volume 2), data integrity (Volume 5), or UI architecture (Volume 6 / FT-PD-066). Deployment **consumes** certification ([DEP-01](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)) — it never replaces it.

---

## 1. Document Control

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-07-09 | FT ERP Product Team | Initial Deployment & Release Management Standard for LAN client-server deployments |
| 1.1.0 | 2026-07-09 | FT ERP Product Team | Batch 2 — runtime configuration, startup validation, logging, GET /health |
| 1.2.0 | 2026-07-09 | FT ERP Product Team | Batch 3 — esbuild backend bundling (`app/server.js`) |
| 1.3.0 | 2026-07-09 | FT ERP Product Team | Batch 4 — safe mysqldump backup automation (`tools/backup-db.*`) |
| 1.4.0 | 2026-07-09 | FT ERP Product Team | Batch 5 — Prisma `migrate deploy` with mandatory backup gate (`tools/migrate-db.*`) |
| 1.5.0 | 2026-07-09 | FT ERP Product Team | Batch 6 — one-click update orchestrator (`tools/update-flowtix.*`) |
| 1.6.0 | 2026-07-09 | FT ERP Product Team | Batch 7 — app/web rollback from pre-update archive (`tools/rollback-flowtix.*`) |
| 1.7.0 | 2026-07-09 | FT ERP Product Team | Batch 8 — optional WinSW Windows Service (`tools/service-*`) |
| 1.8.0 | 2026-07-09 | FT ERP Product Team | Batch 9 — client setup / bootstrap (`tools/setup-flowtix.*`) |
| 1.9.0 | 2026-07-09 | FT ERP Product Team | Batch 10 — Inno Setup Windows installer wrapper (`deployment/installer/`) |
| 1.10.0 | 2026-07-09 | FT ERP Product Team | Batch 11 — deployment validation & client handover pack (`handover/`, `verify-install`) |
| 1.11.0 | 2026-07-16 | FT ERP Product Team | Milestone 2 — backend static SPA hosting; verify UI+API; offline WinSW checksum; firewall helper; installer LAN URL policy; frontend `npm run build` gate |
| 1.12.0 | 2026-07-16 | FT ERP Product Team | Milestone 3 — installation hardening: env validation, guided configure-env, db-safety gate, WinSW recovery policy, install-recovery, safe uninstall, diagnostics, certify-install |
| 1.13.0 | 2026-07-17 | FT ERP Product Team | Milestone 4 — customer delivery media (`create-customer-media`), demo pack, customer guides + acceptance, checksums/manifest, branding About/support placeholders |
| 1.14.0 | 2026-07-17 | FT ERP Product Team | Hotfix — installer place-release self-wipe: skip archive refresh when `--source` is `{home}\releases\…`; promote `app`/`web` only; certify-install regression |
| 1.14.1 | 2026-07-18 | FT ERP Product Team | Hotfix — Inno `[Run]` invokes `post-install.bat` directly (cmd `/C` quoting dropped args); `existing_install` allows env-only first bootstrap; admin hard-fail only when service/firewall requested; full RCA + rebuild/certify docs synchronized |
| 1.14.2 | 2026-07-18 | FT ERP Product Team | Hotfix — packaged runtime: remove Tally `require.resolve` of source-relative modules; Control Tower Decimal via `prismaClientPackage` (not bare `@prisma/client`); `packagedRuntimeBundle` regression |
| 1.14.3 | 2026-07-18 | FT ERP Product Team | Deployment UAT — production leave/wastage integrity; Issue RM eligibility; Tally HSN inheritance; backup-db install-home; Admin Users + login messaging; BOM/RS refresh; Sales Bill bulk Tally; viewport/dispatch draft stability |

**Supersedes:** Informal client install notes; ad-hoc “copy the repo to the server” practices.

**Change authority:** Product Architecture + Release Operations. Material changes to packaging, backup, migration, or rollback rules require Architecture Review and alignment with Volume 9.

**Delivered in repository (do not treat as “future work”):**

- Batches 1–11 under `deployment/` (packaging, backup, migrate deploy, update, rollback, WinSW, setup, Inno wrapper, verify-install, handover)
- Milestone 2: production static hosting (`backend/src/runtime/staticHosting.js`), offline WinSW (`deployment/vendor/winsw/` + checksum), `firewall-flowtix.*`, installer URL/LAN notes
- Milestone 3: `install-validate.*`, `configure-env.*`, `db-safety.*`, `install-recovery.*`, `collect-diagnostics.*`, `certify-install.*`; hardened WinSW XML; Inno safe uninstall (preserve customer data by default)
- Milestone 4: `create-customer-media.*`, `certify-customer-media.*`, `deployment/demo/`, `docs/.../customer/` guides + acceptance, SHA256SUMS + RELEASE_MANIFEST

**Still deferred:**

- CI/CD pipelines for release media
- Docker / Kubernetes production topology
- Automated CLI DB restore (Admin UI restore exists separately)
- MSI / WiX (Inno Setup wrapper is the supported installer)
- Bundled MySQL product installer (MySQL remains operator-provided)

---

## 2. Purpose & Scope

### 2.1 Purpose

Define a **complete, professional, repeatable standard** for packaging, installing, updating, rolling back, and recovering FT ERP on a **customer LAN server PC** serving **2–10 concurrent browser users**.

Objectives:

- Separate **development** from **deployment**
- Ship **versioned release packages**, not source trees
- Protect **client data** and **product IP**
- Make every update **backup-first** and **rollback-ready**
- Preserve **certified product behavior** after every install or upgrade ([DEP-10](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md))

### 2.2 In scope

- LAN / local-server deployment model (primary)
- Frontend production build (React / Vite)
- Backend runtime packaging (Node / Express; **esbuild bundling planned later**)
- MySQL on the server PC
- Prisma migration governance
- Versioned release folders, update / rollback SOPs
- Logging, diagnostics, Windows Service roadmap
- Client installation, update, and disaster-recovery SOPs
- Release acceptance checklist

### 2.3 Out of scope

- Changing business calculations, workflow guards, or UI standards
- Multi-tenant SaaS / public-cloud topology (covered architecturally in FT-PD-090; not this SOP)
- Source-code delivery to customers as the default model
- Implementation of tools listed in §1 Out of scope

### 2.4 Normative language

Aligned with [FT-PD-066](../06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md) / Constitution convention:

| Term | Meaning |
|------|---------|
| **SHALL** / **MUST** | Mandatory |
| **SHALL NOT** / **MUST NOT** | Prohibited |
| **SHOULD** | Strong recommendation; deviation needs recorded exception |
| **MAY** | Optional |

---

## 3. Deployment Principles

| ID | Principle | Statement |
|----|-----------|-----------|
| **DRP-01** | Certified builds only | Production and pilot **SHALL** run only certified (or emergency-certified) builds ([DEP-01](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md), [DEP-08](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)). |
| **DRP-02** | Package ≠ repository | Clients receive a **release package**, never a developer working copy as the production tree. |
| **DRP-03** | Versioned releases | Every deployable unit has an immutable **product version** + **build identity**. |
| **DRP-04** | Backup before change | Every production update **SHALL** take a verified DB backup first ([DEP-03](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md), [RES-*](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)). |
| **DRP-05** | Rollback-ready | Previous release folder **SHALL** remain available until the new release is accepted. |
| **DRP-06** | Data over code | Client MySQL data, uploads, and `.env` **SHALL** outlive application folders. |
| **DRP-07** | Semantics unchanged by deploy | Install/upgrade **SHALL NOT** alter workflow or business rules except via the certified package contents ([DEP-10](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)). |
| **DRP-08** | Traceability | Who deployed what, when, from which package — recorded ([DEP-06](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)). |
| **DRP-09** | Operational independence | Customer admin **SHOULD** run day-2 ops without daily product engineering access. |
| **DRP-10** | IP protection | Source TypeScript/JS application trees **SHALL NOT** be the default client deliverable; prefer built artifacts (see §15). |

---

## 4. Development vs Deployment Separation

| Concern | Development (engineering) | Deployment (client server) |
|---------|---------------------------|----------------------------|
| **Location** | Developer / CI machines; git repository | Customer server PC under `C:\FT-ERP\` (or agreed root) |
| **Frontend** | Vite dev server / HMR | Static `dist/` from `vite build` |
| **Backend** | `node` / nodemon on `src/` | Production Node process on packaged `app/` (bundled later via esbuild) |
| **Database** | Local / shared dev MySQL; synthetic data | Authoritative client MySQL; never overwritten by package |
| **Secrets** | Local `.env` (not committed) | Server `.env` outside versioned release or in `shared/` — never replaced blindly |
| **Migrations** | Author in Prisma; test on validation DB | Apply only from release package via controlled SOP (§11) |
| **Hot reload** | Allowed | **Prohibited** in production |
| **Git** | Required | **Not required** on client server |
| **UI compliance** | FT-PD-066 during build | Deployed UI is the certified build; no on-site UI “tweaks” |

```mermaid
flowchart LR
  DEV[Dev repo + tests]
  CERT[Vol 8 certification]
  PKG[Release package]
  SRV[Client server releases/]
  DB[(Client MySQL)]

  DEV --> CERT
  CERT --> PKG
  PKG --> SRV
  SRV --> DB
```

**Rule:** Development tooling (Vite, test runners, source maps for debug, Cursor, etc.) **SHALL NOT** be prerequisites for client production runtime.

---

## 5. Recommended LAN Deployment Architecture

### 5.1 Topology (approved)

| Component | Placement | Notes |
|-----------|-----------|-------|
| **Server PC** | Factory office / IT room | Windows 10/11 or Windows Server; always-on preferred |
| **MySQL** | Same server PC (default) | Localhost; not exposed to internet |
| **FT ERP backend** | Same server PC | Listens on all interfaces; **PORT from `shared\.env` (default `4000`)** |
| **FT ERP frontend** | **Served by the Node/Express backend** from packaged `web/` (Vite production build) | SPA fallback for browser routes; `/api/*` unchanged. Reverse proxy optional later. |
| **Clients** | 2–10 PCs / tablets on LAN | Modern browser; URL `http://<server-hostname-or-IPv4>:<PORT>/` |
| **Internet** | Not required for core ERP | Optional for updates delivery / remote support; **not** required for WinSW when vendor binary is packaged |

### 5.2 Logical view

```mermaid
flowchart TB
  subgraph LAN["Customer LAN"]
    U1[Browser users 2-10]
    SRV[Server PC]
    subgraph SRVBOX["Server PC"]
      FE[Frontend dist]
      BE[Node Express API]
      MY[(MySQL)]
      LOG[logs/]
      BAK[backups/]
    end
    U1 -->|HTTP LAN| FE
    U1 -->|HTTP LAN| BE
    BE --> MY
    BE --> LOG
    BAK -.-> MY
  end
```

### 5.3 Capacity assumptions

| Item | Assumption |
|------|------------|
| Concurrent users | 2–10 |
| Sites | Single plant / single company (Phase 1) |
| HA / clustering | Not required for Phase 1 |
| RPO target (guidance) | Last verified backup (daily + pre-update) |
| RTO target (guidance) | Hours — restore backup + activate prior release folder |

Exact contractual RPO/RTO remain tenant-specific ([FT-PD-093](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)).

### 5.4 Network rules

- ERP ports **SHOULD** be reachable only on LAN / VPN.
- MySQL port **SHALL NOT** be exposed beyond localhost unless a documented exception exists.
- HTTPS termination **MAY** be added later (IIS / nginx / Caddy); Phase 1 **MAY** use HTTP on trusted LAN with recorded risk acceptance.
- **Firewall:** optional helper `tools\firewall-flowtix.bat` adds an idempotent inbound TCP rule named `Flowtix ERP Backend` for `PORT` from `shared\.env`. Manual `netsh` fallback remains documented. Setup/installer **MAY** invoke it via `--configure-firewall` / installer task.
- **URLs:** server shortcut **MAY** use `http://127.0.0.1:<PORT>/`. LAN clients **SHALL** use hostname or LAN IPv4 — never assume `127.0.0.1` on other PCs.

---

## 6. Standard Client Server Folder Structure

Canonical root (example): `C:\FT-ERP\`

```text
C:\FT-ERP\
├── current\                      # Junction / pointer to active release (optional)
│   └── → ..\releases\1.2.0\
├── releases\
│   ├── 1.1.0\                    # Prior release (keep for rollback)
│   │   ├── app\                  # Backend runtime (packaged)
│   │   ├── web\                  # Frontend dist
│   │   ├── prisma\               # schema + migrations shipped with release
│   │   ├── release.json          # Build identity manifest
│   │   └── RELEASE_NOTES.md
│   └── 1.2.0\                    # Active release
│       ├── app\
│       ├── web\
│       ├── prisma\
│       ├── release.json
│       └── RELEASE_NOTES.md
├── shared\
│   ├── .env                      # Secrets & connection strings (NOT inside release zip overwrite)
│   ├── uploads\                  # User/document files if stored on disk
│   └── config\                   # Optional non-secret site overrides
├── backups\
│   ├── db\
│   │   ├── pre-update_1.2.0_20260709_1830.sql
│   │   └── daily_20260709.sql
│   └── verify\                   # Optional restore-test notes
├── logs\
│   ├── app\                      # Application logs (by date)
│   ├── service\                  # Windows Service stdout/stderr (Batch 8 WinSW)
│   └── deploy\                   # Install/update/rollback records
├── service\                      # Optional WinSW wrapper (FlowtixERP.exe + .xml) — Batch 8
└── tools\                        # Admin helpers (Batch 4–8: backup, migrate, update, rollback, service; DB restore later)
```

### 6.1 Folder rules

| Rule | Statement |
|------|-----------|
| **F-01** | Each product version **SHALL** occupy its own `releases\<version>\` directory. |
| **F-02** | Updates **SHALL** add a new version folder; they **SHALL NOT** overwrite the previous folder in place. |
| **F-03** | `shared\.env`, `shared\uploads`, and `backups\` **SHALL** live outside version folders. |
| **F-04** | Activating a release **SHALL** be done by switching the process working directory / `current` junction / service path — not by deleting the old tree first. |
| **F-05** | At least **one prior** successful release folder **SHOULD** be retained; major sites **SHOULD** retain N-2. |
| **F-06** | Optional Windows Service files **SHALL** live under `<FT_ERP_HOME>\service\` (not inside a versioned release overwrite path for secrets). |

---

## 7. Versioning Strategy

### 7.1 Product version

Use **MAJOR.MINOR.PATCH** (aligned with [Change Policy](../release/CHANGE_POLICY.md) and FT-PD-090 §8):

| Segment | When to bump | Deploy impact |
|---------|--------------|---------------|
| **MAJOR** | Breaking architecture / Constitution-impacting | Full validation; enhanced rollback plan |
| **MINOR** | Features within architecture | Standard update SOP + post-update smoke |
| **PATCH** | Bug fixes / narrow hardening | Standard update SOP |

### 7.2 Build identity

Every package **SHALL** include `release.json` with at least:

| Field | Purpose |
|-------|---------|
| `productVersion` | e.g. `1.2.0` |
| `buildId` | Immutable id (git SHA or CI build number) |
| `builtAt` | ISO-8601 UTC |
| `frontendHash` | Optional content hash of `web/` |
| `backendHash` | Optional content hash of `app/` |
| `prismaMigrationHead` | Latest migration name included |
| `minCompatibleVersion` | Oldest version this package may upgrade from |
| `certificationRef` | Link/id to Vol. 8 cert record when available |

**Rule:** Folder name version and `release.json` `productVersion` **SHALL** match ([DEP-02](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)).

### 7.3 Compatibility declaration

Each release **SHALL** declare supported upgrade paths (e.g. `1.1.x → 1.2.0`). Skipping unsupported majors **SHALL** require a documented migration plan.

---

## 8. Release Workflow

End-to-end product → client flow (architecture + ops):

```mermaid
flowchart TB
  A[Feature complete on mainline]
  B[Automated tests + Vol 8 gates as applicable]
  C[Build frontend dist + package backend]
  D[Assemble release zip + release.json]
  E[Internal smoke on validation/pilot]
  F[Deliver package to client]
  G[Pre-update DB backup]
  H[Extract to releases/new]
  I[Apply Prisma migrations]
  J[Switch active release]
  K[Post-update acceptance]
  L[Retain prior release]

  A --> B --> C --> D --> E --> F --> G --> H --> I --> J --> K --> L
```

| Stage | Owner | Gate |
|-------|-------|------|
| Build & package | Product / Release | Clean build; manifest complete |
| Certification / scoped cert | Product + QA | [DEP-04](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md) |
| Delivery | Partner / Product | Package integrity (checksum) |
| Install / update | Customer Admin or Partner | Backup verified; freeze window if needed |
| Acceptance | Business Owner + Admin | §22 checklist |
| Record | Admin | `logs/deploy/` entry |

**Rule:** Failed post-update validation **SHALL** trigger rollback assessment before business resumes ([DEP-12](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)).

---

## 9. Build Package Standard

### 9.1 Package contents (logical)

A release package (zip) **SHALL** contain:

| Path | Content |
|------|---------|
| `web/` | Vite production build (`index.html`, assets) |
| `app/` | Backend runtime suitable for production Node (see §9.2) |
| `prisma/` | `schema.prisma` + `migrations/` required for this version |
| `release.json` | Build identity |
| `RELEASE_NOTES.md` | User-facing / admin notes |
| `CHECKSUMS.txt` | SHA-256 of package members (**SHOULD**) |

**SHALL NOT** include by default:

- Full git history
- `node_modules` from developer machines (install production deps in controlled build, or ship self-contained bundle)
- `.env` with secrets
- Dev-only tools, test fixtures with production-like PII
- Unbuilt TypeScript sources as the primary runtime (see §15)

### 9.2 Backend packaging phases

| Phase | Status | Approach |
|-------|--------|----------|
| **Phase A** | Superseded by Batch 3 | Raw `src/` copy (Batch 1 only) |
| **Phase B** | **Implemented (Batch 3)** | **esbuild** bundle → `app/server.js`; Prisma client on disk; `node_modules` installed on server |
| **Phase C** | Future | Windows Service + optional installer (§21) |

Batch 3 **SHALL** emit `app/server.js` under the same release folder contract. Raw `app/src/` **SHALL NOT** ship in Batch 3+ packages.

### 9.3 Frontend packaging

- **SHALL** use React/Vite **production** build only.
- Source maps in client packages: **SHOULD NOT** ship full sources; if maps are needed for support, ship under controlled support channel, not default LAN package.

### 9.4 Integrity

Before activation, admin **SHOULD** verify checksums. Tampered packages **SHALL NOT** be installed.

---

## 10. Database Backup Standard

Implements [FT-PD-093](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md) for the LAN model.

### 10.1 Mandatory backups

| Trigger | Requirement |
|---------|-------------|
| **Before every update** | Full logical dump of the production schema/database — **mandatory** |
| **Before every rollback that touches DB** | Fresh dump of current state — **mandatory** |
| **Daily (steady state)** | Automated or scheduled dump — **SHOULD** |
| **Before risky maintenance** | Dump — **SHOULD** |

### 10.2 Backup naming

Batch 4 operational dumps (primary):

```text
backups\db\flowtix-db-backup-vX.Y.Z-YYYYMMDD-HHMMSS.sql
```

Legacy / guidance aliases (still valid for manual naming):

```text
backups\db\pre-update_<targetVersion>_<YYYYMMDD_HHMM>.sql
backups\db\daily_<YYYYMMDD>.sql
backups\db\pre-rollback_<fromVersion>_<YYYYMMDD_HHMM>.sql
```

Manifest (Batch 4): `backups\db\BACKUP_MANIFEST.json` — append-only entries; **no passwords**.

### 10.3 Verification

| Step | Requirement |
|------|-------------|
| File non-empty | **SHALL** |
| Size sanity vs prior backup | **SHOULD** |
| Periodic restore test on non-prod | **SHOULD** (quarterly guidance) |
| Record path in deploy log | **SHALL** for pre-update backups |

### 10.4 Retention (guidance)

| Class | Retain |
|-------|--------|
| Pre-update | Until next successful update + 30 days minimum |
| Daily | 14–30 days |
| Month-end | 12 months (if policy requires) |

Customer policy may tighten; architecture minimum is **recoverability** ([RES-01](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)).

### 10.5 Scope of dump

Backup **SHALL** include operational data, masters, config-in-DB, and audit tables required for certified recovery. Disk `shared\uploads` **SHOULD** be copied or snapshotted on the same schedule when used.

---

## 11. Prisma Migration Standard

### 11.1 Principles

| ID | Rule |
|----|------|
| **MIG-01** | Schema changes ship **only** as Prisma migrations inside the release package. |
| **MIG-02** | Production **SHALL NOT** use `prisma db push` as the update path. |
| **MIG-03** | Migrations **SHALL** be applied **after** verified DB backup and **before** traffic is switched to the new app (or in a controlled freeze). |
| **MIG-04** | Migration set in the package **SHALL** match `release.json` `prismaMigrationHead`. |
| **MIG-05** | Failed migration **SHALL** stop the update; do not partially activate the new UI/API. |
| **MIG-06** | Historical integrity (WES / ledger) **SHALL** be preserved ([DEP-05](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)). |

### 11.2 Allowed and prohibited commands (Batch 5)

| Allowed (production) | Prohibited |
|----------------------|------------|
| `prisma migrate deploy` (Prisma **5.22.x**; local CLI or pinned `npx prisma@5.22.0`) | `prisma db push` |
| | `prisma migrate dev` |
| | `prisma migrate reset` / destructive reset |
| | `prisma db seed` / seed scripts as part of update |
| | Any ad-hoc DDL outside shipped migrations |
| | Unpinned Prisma 7+ CLI against shipped schema |

Tooling: `tools/migrate-db.bat` / `migrate-db.js` ([§30](#30-prisma-migration-automation-batch-5)).

### 11.3 Backup gate (Batch 5)

Before `migrate deploy`, operators **SHALL** have a **recent successful** dump recorded in `backups\db\BACKUP_MANIFEST.json` with on-disk size &gt; 0. If the gate fails, migration **SHALL** abort with:

```text
Run backup-db.bat before migrate-db.bat
```

Default freshness window: **60 minutes** (`MIGRATE_BACKUP_MAX_AGE_MINUTES`).

### 11.4 Update-time sequence

1. Stop accepting new writes (optional freeze / stop service).
2. Backup DB (§10 / `backup-db.bat`).
3. Extract new release folder.
4. Point migration tool at `shared\.env` / production `DATABASE_URL`.
5. Run **`migrate-db.bat`** → `prisma migrate deploy` only.
6. Confirm migration head / `MIGRATION_MANIFEST.json`.
7. Start new release process.
8. Smoke test (§22).

### 11.5 Rollback and migrations

- **App-only rollback** (no schema change between versions): switch `current` to prior release; DB unchanged.
- **Schema-forward migration already applied:** rolling back application code alone may be **unsafe**. Prefer:
  - restore DB from pre-update backup **and** activate prior release, **or**
  - ship a certified forward fix.
- Destructive down-migrations in production **SHALL NOT** be the default strategy.
- **Automated restore remains deferred** (later batch).

---

## 12. Update Strategy

### 12.1 Standard update (happy path)

Operator path (Batch 6 tooling — [§31](#31-update-orchestration-batch-6)):

1. Announce maintenance window (if users online).
2. Place new package under `releases\<newVersion>\` (do not delete old folders).
3. Run `tools\update-flowtix.bat` from the **new** package (or pass `--source`).
4. Confirm Current → Target version display.
5. Orchestrator runs **mandatory backup** then **migrate deploy**.
6. Orchestrator replaces **only** active `app/` and `web/` (archives prior copy under `releases\`).
7. Verify `/health` or file-level equivalent; review `logs\update.log`.
8. Start/restart process on the active path (service control deferred).
9. Run acceptance checklist (§22); keep prior release folders.

Manual equivalent (same order): backup → migrate → copy app/web only → smoke.

### 12.2 Update classes

| Class | Typical content | Extra care |
|-------|-----------------|------------|
| Patch | Bugfix | Short smoke |
| Minor | Features | Broader smoke + key workflows |
| Major | Architecture | Full pilot validation; DR dry-run **SHOULD** |

### 12.3 Forbidden update practices

- Editing production files by hand to “hotfix” without a package
- Copying developer `src/` over `releases\`
- Running uncertified builds on production ([DEP-08](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md))
- Skipping backup “because it is a small change”

---

## 13. Rollback Strategy

Implements [DEP-03](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md) / FT-PD-090 §10 for LAN.

### 13.1 Decision triggers

Rollback **SHOULD** be considered when:

- Service will not start
- Critical workflow smoke fails (login, create SO, stock read, etc.)
- Data corruption suspected post-migrate
- Business Owner rejects acceptance within the freeze window

### 13.2 Rollback modes

| Mode | When | Steps |
|------|------|-------|
| **A — Release switch (Batch 7)** | No schema change / compatible | Stop process → `tools\rollback-flowtix.bat` restores prior `app/`+`web/` from `releases\*-pre-update-*` → start → smoke ([§32](#32-rollback-automation-batch-7)) |
| **B — Release + DB restore** | Migrations applied or data suspect | Stop → **manual** restore of pre-update SQL (automation deferred) → activate prior app/web (Mode A) → smoke |
| **C — Forward fix** | Rollback cost high; fix available | Stay on version; apply certified patch ASAP |

**Batch 7 implements Mode A only.** Mode B DB restore remains operator-guided (print related backup filename; no automatic `mysql` restore).

### 13.3 Authority

Rollback authority **SHALL** be named before production update (Admin + Business Owner). Product/Partner advise; Customer owns go/no-go for live factory data.

### 13.4 Distinction

Rollback ≠ Disaster Recovery ([RES-11](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)). DR covers site loss / disk failure (§20).

---

## 14. Client Data Preservation Rules

| Asset | Location | Update behavior |
|-------|----------|-----------------|
| MySQL database | Server MySQL instance | **Never** replaced by package; migrate only |
| `.env` / secrets | `shared\.env` | **Never** overwritten by release zip without merge review |
| Uploads / attachments | `shared\uploads` | Preserved across releases |
| Backups | `backups\` | Preserved; not deleted by updater |
| Deploy logs | `logs\deploy\` | Append-only |
| Prior releases | `releases\<old>\` | Retained per §6 |

**Rules:**

- **DATA-01:** Package install **SHALL NOT** drop or recreate the client database.
- **DATA-02:** Seed scripts that wipe data **SHALL NOT** run on production.
- **DATA-03:** Production data **SHALL NOT** be copied to development without anonymization ([DEP-07](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)).
- **DATA-04:** Customer remains **data custodian**; Product/Partner access only under support agreement.

---

## 15. IP / Source Code Protection Strategy

Goal: clients receive a **runnable product**, not a convenient full source tree for redistribution.

| Measure | Phase | Notes |
|---------|-------|-------|
| Ship `web/` production assets only | Now (standard) | No React source in default package |
| Ship backend as packaged runtime | Phase A → B | Prefer esbuild bundle later |
| Exclude `.git`, tests, docs corpus from client zip | Now | Docs may ship separately as PDF if licensed |
| No default delivery of monorepo | Now | |
| License / use agreement | Commercial | Restrict reverse engineering / redistribution as contract allows |
| Access control on server | Ops | Limit who can read `C:\FT-ERP\` |
| Support channel for symbols | Optional | Source maps under NDA |

**Limits (honest):** JavaScript/Node deployments cannot provide perfect secrecy. Protection is **deterrence + contract + packaging hygiene**, not DRM. This standard **SHALL NOT** claim absolute IP safety.

**SHALL NOT:** Use obfuscation that breaks supportability or certification reproducibility without Architecture approval.

---

## 16. Windows Service Strategy

### 16.1 Phase 1 (manual / scheduled)

- Backend **MAY** run as a logged-in user process or Task Scheduler job at startup.
- Document restart procedure in `logs\deploy\` notes.
- **Still supported** after Batch 8 — service remains **optional**.

### 16.2 Phase 2 (Batch 8 — approved implementation)

Run FT ERP backend as an **optional Windows Service** using **WinSW** (Windows Service Wrapper).

| Option | Verdict |
|--------|---------|
| **WinSW** | **Selected** — single EXE + XML, shippable, restart policies, log rolling, no Node native addon |
| NSSM | Capable but less convenient to vendor/pin in release packages; GUI-centric ops |
| node-windows / native | Ties service to Node modules; harder to keep out of ERP runtime tree |
| Custom SCM wrapper | Higher cost; deferred |

**Architectural justification:** WinSW matches FT-DEP-001 folder rules (wrapper under `service\`, secrets stay in `shared\.env`), supports Automatic start + on-failure restart, and integrates cleanly with Batch 6/7 stop→replace→start without requiring the service on every site.

### 16.3 Service contract (Batch 8)

| Setting | Requirement |
|---------|-------------|
| Service id | `FlowtixERP` |
| Display name | `Flowtix ERP Backend` |
| Startup | Automatic |
| Failure restart | Restart after 5s / 10s / 30s (WinSW `onfailure`) |
| Executable | `node` + active `app\server.js` |
| Working directory | Active release `app\` |
| Environment | `FT_ERP_HOME`, `NODE_ENV=production`; app loads `shared\.env` |
| Logs | `logs\service\` (WinSW roll-by-size) |
| Optional | Sites **MAY** run without installing the service |

Tooling: `tools\service-install.bat` / `uninstall` / `start` / `stop` / `restart` / `status` ([§33](#33-windows-service-integration-batch-8)).

Update/rollback **SHALL** stop the service when present before file replace, and start it afterward when present. If not installed, they **SHALL** continue (no-op).

---

## 17. Logging & Diagnostics

Aligned with [FT-PD-092](../09_Deployment_and_Operations_Architecture/Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md).

### 17.1 Log classes

| Class | Path | Content |
|-------|------|---------|
| Application | `logs\app\` | API errors, auth failures, unexpected exceptions |
| Deploy | `logs\deploy\` | Install/update/rollback records, backup paths, versions |
| Service | `logs\service\` | WinSW stdout/stderr (Batch 8) |

### 17.2 Deploy log minimum fields

- Timestamp
- Actor (admin name)
- From version → to version
- Package `buildId`
- Backup file path
- Migration head before/after
- Result: success / rolled back / failed
- Notes

### 17.3 Diagnostics pack (support)

When escalating, Admin **SHOULD** provide:

- `release.json` of active version
- Recent `logs\app\` excerpt (no secrets)
- Deploy log entry
- Confirmation backup exists
- Screenshot of error (UI per FT-PD-066 — do not redesign for logs)

**SHALL NOT** paste full `.env` into tickets.

---

## 18. Client Installation SOP

**First-time install** (pilot/production path — [INS-*](../09_Deployment_and_Operations_Architecture/Chapter_02_Installation_Upgrade_and_Migration_Architecture.md)):

Preferred tooling (Batch 9 — [§34](#34-client-setup-bootstrap-batch-9)):

```text
tools\check-prereqs.bat --home C:\FT-ERP
REM create shared\.env from shared\.env.example (never commit secrets)
tools\setup-flowtix.bat --home C:\FT-ERP --source <releasePackage> --yes
REM Path B (folders/env/app only): add --skip-migrate
```

Manual equivalent:

1. **Prepare server** — Windows updates, disk space, static LAN IP recommended.
2. **Install MySQL** — local instance; create empty database + user with least privilege.
3. **Create folder tree** — §6 (`releases`, `shared`, `backups`, `logs`) via `init-folders` or setup.
4. **Place secrets** — create `shared\.env` (`DATABASE_URL`, JWT secrets, ports, etc.). **Never** overwrite an existing `.env` with the package.
5. **Extract / place release** — certified package into home + `releases\<version>\`.
6. **Path A (default):** backup → `prisma migrate deploy` → baseline backup.
7. **Path B:** `--skip-migrate` when DB work is deferred.
8. **Optional service** — Batch 8 `service-install` (Administrator); not required.
9. **Start backend** — service or `node app\server.js`; confirm `/health` / login.
10. **Client browsers** — `http://<server-ip>:<port>`; FT-PD-066 surfaces.
11. **Admin provisioning** — users/roles per Volume 7.
12. **Record** — `logs\setup.log` / `SETUP_MANIFEST.json` + go-live acceptance.
13. **Train** — Dashboard / Workspace / Reports per Volume 6.

**Firewall:** allow LAN clients to app port only.

**SHALL NOT:** wipe production DB; embed secrets in setup scripts; require MSI for Batch 9.

---

## 19. Update SOP

Condensed runbook (see also §12):

| Step | Action | Exit criteria |
|------|--------|---------------|
| 1 | Notify users / freeze if needed | Users informed |
| 2 | Verify package + compatibility | `release.json` OK |
| 3 | Backup DB (+ uploads if needed) | File verified |
| 4 | Stop service/process | Port free |
| 5 | Extract new version folder | Path exists; old retained |
| 6 | Migrate DB | Head matches manifest |
| 7 | Start new version | Health OK |
| 8 | Acceptance checklist §22 | Signed or recorded |
| 9 | Deploy log | Complete |
| 10 | Keep prior release | Rollback possible |

**Abort:** On any failure at steps 6–8, execute §13 before declaring success.

---

## 20. Disaster Recovery SOP

For major loss (disk failure, ransomware, site outage) — distinct from update rollback.

### 20.1 Recovery objectives (guidance)

Restore **certified operational capability**: known `release.json` build + consistent DB + `shared` assets ([RES-01](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)).

### 20.2 Recovery steps

1. Provision replacement Windows host (or repair).
2. Reinstall MySQL; restore latest **verified** SQL backup.
3. Restore `C:\FT-ERP\shared\` (env, uploads) from file backup / copy.
4. Restore last known good `releases\<version>\` (or re-extract same `buildId` package).
5. Start service; verify build identity.
6. Post-recovery validation — login, read stock, open key documents; spot-check audit.
7. Record DR event; schedule root-cause and backup-process review.

### 20.3 Business continuity

During outage, factory **MAY** use paper/manual temporary process; catch-up entries **SHALL** follow workflow rules (no silent ledger edits) when system returns.

---

## 21. Future Windows Installer Roadmap

| Stage | Deliverable | Depends on |
|-------|-------------|------------|
| **R0** | This standard (FT-DEP-001) | Done in documentation |
| **R1** | Release packaging scripts (frontend build + backend package + zip + checksum) | Explicit implementation task |
| **R2** | esbuild backend bundle in `app/` | R1 |
| **R3** | Windows Service wrapper + install notes | R1–R2 |
| **R4** | Guided installer (Inno Setup) — wraps Batches 1–9 | **Batch 10** |
| **R5** | Optional auto-update agent (LAN share / signed packages) | R4 + security review |

**Rules for installer (Batch 10):**

- **SHALL** implement §6 folder layout via Batch 9 setup
- **SHALL** refuse destructive re-bootstrap of existing installs (redirect to Batch 6 update)
- **SHALL NOT** embed customer secrets in the installer binary
- **SHALL** leave prior release / data folders for rollback
- **SHALL NOT** install MySQL Server or wipe the database on uninstall by default
- Digital code signing **MAY** be applied; not required to build

---

## 22. Release Acceptance Checklist

Use after **install** or **update** before declaring production success.

**Expanded pack (Batch 11):** Printable checklists, templates, runbook, and compatibility matrix live under [`handover/`](./handover/README.md) (also shipped as `docs/handover/` in the release package). This section remains the **normative minimum**; the handover pack is the operator-facing expansion (FT-DEP-011 … FT-DEP-013).

| Activity | Handover artifact |
|----------|-------------------|
| Production readiness gate | [FT-DEP-011](./handover/FT-DEP-011_Production_Readiness.md) |
| End-to-end deploy | [01_Production_Deployment](./handover/checklists/01_Production_Deployment.md) |
| Install verify | [02_Installation_Verification](./handover/checklists/02_Installation_Verification.md) |
| Functional smoke | [03_Post_Install_Smoke](./handover/checklists/03_Post_Install_Smoke.md) |
| Backup / update / rollback / service | [04](./handover/checklists/04_Backup_Verification.md)–[07](./handover/checklists/07_Windows_Service_Verification.md) |
| Business acceptance / handover | [08](./handover/checklists/08_Client_Acceptance.md)–[09](./handover/checklists/09_Client_Handover.md) |
| Sign-off / report / escalation | [templates/](./handover/templates/) |
| Day-2 ops | [FT-DEP-012 Runbook](./handover/FT-DEP-012_Administrator_Runbook.md) |
| Compatibility | [FT-DEP-013](./handover/FT-DEP-013_Version_Compatibility_Matrix.md) |
| Optional read-only probe | `tools\verify-install.bat --home <FT_ERP_HOME>` (§36.3) |

### 22.1 Technical

- [ ] `VERSION.txt` / release folder version matches intended release
- [ ] Backend process running; LAN URL reachable
- [ ] Frontend loads (no Vite dev server)
- [ ] DB migration head matches package / manifest
- [ ] Pre-change backup path recorded and file verified
- [ ] Prior release folder still present (updates)
- [ ] `shared\.env` intact (not blanked)
- [ ] Logs writable under `logs\`
- [ ] Optional: `verify-install` PASS (or WARN only for offline `/health`)

### 22.2 Functional smoke (minimum)

- [ ] Login / session works for Admin
- [ ] Dashboard or home shell loads (FT-PD-066)
- [ ] Open one master (e.g. Item or Customer) read-only
- [ ] Open one operational workspace relevant to site (SO / WO / Stock — as licensed)
- [ ] One Analysis report opens if Reports licensed
- [ ] No obvious API 500 on home navigation

### 22.3 Governance

- [ ] Deploy log / [Deployment Report](./handover/templates/Deployment_Report.md) completed
- [ ] Business Owner informed of result
- [ ] If fail → rollback mode chosen (§13) and executed
- [ ] No uncertified hotfix left on server
- [ ] [Release Sign-off](./handover/templates/Release_Signoff.md) recorded (INS-06)

### 22.4 Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| System Administrator | | | Pass / Fail |
| Business Owner | | | Accept / Reject |
| Partner (if present) | | | Witness |

---

## 23. Business Rules Summary (FT-DEP)

| ID | Rule |
|----|------|
| **DRP-01…10** | See §3 |
| **F-01…05** | See §6 |
| **MIG-01…06** | See §11 |
| **DATA-01…04** | See §14 |
| **DEP-*** | Inherited from FT-PD-090 — remain authoritative |
| **INS-*** | Inherited from FT-PD-091 |
| **RES-*** | Inherited from FT-PD-093 |

---

## 24. Deferred Implementation Tasks

Explicitly **not** done in this documentation revision:

| # | Task | Blocked until |
|---|------|---------------|
| 1 | Add npm/pnpm release scripts in `package.json` | Product approval to implement R1 |
| 2 | esbuild backend bundle pipeline | R1 complete |
| 3 | Backup PowerShell/bash helpers under `tools/` | R1 |
| 4 | Windows Service wrapper | R2–R3 |
| 5 | Windows Installer project | R4 |
| 6 | Automated checksum + `release.json` generator | R1 |
| 7 | Update Architecture Map / product README index entry for `06_Deployment/` | Optional doc navigation follow-up |
| 8 | Cross-link Volume 9 chapters to FT-DEP-001 as “LAN operationalization” | Doc patch |

---

## 25. Related Reading

| Topic | Document |
|-------|----------|
| Deployment architecture law | [FT-PD-090](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md) |
| Install / upgrade architecture | [FT-PD-091](../09_Deployment_and_Operations_Architecture/Chapter_02_Installation_Upgrade_and_Migration_Architecture.md) |
| Monitoring / support | [FT-PD-092](../09_Deployment_and_Operations_Architecture/Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md) |
| Backup / DR architecture | [FT-PD-093](../09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md) |
| Documentation governance | [FT-PD-103](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md) |
| Workflow unchanged by deploy | [Volume 4](../04_Workflow_Engine/README.md) |
| Business pipelines unchanged by deploy | [Volume 2](../02_Business_Architecture/README.md) |
| UI standard for smoke surfaces | [FT-PD-066](../06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md) |

---

## 26. Approval Block

| Role | Status |
|------|--------|
| Product Architecture | Pending review |
| Release Operations | Pending review |
| Documentation Steward | Pending review |

**Status:** Draft — Architecture Review (v1.10.0). Batches 1–11 (through handover pack + read-only verify-install) are documented; automated DB restore, MSI/WiX, and auto-update agent (R5) remain deferred.

---

## 27. Runtime Configuration (Batch 2)

### 27.1 Purpose

Separate **development** from **deployment** at process start: load secrets from `shared/.env`, ensure runtime folders, validate required configuration, initialize production logs, and expose a non-sensitive health endpoint.

### 27.2 Environment variable catalog

| Variable | Required | Environments | Description |
|----------|----------|--------------|-------------|
| `DATABASE_URL` | **Yes** | All | MySQL URL `mysql://user:pass@host:port/db` |
| `JWT_SECRET` | **Yes** | Production | Token signing secret (≥ 16 characters) |
| `NODE_ENV` | Recommended | All | `development` \| `production` \| `test` |
| `PORT` | No (default 4000) | All | HTTP listen port |
| `FT_ERP_HOME` | Recommended (LAN) | Production | Client install root (`shared/`, `logs/`, `releases/`) |
| `SHARED_DIR` | No | All | Override shared data directory |
| `LOG_DIR` | No | All | Override log directory |
| `VERSION_FILE` | No | All | Explicit path to Batch 1 `VERSION.txt` |
| `BRANDING_STORAGE_DIR` | No | All | Company logo/signature disk root |
| `BACKUP_STORAGE_DIR` | No | All | Admin backup storage root |
| `MYSQLDUMP_PATH` / `MYSQL_PATH` | No | All | mysqldump/mysql binaries for backup UI |
| `FEATURE_MONTHLY_PLANNING` | No | All | Feature flag (default OFF) |
| `FEATURE_PLANNING_DRIVEN_PROCUREMENT` | No | All | Feature flag (default OFF) |

**Template file:** `deployment/production.env.example` → copy to `shared/.env` on the server.

**Load order:** process environment (highest) → `shared/.env` → package `backend/.env` / `app/.env` (neither overrides already-set vars).

### 27.3 Runtime folder standard

| Path | Purpose | Auto-create |
|------|---------|-------------|
| `shared/` | Client secrets and durable files | Yes |
| `shared/.env` | Secrets (admin-created; not auto-written) | No |
| `shared/uploads/` | Disk uploads (when used) | Yes |
| `shared/temp/` | Temporary files | Yes |
| `logs/` | `startup.log`, `application.log`, `error.log` | Yes |

Layout detection:

1. `FT_ERP_HOME` set → use that home
2. Else running inside a Batch 1 release folder (`VERSION.txt` present) → release root
3. Else development → repository root (`shared/`, `logs/` beside `backend/`)

### 27.4 Startup validation

On `node src/server.js` (or `npm start`), the process **SHALL**:

1. Load configuration
2. Ensure folders + writable logs
3. Initialize file logging
4. Validate required env (fail-fast with readable list)
5. Verify Prisma client load
6. Verify database `SELECT 1`
7. Print validation report:

```text
[OK] configuration
[OK] folders
[OK] logging
[OK] version
[OK] Prisma
[OK] database
```

(Console may also show checkmarks; log files use `[OK]` / `[FAIL]` for Windows encoding safety.)

Missing or invalid configuration **SHALL** abort before listening, with messages naming the variable and remediation (see `formatConfigErrors`).

### 27.5 Logging standard

| File | Content |
|------|---------|
| `logs/startup.log` | Startup validation lines and boot summary |
| `logs/application.log` | Mirrored `console.log` / `info` / `warn` / `error` |
| `logs/error.log` | Warnings and errors |

Console logging is **extended**, not replaced. Existing `console.*` and performance middleware continue to work.

### 27.6 Health endpoint

| Method / path | Purpose |
|---------------|---------|
| `GET /health` | Ops health — version, uptime, environment, DB status, build timestamp, git commit |
| `GET /api/health` | Existing readiness JSON `{ ok, database }` (unchanged contract) |
| `GET /api/health/live` | Liveness without DB (unchanged) |

`GET /health` **SHALL NOT** expose `DATABASE_URL`, JWT secrets, file paths with credentials, or stack traces.

Example success body:

```json
{
  "ok": true,
  "application": "Flowtix ERP",
  "version": "1.0.0",
  "environment": "production",
  "uptimeSeconds": 42,
  "database": "up",
  "buildTimestamp": "2026-07-09T15:32:34.249Z",
  "gitCommit": "c8e051d"
}
```

Version fields are read from Batch 1 `VERSION.txt` when present; otherwise `package.json` version is used.

### 27.7 Implementation map (Batch 2)

| Module | Path |
|--------|------|
| Bootstrap | `backend/src/runtime/bootstrap.js` |
| Env load | `backend/src/runtime/loadEnv.js` |
| Config validate | `backend/src/runtime/config.js` |
| Folders | `backend/src/runtime/folders.js` |
| Logging | `backend/src/runtime/logging.js` |
| Health | `backend/src/runtime/health.js` |
| Release meta | `backend/src/runtime/releaseMeta.js` |
| Production env template | `deployment/production.env.example` |

**Still deferred after Batch 2:** Windows Service, installer, backup/update automation, Docker, pkg, nexe. *(esbuild → Batch 3 / §28)*

---

## 28. Backend Bundling Standard (Batch 3)

### 28.1 Purpose

Use **esbuild** to produce a single Node entry `app/server.js` from `backend/src/server.js` so client releases:

- Ship fewer application files (no raw `app/src/` tree)
- Start with `node server.js` / `npm start`
- Keep Prisma engines and npm packages as **external** runtime dependencies (compatible, supportable)

### 28.2 Honest IP protection limitation

Bundling is **deterrence and packaging hygiene**, not DRM. A determined party can still inspect JavaScript. Contractual license terms remain the primary IP control ([§15](#15-ip--source-code-protection-strategy)).

### 28.3 Bundle structure

```text
release/Flowtix-vX.Y.Z/
  app/
    server.js                 # esbuild CJS bundle (entry)
    package.json              # production dependencies only (no mini-erp file: link)
    prisma/generated/client-v2/  # Prisma Client + query engine for this build
    .env.example
    README.txt
  prisma/
    schema.prisma
    migrations/
  web/
  shared/
  tools/
  VERSION.txt
  RELEASE_NOTES.md
```

### 28.4 Excluded from `app/`

| Excluded | Reason |
|----------|--------|
| `src/` | Replaced by bundle |
| `test/`, `scripts/` | Dev / ops tooling |
| `.env` | Secrets live in `shared/.env` |
| Source maps | Default off (support channel only if needed) |
| `node_modules/` | Installed on server via `npm install --omit=dev` |
| Docs / `.git` | Not part of runtime package |

### 28.5 Prisma compatibility

| Rule | Statement |
|------|-----------|
| Schema + migrations | Still ship under release `prisma/` (unchanged Batch 1 contract) |
| Generated client | Copied into `app/prisma/generated/client-v2` at package time |
| External packages | `@prisma/client` and engines remain external — not inlined into `server.js` |
| Destructive commands | Packaging **SHALL NOT** run `migrate reset`, `db push`, or seed wipes |
| Server migrate | Operators use `prisma migrate deploy --schema=../prisma/schema.prisma` (or release-root schema path) |

`prismaClientPackage.js` resolves the client via `getPackageRoot()` so both source and bundled layouts work.

### 28.5.1 Packaged-runtime hazards (v1.14.2)

Application code that works under `node backend/src/server.js` **can fail** in `app/server.js` if it assumes a multi-file source tree or the default `@prisma/client` generate path.

| Hazard | Failure mode | Required pattern |
|--------|--------------|------------------|
| `require.resolve("./relativeModule")` (or dynamic `require` of a sibling `.js` not shipped) | `Cannot find module './…'` at runtime — siblings are inlined into `server.js`, not on disk | Prefer **static** `require("./…")` at load time (bundled). For diagnostics, emit **static module id strings**, never `require.resolve` of source-relative paths |
| `const { Prisma } = require("@prisma/client")` then `new Prisma.Decimal(…)` | `Prisma.Decimal is not a constructor` when custom output `client-v2` is the only generated client shipped under `app/prisma/` | Always `require("../prismaClientPackage")` (or equivalent) for `Prisma` / enums / `Decimal` |
| Bare `@prisma/client` for query filters | Same Decimal / namespace mismatch in packaged `app/` | Same — use generated client via `prismaClientPackage` |

**Incidents fixed in v1.14.2:**

1. **Tally Master Preview** (`POST /api/admin/tally-import/preview`) — `buildPreviewPayload` / diagnostics called `require.resolve("./mapLedgerToParty")` (and related modules). Mapping logic itself was already statically required; only the resolve broke the packaged path.
2. **Control Tower panel metrics** (`GET /api/control-tower/panel-metrics`) — `accountsDashboardService` used `new Prisma.Decimal(...)` from bare `@prisma/client` instead of `prismaClientPackage`.

**Regression:** `backend/test/packagedRuntimeBundle.test.js` builds `deployment/bundle-backend.js` output and asserts (a) no source-relative Tally `require.resolve` strings in `server.js`, (b) `Prisma.Decimal` works from packaged `app/prisma/generated/client-v2`. Also `test/unit/accountsDashboardDecimal.test.js`.

**Tally on same PC:** When Tally and the Flowtix backend run on the same machine and `http://localhost:9000` responds, a separate Tally HTTP proxy is **not** required for Master import preview/apply (XML upload / local Tally XML path). Proxy notes apply only when Tally is remote or the browser cannot reach Tally directly.

### 28.6 Tooling

| Artifact | Path |
|----------|------|
| Bundle script | `deployment/bundle-backend.js` |
| Build wrapper | `deployment/build-backend.bat` |
| Orchestrator | `deployment/create-release.bat` |
| Dev dependency | `backend` → `esbuild` (devDependency) |
| Packaged-runtime test | `backend/test/packagedRuntimeBundle.test.js` |

### 28.7 Validation checklist (Batch 3)

- [ ] `app/server.js` exists and is non-trivial size
- [ ] `app/src/` absent
- [ ] `app/package.json` lists production deps only (`main`: `server.js`)
- [ ] `app/prisma/generated/client-v2` present
- [ ] Release `prisma/schema.prisma` + `migrations/` present
- [ ] `GET /health` works when running bundled `node server.js` with valid `shared/.env` / env
- [ ] Backend unit tests still pass in the **source** tree (bundling does not replace test entrypoints)
- [ ] `npm test --prefix backend` includes `packagedRuntimeBundle` PASS
- [ ] Packaged `server.js` has no `require.resolve("./mapLedgerToParty")` (or sibling Tally resolves)
- [ ] Control Tower / accounts paths construct Decimal via generated client (`prismaClientPackage`)

### 28.8 Still deferred

MSI/WiX, **automated DB restore**, Docker, pkg, nexe, auto-update agent (R5). *(…; client setup → §34; Inno installer → §35)*

---

## 29. Database Backup Automation (Batch 4)

### 29.1 Purpose

Provide a **safe, operator-run mysqldump** so every production update can satisfy the mandatory pre-update backup rule ([§10](#10-database-backup-standard), [DEP-03](../09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)) without changing ERP data or schema.

### 29.2 Location & filename

| Item | Standard |
|------|----------|
| Directory | `<FT_ERP_HOME>\backups\db\` (dev: `<repo>\backups\db\`) |
| Filename | `flowtix-db-backup-v{version}-{YYYYMMDD}-{HHMMSS}.sql` |
| Manifest | `backups\db\BACKUP_MANIFEST.json` |

### 29.3 Configuration

| Source | Order |
|--------|-------|
| `shared/.env` `DATABASE_URL` | **Primary** |
| Process env / `.env` fallbacks | Secondary (dev) |
| `MYSQLDUMP_PATH` | Optional absolute path to mysqldump |

Passwords **SHALL NOT** be printed to console, logs, or the manifest.

### 29.4 Manifest entry fields

| Field | Notes |
|-------|-------|
| `filename` | Backup SQL name |
| `timestamp` | ISO-8601 start time |
| `appVersion` | From `VERSION.txt` / package |
| `gitCommit` | If available |
| `databaseName` | Parsed from URL (no credentials) |
| `host` | Host only |
| `fileSizeBytes` | Post-dump size |
| `status` | `success` \| `failed` |
| `error` | Present only on failure (redacted) |

### 29.5 Safety rules (Batch 4)

| Rule | Statement |
|------|-----------|
| No auto-delete | Old backups **SHALL NOT** be deleted by the script |
| No restore | Restore is **out of scope** (later batch) |
| No migrate | Script **SHALL NOT** run Prisma or DDL |
| No data mutation | Dump is read-only logical export |
| Fail safe | Missing mysqldump / bad URL / empty file → non-zero exit + clear message |
| Pre-update | Operators **SHALL** run backup successfully before applying an update |

### 29.6 Tooling

| Artifact | Path |
|----------|------|
| Script | `deployment/backup-db.js` |
| Wrapper | `deployment/backup-db.bat` |
| Shipped in release | `release/Flowtix-vX.Y.Z/tools/backup-db.*` |

Usage:

```text
tools\backup-db.bat
```

### 29.7 Restore deferred

Restore, update orchestration, and rollback automation remain **later batches**. Batch 4 only creates and catalogs dumps.

### 29.8 Validation checklist

- [ ] `mysqldump` found (or `MYSQLDUMP_PATH` set)
- [ ] Backup `.sql` created under `backups/db/` with size &gt; 0
- [ ] `BACKUP_MANIFEST.json` appended
- [ ] Console output contains no password
- [ ] Failure path readable when mysqldump missing or DB unavailable
- [ ] Release package includes `tools/backup-db.bat` and `tools/backup-db.js`

---

## 30. Prisma Migration Automation (Batch 5)

### 30.1 Purpose

Apply **shipped Prisma migrations only** via `prisma migrate deploy`, after a **mandatory verified backup** ([§10](#10-database-backup-standard), [§11](#11-prisma-migration-standard), [MIG-02/MIG-03](#111-principles)).

### 30.2 SOP

1. Ensure production `DATABASE_URL` is in `shared/.env` (fallback `.env` for lab only).
2. Run `tools\backup-db.bat` and confirm success in `BACKUP_MANIFEST.json`.
3. Run `tools\migrate-db.bat`.
4. Confirm `MIGRATION_MANIFEST.json` status `success`.
5. Do **not** start/stop the app server from this script (deferred to update batch).

### 30.3 Backup gate

| Check | Requirement |
|-------|-------------|
| Manifest exists | `backups\db\BACKUP_MANIFEST.json` |
| Latest success | Last `status=success` entry |
| File on disk | Path exists, size &gt; 0 |
| Freshness | Age ≤ `MIGRATE_BACKUP_MAX_AGE_MINUTES` (default **60**) |

On failure, abort with clear message including: **Run backup-db.bat before migrate-db.bat**.

### 30.4 Allowed / prohibited Prisma commands

| Allowed | Prohibited |
|---------|------------|
| `prisma migrate deploy` (Prisma **5.22.x** CLI; local `node_modules` or pinned `npx prisma@5.22.0`) | `prisma db push` |
| | `prisma migrate dev` |
| | `prisma migrate reset` |
| | Seed / reset / destructive scripts as part of migrate |
| | Unpinned latest Prisma 7+ CLI (incompatible with shipped schema `url = env(...)`) |

### 30.5 Migration manifest

Path: `backups\db\MIGRATION_MANIFEST.json` (append-only).

| Field | Notes |
|-------|-------|
| `timestamp` | ISO-8601 start |
| `appVersion` | Product version |
| `gitCommit` | If available |
| `backupFilename` | Gate backup used |
| `migrationCommand` | Exact deploy invocation |
| `status` | `success` \| `failed` |
| `exitCode` | Process exit |
| `durationMs` | Elapsed |
| `error` | Redacted summary on failure |

Passwords **SHALL NOT** appear in console, logs, or the manifest.

### 30.6 Failure handling

| Case | Behavior |
|------|----------|
| No / stale backup | Exit non-zero; **no** migrate |
| `migrate deploy` fails | Log to `MIGRATION_MANIFEST.json`; keep backups; **no** auto-restore |
| Manifest write fails | Non-zero exit; operator investigates |

### 30.7 Tooling

| Artifact | Path |
|----------|------|
| Script | `deployment/migrate-db.js` |
| Wrapper | `deployment/migrate-db.bat` |
| Shipped in release | `release/Flowtix-vX.Y.Z/tools/migrate-db.*` |

### 30.8 Restore / rollback deferred

Automated restore and rollback remain **later batches**. Full update orchestration is Batch 6 ([§31](#31-update-orchestration-batch-6)). Batch 5 does not change schema files or create new migrations — it only applies what already ships in the package.

### 30.9 Validation checklist

- [ ] Aborts without valid recent backup
- [ ] Uses latest successful backup from `BACKUP_MANIFEST.json`
- [ ] Command is `prisma migrate deploy` only
- [ ] `MIGRATION_MANIFEST.json` appended
- [ ] Console output contains no password
- [ ] Release package includes `tools/migrate-db.bat` and `tools/migrate-db.js`
- [ ] No schema / migration SQL files modified by this batch

---

## 31. Update Orchestration (Batch 6)

### 31.1 Purpose

Provide a **one-click update coordinator** that runs the certified sequence: validate → confirm → backup → migrate → replace `app/`+`web/` → verify — without Windows Service, installer, or automatic restore/rollback.

### 31.2 Operator SOP

1. Extract new package to `releases\Flowtix-vX.Y.Z\` (keep prior folders).
2. Ensure `shared\.env` exists at install home (`FT_ERP_HOME`).
3. From the **new** package: `tools\update-flowtix.bat`  
   Or: `node update-flowtix.js --source <newPackage> --home <FT_ERP_HOME> --yes`
4. Confirm Current / Target / Git Commit / Build Date.
5. Review `logs\update.log` and post-update smoke (§22).
6. Start or restart the Node process on the active path (service deferred).

### 31.3 Exact sequence

| Step | Action | Abort on failure |
|------|--------|------------------|
| 1 | Validate release (`VERSION.txt`, `app/`, `web/`) + `shared/.env` + existing active `app/`/`web/` | Yes |
| 2 | Display versions; require confirmation | Cancel exits 0 |
| 2b | Stop Windows Service if installed (Batch 8; no-op if absent) | Yes if present and stop fails |
| 3 | `backup-db.bat` | Yes — no migrate/deploy |
| 4 | `migrate-db.bat` | Yes — no app/web replace |
| 5 | Archive prior `app/`+`web/` under `releases\`; replace active `app/`+`web/` only | Yes |
| 6 | `GET /health` or file-layout equivalent | Yes |
| 6b | Start Windows Service if installed (Batch 8; no-op if absent) | Warn / exit 8 if start fails after deploy |
| 7 | Print summary; append `logs\update.log` | — |

### 31.4 Safety checks

| Rule | Statement |
|------|-----------|
| Never delete | `shared/`, `logs/`, `backups/` |
| Never overwrite | `shared/.env`, uploads under `shared/` |
| Never remove | Prior `releases\*` folders |
| Never restore | Automatic DB restore is out of scope |
| Never continue | After backup or migration failure |
| Deploy scope | **Only** `app/` and `web/` (plus active `VERSION.txt`) |

### 31.5 Failure handling

| Stage | Exit | Behavior |
|-------|------|----------|
| Validate | 2 | No changes |
| Backup | 3 | No migrate / deploy |
| Migrate | 4 | No app/web replace |
| Deploy | 5 | Stop; investigate archive |
| Verify | 6 | Files may already be replaced; operator runs Batch 7 rollback ([§32](#32-rollback-automation-batch-7)) |

All stages append to `logs\update.log` (time, versions, backup, migration, result, errors). Passwords **SHALL NOT** be logged.

### 31.6 Tooling

| Artifact | Path |
|----------|------|
| Script | `deployment/update-flowtix.js` |
| Wrapper | `deployment/update-flowtix.bat` |
| Shipped | `release/Flowtix-vX.Y.Z/tools/update-flowtix.*` |

### 31.7 Deferred

Automated DB restore, Windows Installer, Docker, cloud, licensing, monitoring. *(Windows Service → Batch 8 / §33)*

### 31.8 Validation checklist

- [ ] Missing release / `shared/.env` / active app|web detected
- [ ] Backup required before migrate/deploy
- [ ] Migration required before app/web replace
- [ ] Only `app/` and `web/` replaced
- [ ] `shared/`, `logs/`, `backups/` preserved
- [ ] `logs/update.log` written
- [ ] Failure aborts at the correct stage
- [ ] Release package includes `tools/update-flowtix.*`

---

## 32. Rollback Automation (Batch 7)

### 32.1 Purpose

Restore the **previous application binaries** (`app/` + `web/`) after a failed or unsafe update, using the Batch 6 pre-update archive under `releases\`. This is **Mode A** ([§13](#13-rollback-strategy)). It does **not** restore MySQL automatically.

### 32.2 App/web rollback SOP

1. Stop accepting traffic / stop Node process (service control deferred).
2. Confirm a `releases\Flowtix-v*-pre-update-*` archive exists (created by `update-flowtix`).
3. Run `tools\rollback-flowtix.bat` (or `--archive <path>` / `--home <FT_ERP_HOME>` / `--yes`).
4. Confirm Current → Restore version display.
5. Review `logs\rollback.log` and `logs\ROLLBACK_MANIFEST.json`.
6. If migrations were applied and data must match the prior app: **manually** restore the printed related backup under `backups\db\` (automation deferred).
7. Start process; run smoke (§22).

### 32.3 Sequence

| Step | Action | Abort on failure |
|------|--------|------------------|
| 1 | Locate newest `*-pre-update-*` archive (or `--archive`) | Yes |
| 2 | Validate archive contains `app/` + `web/` | Yes |
| 3 | Display versions + related backup guidance; confirm | Cancel exits 0 |
| 3b | Stop Windows Service if installed (Batch 8; no-op if absent) | Yes if present and stop fails |
| 4 | Replace active `app/` + `web/` from archive; restore `VERSION.txt` | Yes |
| 5 | Assert `shared/`, `logs/`, `backups/` untouched | Yes |
| 5b | Start Windows Service if installed (Batch 8; no-op if absent) | Fail entry if start fails |
| 6 | Append `rollback.log` + `ROLLBACK_MANIFEST.json` | — |

### 32.4 DB restore limitation

| Rule | Statement |
|------|-----------|
| No auto DB restore | Batch 7 **SHALL NOT** run `mysql` restore or delete dumps |
| Guidance only | Print related backup filename from `update.log` / `BACKUP_MANIFEST.json` when available |
| Mode B | Operator restores SQL manually, then re-smoke |
| Future | Automated DB restore = later batch |

### 32.5 Rollback manifest

Path: `logs\ROLLBACK_MANIFEST.json` (append-only).

| Field | Notes |
|-------|-------|
| `timestamp` | ISO-8601 start |
| `fromVersion` | Active version before rollback |
| `toVersion` | Version restored from archive |
| `restoredAppPath` | Active `app/` path |
| `restoredWebPath` | Active `web/` path |
| `relatedBackupFilename` | Suggested dump for manual DB restore |
| `status` | `success` \| `failed` |
| `durationMs` | Elapsed |
| `error` | Present on failure (redacted) |

Also append human-readable lines to `logs\rollback.log`.

### 32.6 Safety / failure handling

| Rule | Statement |
|------|-----------|
| Abort if archive missing | Exit 2 |
| Abort if archive `app/`/`web/` incomplete | Exit 3 |
| Never delete | Release archives, `shared/`, `logs/`, `backups/` |
| Never modify | `shared/.env`, uploads |
| Never run | Prisma / migrate / seed / reset |
| Never restore | Database automatically |

### 32.7 Tooling

| Artifact | Path |
|----------|------|
| Script | `deployment/rollback-flowtix.js` |
| Wrapper | `deployment/rollback-flowtix.bat` |
| Shipped | `release/Flowtix-vX.Y.Z/tools/rollback-flowtix.*` |

### 32.8 Operator checklist

- [ ] Pre-update archive present under `releases\`
- [ ] Related backup filename noted if DB may need restore
- [ ] App/web rollback completed (`ROLLBACK_MANIFEST` status `success`)
- [ ] `shared/.env` unchanged
- [ ] Smoke tests passed (or Mode B DB restore planned)
- [ ] Business Owner informed of go/no-go

### 32.9 Validation checklist

- [ ] Aborts when previous release archive missing
- [ ] Restores `app/` and `web/` from archive
- [ ] `shared/`, `logs/`, `backups/` preserved
- [ ] No Prisma command executed
- [ ] `logs/rollback.log` and `ROLLBACK_MANIFEST.json` written
- [ ] Release package includes `tools/rollback-flowtix.*`

---

## 33. Windows Service Integration (Batch 8)

### 33.1 Purpose

Provide an **optional** Windows Service so LAN servers can auto-start Flowtix ERP after reboot, with stdout/stderr under `logs\service\`, without requiring the service on every deployment.

### 33.2 Architecture decision

| Candidate | Decision |
|-----------|----------|
| **WinSW** | **Adopted** — EXE+XML, restart policies, log rolling, easy to vendor |
| NSSM | Rejected for packaging friction |
| node-windows / native | Rejected — couples service to Node package tree |
| Custom SCM | Deferred |

Compliant with FT-DEP-001 §6/§14/§16: secrets remain in `shared\.env`; service files under `service\`; update/rollback never delete `shared`/`backups`.

### 33.3 Operator SOP

1. Ensure active `app\server.js` and `shared\.env` exist.
2. (Optional) Place `WinSW-x64.exe` in `deployment\vendor\winsw\` or allow download.
3. Run elevated: `tools\service-install.bat --home <FT_ERP_HOME>`
4. Run: `tools\service-start.bat`
5. Verify: `tools\service-status.bat` and `GET /health`
6. Uninstall when needed: `tools\service-stop.bat` then `tools\service-uninstall.bat`

### 33.4 Update / rollback cooperation

| Orchestrator | Behavior |
|--------------|----------|
| `update-flowtix` | Stop service if present → backup → migrate → replace app/web → verify → start if present |
| `rollback-flowtix` | Stop if present → restore app/web → start if present (**no DB restore**) |
| Service absent | No-op; exit success for stop/start helpers |

### 33.5 Logging & recovery

| Item | Standard |
|------|----------|
| Log directory | `logs\service\` |
| Mode | WinSW roll-by-size (10 MB × 8 files) |
| On failure | Restart after 5s, then 10s, then 30s |
| Reset failure counter | 1 hour |
| Stop timeout | 20 seconds |

### 33.6 Safety

| Rule | Statement |
|------|-----------|
| Optional | Install **MAY** be skipped; product runs as console/Task Scheduler |
| No secrets in XML | Passwords stay in `shared\.env` |
| No DB restore | Service tooling never restores MySQL |
| Admin required | install / uninstall only |
| Preserve data folders | Never touch `shared/`, `backups/` |

### 33.7 Tooling

| Artifact | Path |
|----------|------|
| Core | `deployment/service-control.js` |
| CLI | `deployment/service-manage.js` |
| Wrappers | `service-install/uninstall/start/stop/restart/status.bat` |
| Vendor pin | `deployment/vendor/winsw/` (optional `WinSW-x64.exe`) |
| Shipped | `release/Flowtix-vX.Y.Z/tools/service-*` |

### 33.8 Deferred

Automated DB restore, Windows Installer (MSI/Inno), Docker, cloud, licensing, monitoring dashboards. *(Client setup bootstrap → Batch 9 / §34)*

### 33.9 Validation checklist

- [ ] Status reports `not_installed` when service absent
- [ ] Stop/start no-op successfully when absent
- [ ] Update/rollback continue without service
- [ ] Service scripts present in release `tools/`
- [ ] FT-DEP-001 §16 / §33 document WinSW decision
- [ ] No ERP business / UI / schema changes

---

## 34. Client Setup / Bootstrap (Batch 9)

### 34.1 Purpose

Automate **first-time LAN host preparation** per §18 without shipping an MSI/Inno installer. Setup prepares folders, validates env, places the certified package, and optionally runs Path A migrate or Path B skip-migrate.

### 34.2 Paths

| Path | Flag | Behavior |
|------|------|----------|
| **A (default)** | — | backup → `migrate deploy` → baseline backup |
| **B** | `--skip-migrate` | Folders + env validate + place `app/`/`web/` only |

### 34.3 Safety

| Rule | Statement |
|------|-----------|
| No `.env` overwrite | Existing `shared/.env` is never replaced |
| No DB wipe | Setup never drops/recreates the database |
| Existing install | Aborts if `shared/.env` + `app` + `web` already present (unless `--force` repair; still no `.env` overwrite) |
| Service optional | `--install-service` / prompt / `--skip-service` |
| Update unchanged | Upgrades remain `update-flowtix` (Batch 6) |

### 34.3.1 Place-release — installer source layout (critical)

#### Execution path (Batch 10 → Batch 9)

```text
Inno Setup [Files]
  → extract certified package to {app}\releases\Flowtix-vX.Y.Z\
Inno Setup [Run]
  → {app}\tools\post-install.bat  {app}  {app}\releases\Flowtix-vX.Y.Z  …
  → setup-flowtix.bat --home {app} --source {app}\releases\Flowtix-vX.Y.Z …
  → placeRelease(source, home)
  → promote live {app}\app + {app}\web
  → (optional) service install / firewall / migrate
```

#### Root cause (pre-v1.14) — archive self-wipe

Inno post-install always passes:

```text
--home {app}   --source {app}\releases\Flowtix-vX.Y.Z
```

In that **installer layout**, `--source` **is** the install archive under `releases\`. Older `placeRelease` still treated source as an *external* package and ran:

```text
replaceTree(source\app → home\releases\<name>\app)   // src === dest
replaceTree(source\web → home\releases\<name>\web)
```

`replaceTree` cleared the destination first, then copied from source. When paths were identical, that **destroyed the release payload** (empty `app`/`web` inside the archive), then promoted empty trees to live `{home}\app` / `{home}\web`. Post-check failed with `app\server.js missing after place`.

#### Cascade effects

| Effect | Why |
|--------|-----|
| Live `{home}\app` / `{home}\web` missing | Promotion copied from a wiped source |
| `install-recovery` abort removed partial live trees | Fresh-install abort policy removes incomplete runtime; DB / `.env` untouched |
| Windows Service never installed | Service stage runs only after successful place + npm; setup exited earlier |
| Inno wizard still showed success | `[Run]` non-zero exit does **not** fail the overall Inno install; extraction already succeeded |
| Archive may be empty or incomplete | Self-wipe happened *inside* `releases\Flowtix-vX` |

#### Minimal fix (v1.14+)

`placeRelease` / `replaceTree` in `deployment/setup-flowtix.js` **SHALL**:

1. Detect `path.resolve(source) === path.resolve(home\releases\<basename>)` (`sourceIsInstallArchive`).
2. **Skip** refreshing the archive onto itself.
3. **Promote** `app`/`web`/`prisma`/`VERSION.txt` from the intact archive into live `{home}`.
4. Make `replaceTree` a **no-op** when source and destination resolve to the same path (`source-equals-dest`).

#### Installer-layout vs external lab source

| Layout | `--source` | Behavior |
|--------|------------|----------|
| **Installer** | `{home}\releases\Flowtix-vX` | Skip archive self-refresh; promote only |
| **External / lab** | e.g. repo `release\Flowtix-vX` (≠ under home) | Copy/refresh into `home\releases\`, then promote (unchanged) |

#### Why prior certification missed it

Labs typically ran `setup-flowtix` with `--source` = repo `release\…` and `--home` = a different lab path (`source ≠ archive`). That path never self-wiped. Portability tests often failed earlier (e.g. missing `.env`) before `placeRelease`. **Future certification MUST** exercise the Inno-extracted layout or `certify-install` case `place_release_installer_layout`, and verify the archive remains intact **after** promotion:

- `{home}\releases\Flowtix-vX\app\server.js` still present
- `{home}\app\server.js` present (live)
- `setup.log` contains `source=install-archive; skip self-refresh` when using installer layout

#### Recovery — machine with already-wiped archive

If `releases\Flowtix-vX\app\server.js` is missing/empty after a failed install:

1. Do **not** re-run setup against the wiped archive.
2. Uninstall (preserve customer data) **or** delete/rename the broken `{home}` tree (keep MySQL DB + known-good `shared\.env` backup).
3. Reinstall using a **rebuilt** `Flowtix-Setup-vX.Y.Z.exe` that embeds the fixed `setup-flowtix.js` (copying only the fixed `.js` into an old install is insufficient for customer certification — rebuild release + installer).
4. Confirm live runtime + intact archive + `SETUP_EXIT=0` (see §35.4.1 and clean-machine checklist).

Regression harness: `certify-install` → `place_release_installer_layout`.

### 34.4 Logging

| Artifact | Path |
|----------|------|
| Setup log | `logs/setup.log` |
| Manifest | `logs/SETUP_MANIFEST.json` (append-only) |

Manifest fields include: timestamp, home, appVersion, path A/B, migrationStatus, backup filenames, service result, verify mode, status, durationMs.

### 34.5 Tooling

| Artifact | Path |
|----------|------|
| Orchestrator | `deployment/setup-flowtix.js` / `.bat` |
| Prereqs | `deployment/check-prereqs.js` / `.bat` |
| Folders | `deployment/init-folders.js` / `.bat` |
| Shipped | `release/Flowtix-vX.Y.Z/tools/setup-*` etc. |

### 34.6 Deferred

MSI/WiX, automated DB restore, MySQL product installer bundling. *(Inno Setup wrapper → Batch 10 / §35)*

### 34.7 Validation checklist

- [ ] Prereq checker reports Node / disk / mysqldump clearly
- [ ] Folders created idempotently
- [ ] Missing / invalid `.env` aborts without printing secrets
- [ ] Existing `.env` not overwritten
- [ ] Path B skips migrate
- [ ] Path A runs backup → migrate → baseline when DB ready
- [ ] Service remains optional
- [ ] `setup.log` + `SETUP_MANIFEST.json` written
- [ ] Release package includes setup tools
- [ ] Installer-layout place-release: archive intact after promote (`place_release_installer_layout`)
- [ ] No schema / UI / business logic changes

---

## 35. Windows Installer — Inno Setup (Batch 10)

### 35.1 Purpose

Deliver a **professional Windows setup EXE** that packages the certified release and **delegates** first-time bootstrap to Batch 9 (`setup-flowtix`) and optional service install to Batch 8. The installer does **not** redesign deployment or replace update/rollback.

### 35.2 Architecture

| Layer | Responsibility |
|-------|----------------|
| Inno Setup 6 | Wizard, extract, shortcuts, uninstaller, logging |
| Batch 9 | Folders, env validation, place app/web, Path A/B migrate |
| Batch 8 | Optional WinSW via setup flags |
| Batch 6 / 7 | Day-2 update / rollback (unchanged) |

### 35.3 Build

```text
deployment\create-release.bat
deployment\installer\build-installer.bat
→ deployment\installer\output\Flowtix-Setup-vX.Y.Z.exe
```

Sources: `deployment/installer/Flowtix.iss`, `license.txt`, `post-install.bat`, `README.md`.

### 35.4 Safety

| Rule | Statement |
|------|-----------|
| No MySQL install | Operator provides MySQL |
| No `.env` overwrite | Batch 9 rules apply |
| Existing install | `post-install.bat` skips setup; use Batch 6 |
| Uninstall default | Stop/remove service; remove app/web binaries; **keep** `shared/`, `backups/`, `logs/`, `releases/`, DB |
| No secrets in EXE | Templates only |
| Place-release | Post-install source is `{app}\releases\…` — Batch 9 must not self-wipe the archive ([§34.3.1](#3431-place-release--installer-source-layout-critical)) |

### 35.4.1 Installer success vs bootstrap failure

Inno Setup `[Run]` **SHALL** execute `{app}\tools\post-install.bat` directly with quoted home/source arguments. Wrapping as `cmd /C "post-install.bat" "home" "source"` is forbidden — Windows drops arguments and bootstrap exits before writing `logs\installer-post.log`.

`[Run]` of `post-install.bat` may still return non-zero while the wizard reports the product as installed (files extracted). Operators **SHALL** confirm live runtime after install:

- `{app}\app\server.js` and `{app}\web\index.html` exist
- `logs\installer-post.log` shows `SETUP_EXIT=0` (not a place-release error)
- Optional: `sc query FlowtixERP` when the install-service task was selected

Do not treat wizard completion alone as Path A/B bootstrap success.

### 35.4.2 Rebuild requirement (hotfixes)

After any change to `setup-flowtix.js`, `install-validate.js`, `post-install.bat`, or `Flowtix.iss`:

1. `deployment\create-release.bat` (embeds tools into `release\Flowtix-vX.Y.Z\`)
2. `deployment\installer\build-installer.bat` (embeds that release into the setup EXE)
3. Record installer SHA-256; run clean-machine checks in §35.8 / customer acceptance 10

Manually copying a fixed script onto a customer machine is an emergency workaround only — it does **not** satisfy release certification. Customer media must ship a rebuilt EXE.

### 35.5 Silent install

`/VERYSILENT /DIR="C:\FT-ERP"` with optional `/TASKS="skipmigrate,installservice,desktopicon"` and `/LOG=…`. Path A requires pre-created `shared\.env`.

### 35.6 Code signing

Optional Authenticode via Inno `SignTool` — documented in `deployment/installer/README.md`; **not required** to produce a build.

### 35.7 Deferred

MSI/WiX, auto-update agent (R5), bundled MySQL, automated DB restore.

### 35.8 Validation checklist

- [ ] `build-installer.bat` produces `Flowtix-Setup-v*.exe`
- [ ] Installer embeds release with `tools/setup-flowtix.bat`
- [ ] Post-install calls Batch 9 (or skips on existing install)
- [ ] After fresh install: live `{app}\app` and `{app}\web` exist (not only under `releases\`)
- [ ] `certify-install` includes `place_release_installer_layout` PASS
- [ ] Service task optional; service install only after runtime placed
- [ ] Uninstall preserves shared/backups/logs/releases/DB
- [ ] Update/rollback tools unchanged
- [ ] FT-DEP-001 §21 R4 / §35 documented
- [ ] No ERP business / UI / schema changes

---

## 36. Deployment Validation & Client Handover Pack (Batch 11)

### 36.1 Purpose

Provide a **production-ready operational layer** for first customer go-live: readiness gates, printable checklists, sign-off/report/escalation templates, administrator runbook, version compatibility matrix, and an optional **read-only** install probe. Batch 11 **SHALL NOT** redesign Batches 1–10 engines.

### 36.2 Package location

| Location | Role |
|----------|------|
| Repo: `docs/product/06_Deployment/handover/` | Source of truth (FT-PD-103) |
| Release: `docs/handover/` | Copied by `create-release.bat` into every `Flowtix-vX.Y.Z` package |
| Tools: `tools/verify-install.*` | Optional read-only verification |

Index: [handover/README.md](./handover/README.md). Governing IDs: **FT-DEP-011** (readiness), **FT-DEP-012** (runbook), **FT-DEP-013** (compatibility).

### 36.3 Read-only verify-install

```text
tools\verify-install.bat --home C:\FT-ERP
tools\verify-install.bat --home C:\FT-ERP --skip-health
tools\verify-install.bat --home C:\FT-ERP --json
```

| Rule | Statement |
|------|-----------|
| Read-only | **SHALL NOT** migrate, backup, update, rollback, write `.env`, or start/stop services |
| Secrets | **SHALL NOT** print `DATABASE_URL`, JWT, or other `.env` values (PORT may be read silently for `/health`) |
| Checks | Folders (`app`, `web`, `shared`, `backups`, `logs`), `app\server.js`, `web\index.html`, `VERSION.txt` (if present), `shared\.env` **presence**, optional `GET /health`, optional WinSW status |
| Log | Appends to `logs\verify-install.log` (no secrets) |
| Exit | `0` = no ERROR-level failures; WARN (e.g. process down) does not fail the probe by itself for health/service |

### 36.4 Relationship to §22

§22 remains the **minimum** acceptance checklist. Operators **SHOULD** complete the numbered handover checklists and templates for production cutover (DEP-12, INS-06, OPS-04). Smoke surfaces remain FT-PD-066-compliant — no alternate UX.

### 36.5 Safety / non-goals

| In scope | Out of scope |
|----------|--------------|
| Docs + read-only verify | ERP business / workflow / UI / Prisma schema changes |
| Copy handover into release | Changing backup/migrate/update/rollback/service/setup/installer core logic |
| Templates forbid secrets in tickets | Automated DB restore, monitoring product, full Volume 8 UAT pack |

### 36.6 Validation checklist

- [ ] `handover/` pack present in repo and in release `docs/handover/`
- [ ] `tools/verify-install.*` shipped; read-only behavior confirmed
- [ ] FT-DEP-001 §22 links to handover; §36 documented
- [ ] No diffs to Batches 4–10 engine scripts beyond packaging copy / README
- [ ] No ERP business / UI / schema changes

---

## 37. Installation Hardening (Milestone 3)

### 37.1 Purpose

Harden first-time and repair installs so a production Windows server can be validated **before** mutation, configured safely, migrated with `prisma migrate deploy` only, recovered from install failures **without** rolling back the customer database, uninstalled without deleting MySQL by default, and support-ready via a diagnostics bundle.

Milestone 3 **reuses** Batches 1–11 + Milestone 2. It **SHALL NOT** introduce a parallel deployment framework or redesign ERP workflows.

### 37.2 Environment validation (Phase A)

| Tool | `tools/install-validate.bat` / `install-validate.js` |
|------|------------------------------------------------------|
| When | Before `setup-flowtix` mutates the home (default; `--skip-validate` escapes only for lab) |
| Checks | Windows version, Administrator (when service intended), disk space, Node/npm, MySQL client, Prisma availability, existing install/service/shared/.env/backups/logs/version, port, WinSW integrity, required folders |
| Output | `logs/install/install-validation-report.{json,txt}` — FAIL items include corrective action |
| Rule | On FAIL: stop; **never partially install** |

### 37.3 Guided production configuration (Phase B)

| Tool | `tools/configure-env.bat` / `configure-env.js` |
|------|------------------------------------------------|
| Fields | Hostname, IPv4, HTTP port, DB host/port/name/user/password, `FT_ERP_HOME`, backup dir, log dir, JWT |
| Rules | Validate every field; show **Configuration Summary** with secrets masked; never overwrite existing `shared/.env` without confirmation / `--force`; never print passwords |

### 37.4 Database safety (Phase C)

| Tool | `tools/db-safety.bat` / `db-safety.js` (also invoked by `setup-flowtix` and `migrate-db`) |
|------|----------------------------------------------------------------------------------------|
| Checks | MySQL reachable, credentials, DB exists (optional `--create-db`), MySQL ≥ 8, migration history, `DATABASE_URL` sanity, block known development DB names (`mini_erp`, etc.) |
| Allowed | `prisma migrate deploy` only |
| Forbidden | `prisma db push`, `prisma migrate reset` |

### 37.5 Windows Service hardening (Phase D)

WinSW remains the wrapper. Generated XML includes Automatic + delayed start, `onfailure` restart (5s/10s/30s), `starttimeout` 60s, `stoptimeout` 30s, roll-by-size logs, dependency/working-directory validation before install, and post-start `/health` verification from setup when the service is started.

### 37.6 Installation recovery (Phase E)

| Tool | `tools/install-recovery.bat` / `install-recovery.js` |
|------|------------------------------------------------------|
| Model | begin → stages → commit \| abort |
| On abort | Restore snapshotted `app`/`web`/`prisma` (or remove partial fresh trees) |
| Never | Automatic MySQL rollback / delete of `shared/.env` / customer backups |

State: `logs/install/INSTALL_TRANSACTION.json` + snapshots under `logs/install/snapshots/`.

### 37.7 Safe uninstall (Phase F)

Inno Setup (`Flowtix.iss`) asks whether to preserve customer data. **Default: preserve** `shared\`, `backups\`, `logs\`. Application binaries (`app\`, `web\`, `prisma\`) are removed. **MySQL database is never deleted** by the uninstaller.

### 37.8 Diagnostics bundle (Phase G)

| Tool | `tools/collect-diagnostics.bat` / `collect-diagnostics.js` |
|------|------------------------------------------------------------|
| Output | `logs/diagnostics/flowtix-diagnostics-<timestamp>/` (ZIP-ready) |
| Contents | Versions (Flowtix/installer/Windows/Node/npm/MySQL/Prisma), service state, port, paths, health, migrations list, directory checks, recent installer logs, configuration summary — **passwords masked** |
| Setup | Collected by default after setup (`--skip-diagnostics` to omit) |

### 37.9 Clean-machine certification (Phase H)

| Tool | `tools/certify-install.bat` / `certify-install.js` |
|------|----------------------------------------------------|
| Scope | Safe lab simulations (configure, validate, recovery, db-safety guard, WinSW XML, diagnostics, uninstall policy, **installer place-release layout**, syntax) |
| Site acceptance | Reboot, LAN multi-browser, live service install remain FT-DEP-011 gates |
| Required regression | `place_release_installer_layout` — `--source` under `home\releases\` must create live `app`/`web` without wiping the archive |

### 37.10 Validation checklist (Milestone 3)

- [ ] `install-validate` fails closed before place-release when environment unsafe
- [ ] `configure-env` masks secrets; refuses overwrite without confirm/`--force`
- [ ] `db-safety` blocks `mini_erp` / invalid URL; migrate remains `deploy` only
- [ ] WinSW XML contains restart + timeouts + log rotation
- [ ] Failed setup aborts install transaction (files only; DB untouched)
- [ ] Uninstaller default preserves customer data; never deletes MySQL
- [ ] `collect-diagnostics` produces masked `summary.json`
- [ ] `certify-install` exits 0 in lab (includes `place_release_installer_layout`)
- [ ] Fresh Inno install creates live `{app}\app` + `{app}\web` (not archive-only)
- [ ] FT-DEP-011 / FT-DEP-012 / checklist 02 synchronized

---

## 38. Customer Delivery Media (Milestone 4)

### 38.1 Purpose

Assemble a **commercial customer delivery package** from the certified release + Windows installer + customer documentation + demo lab pack — without duplicating Batches 1–11 engines.

### 38.2 Tooling

| Tool | Role |
|------|------|
| `deployment/create-customer-media.bat` | Builds `customer-media/Flowtix-ERP-vX.Y.Z/` |
| `deployment/certify-customer-media.bat` | Validates media layout, checksums, manifest, branding markers |
| `deployment/demo/` | Lab demo seed + users + walkthrough (**not** shipped inside `prisma/` of the server package) |

### 38.3 Media layout

Numbered folders: `01 Setup` … `10 Manifest` (installer EXE, docs, demo, server ZIP, utilities, support, release notes, SHA256SUMS, license, RELEASE_MANIFEST.json).

### 38.4 Rules

- Product version source of truth remains `backend/package.json`.
- Checksums and manifest are generated automatically (no hand editing).
- Customer guides cross-reference FT-DEP-001 / 011 / 012; they do not fork deployment law.
- Demo seed requires `DEMO_SEED_CONFIRM=YES` and must not target production database names.
