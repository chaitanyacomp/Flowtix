# FT ERP — Deployment & Release Management Standard

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-001 |
| **Title** | Deployment & Release Management Standard |
| **Version** | 1.5.0 |
| **Status** | Draft — Architecture Review |
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
| **Future FT-DEP-00x / scripts** | Implementation of this standard (build tools, installers, service wrappers) — **not in scope of this revision** |

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

**Supersedes:** Informal client install notes; ad-hoc “copy the repo to the server” practices.

**Change authority:** Product Architecture + Release Operations. Material changes to packaging, backup, migration, or rollback rules require Architecture Review and alignment with Volume 9.

**Out of scope for this revision (deferred implementation):**

- Build / release scripts
- `package.json` script changes
- esbuild bundling configuration
- Windows Service wrappers / NSSM / node-windows
- Windows Installer (MSI / Inno / electron-builder)
- CI/CD pipelines
- Docker / Kubernetes

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
| **FT ERP backend** | Same server PC | Listens on LAN IP + port (e.g. `0.0.0.0:3001`) |
| **FT ERP frontend** | Served by backend static host **or** reverse proxy on same host | Production `dist/` only |
| **Clients** | 2–10 PCs / tablets on LAN | Modern browser; no local app install required for Phase 1 |
| **Internet** | Not required for core ERP | Optional for updates delivery / remote support |

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
│   ├── service\                  # Windows Service stdout/stderr (future)
│   └── deploy\                   # Install/update/rollback records
└── tools\                        # Admin helpers (Batch 4–6: backup-db.*, migrate-db.*, update-flowtix.*; rollback later)
```

### 6.1 Folder rules

| Rule | Statement |
|------|-----------|
| **F-01** | Each product version **SHALL** occupy its own `releases\<version>\` directory. |
| **F-02** | Updates **SHALL** add a new version folder; they **SHALL NOT** overwrite the previous folder in place. |
| **F-03** | `shared\.env`, `shared\uploads`, and `backups\` **SHALL** live outside version folders. |
| **F-04** | Activating a release **SHALL** be done by switching the process working directory / `current` junction / service path — not by deleting the old tree first. |
| **F-05** | At least **one prior** successful release folder **SHOULD** be retained; major sites **SHOULD** retain N-2. |

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
| **A — Release switch** | No schema change / compatible | Stop process → point to prior `releases\<old>\` → start → smoke |
| **B — Release + DB restore** | Migrations applied or data suspect | Stop → restore pre-update SQL → activate prior release → smoke |
| **C — Forward fix** | Rollback cost high; fix available | Stay on version; apply certified patch ASAP |

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

### 16.2 Phase 2 (approved direction)

Run FT ERP backend as a **Windows Service** so that:

- Process restarts on reboot
- Stdout/stderr capture to `logs\service\`
- Service account has least privilege to `C:\FT-ERP\` + MySQL local

Candidate tooling (decision deferred): NSSM, node-windows, WinSW, or custom service wrapper.

### 16.3 Service contract (future)

| Setting | Requirement |
|---------|-------------|
| Display name | `FT ERP Backend` (or customer-branded) |
| Startup | Automatic |
| Failure restart | Restart after short delay |
| Working directory | Active release `app\` |
| Environment | Load from `shared\.env` or service environment |

**This revision does not install a service.** When implemented, it **SHALL** obey folder and backup rules above.

---

## 17. Logging & Diagnostics

Aligned with [FT-PD-092](../09_Deployment_and_Operations_Architecture/Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md).

### 17.1 Log classes

| Class | Path | Content |
|-------|------|---------|
| Application | `logs\app\` | API errors, auth failures, unexpected exceptions |
| Deploy | `logs\deploy\` | Install/update/rollback records, backup paths, versions |
| Service | `logs\service\` | Process supervisor output (future) |

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

1. **Prepare server** — Windows updates, disk space, static LAN IP recommended.
2. **Install MySQL** — local instance; create empty database + user with least privilege.
3. **Create folder tree** — §6 (`releases`, `shared`, `backups`, `logs`).
4. **Place secrets** — create `shared\.env` (`DATABASE_URL`, JWT secrets, ports, etc.).
5. **Extract release** — `releases\<version>\` from certified package; verify checksum.
6. **Install runtime deps** — per Phase A/B packaging instructions (tooling deferred).
7. **Apply migrations** — against empty DB.
8. **Seed / configure** — only approved first-run seeds (roles, company profile); **no** demo wipe scripts on real masters without consent.
9. **Start backend** — bind LAN interface; confirm health endpoint / login page.
10. **Client browsers** — open `http://<server-ip>:<port>`; verify FT-PD-066 surfaces load.
11. **Admin provisioning** — users/roles per Volume 7.
12. **Backup baseline** — first successful dump to `backups\db\`.
13. **Record** — deploy log + go-live / pilot acceptance as applicable.
14. **Train** — Dashboard / Workspace / Reports navigation per Volume 6; do not invent alternate UX.

**Firewall:** allow LAN clients to app port only.

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
| **R4** | Guided installer (Inno Setup / MSI) — creates folders, service, MySQL checks | R3 |
| **R5** | Optional auto-update agent (LAN share / signed packages) | R4 + security review |

**Rules for future installer:**

- **SHALL** implement §6 folder layout
- **SHALL** refuse update without backup confirmation (or perform backup itself)
- **SHALL NOT** embed customer secrets in the installer binary
- **SHALL** leave prior release for rollback

---

## 22. Release Acceptance Checklist

Use after **install** or **update** before declaring production success.

### 22.1 Technical

- [ ] `release.json` version matches intended release
- [ ] Backend process running; LAN URL reachable
- [ ] Frontend loads (no Vite dev server)
- [ ] DB migration head matches manifest
- [ ] Pre-change backup path recorded and file verified
- [ ] Prior release folder still present (updates)
- [ ] `shared\.env` intact (not blanked)
- [ ] Logs writable under `logs\`

### 22.2 Functional smoke (minimum)

- [ ] Login / session works for Admin
- [ ] Dashboard or home shell loads (FT-PD-066)
- [ ] Open one master (e.g. Item or Customer) read-only
- [ ] Open one operational workspace relevant to site (SO / WO / Stock — as licensed)
- [ ] One Analysis report opens if Reports licensed
- [ ] No obvious API 500 on home navigation

### 22.3 Governance

- [ ] Deploy log completed
- [ ] Business Owner informed of result
- [ ] If fail → rollback mode chosen (§13) and executed
- [ ] No uncertified hotfix left on server

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

**Status:** Draft — Architecture Review (v1.5.0). Batches 1–6 (packaging, runtime, esbuild, backup, migrate, update orchestrator) are documented; restore/rollback, Windows Service, and installer remain deferred.

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

### 28.6 Tooling

| Artifact | Path |
|----------|------|
| Bundle script | `deployment/bundle-backend.js` |
| Build wrapper | `deployment/build-backend.bat` |
| Orchestrator | `deployment/create-release.bat` |
| Dev dependency | `backend` → `esbuild` (devDependency) |

### 28.7 Validation checklist (Batch 3)

- [ ] `app/server.js` exists and is non-trivial size
- [ ] `app/src/` absent
- [ ] `app/package.json` lists production deps only (`main`: `server.js`)
- [ ] `app/prisma/generated/client-v2` present
- [ ] Release `prisma/schema.prisma` + `migrations/` present
- [ ] `GET /health` works when running bundled `node server.js` with valid `shared/.env` / env
- [ ] Backend unit tests still pass in the **source** tree (bundling does not replace test entrypoints)

### 28.8 Still deferred

Windows Service, installer, **restore / rollback** automation, Docker, pkg, nexe. *(Backup → §29; migrate → §30; update orchestrator → §31)*

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
| 3 | `backup-db.bat` | Yes — no migrate/deploy |
| 4 | `migrate-db.bat` | Yes — no app/web replace |
| 5 | Archive prior `app/`+`web/` under `releases\`; replace active `app/`+`web/` only | Yes |
| 6 | `GET /health` or file-layout equivalent | Yes |
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
| Verify | 6 | Files may already be replaced; operator decides rollback (manual / later batch) |

All stages append to `logs\update.log` (time, versions, backup, migration, result, errors). Passwords **SHALL NOT** be logged.

### 31.6 Tooling

| Artifact | Path |
|----------|------|
| Script | `deployment/update-flowtix.js` |
| Wrapper | `deployment/update-flowtix.bat` |
| Shipped | `release/Flowtix-vX.Y.Z/tools/update-flowtix.*` |

### 31.7 Deferred

Rollback automation, Windows Service, installer, Docker, cloud, licensing, monitoring.

### 31.8 Validation checklist

- [ ] Missing release / `shared/.env` / active app|web detected
- [ ] Backup required before migrate/deploy
- [ ] Migration required before app/web replace
- [ ] Only `app/` and `web/` replaced
- [ ] `shared/`, `logs/`, `backups/` preserved
- [ ] `logs/update.log` written
- [ ] Failure aborts at the correct stage
- [ ] Release package includes `tools/update-flowtix.*`
