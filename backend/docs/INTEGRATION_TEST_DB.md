# Integration tests and database alignment

Integration tests live in `test/integration/` and need a **MySQL database whose schema matches `prisma/schema.prisma`**. They do not change business rules; they only exercise routes and Prisma against real rows.

## Schema mismatch (vs an old or partially migrated DB)

These are the main gaps people hit when the database was created before recent ERP changes, or when migrations were never applied.

### Integration suite / app-critical columns and objects

| Area | Expected (current Prisma) | Typical drift |
|------|-------------------------|---------------|
| **Dispatch** | `itemId`, `reversalOfId`, `reversalReason` | Missing `reversalOfId` / `reversalReason`; sometimes missing `itemId` on very old DBs |
| **StockTransaction** | `transactionType` includes `DISPATCH`, `ADJUSTMENT`, `DISPATCH_REVERSAL`, `QC_REVERSAL` | Older ENUMs without reversal values |
| **QcEntry** | `reversedAt`, `reversalReason` | Columns missing → Prisma reads/writes fail |
| **QcReversal** | Table exists | Missing table |
| **ScrapRecord** | `voidedAt`, `qcEntryId` (FK to `QcEntry`, nullable) | Columns missing |
| **WorkOrder** | `salesOrderId` NOT NULL, lines via `WorkOrderLine` (current model) | Old schemas used a different shape (e.g. single `itemId` on `WorkOrder`) |

Reference SQL in repo:

- `prisma/migrations/20260402140000_dispatch_reversal/migration.sql` — dispatch reversal + `DISPATCH_REVERSAL`
- `prisma/migrations/20260402160000_qc_reversal/migration.sql` — QC reversal + `QcReversal` + scrap/qc links + `QC_REVERSAL`
- `prisma/migrations/20260402120000_workorder_salesorderid_not_null/migration.sql` — NOT NULL `salesOrderId`

### Why `prisma migrate deploy` hit P3005

P3005 appears when Prisma sees a **non-empty** database that was never marked as migrated. That is normal for an existing dev DB full of data. **`migrate deploy` is not a good fit for “fix my old dev DB in place”** unless you baseline migrations explicitly (see [Prisma baselining](https://www.prisma.io/docs/guides/migrate/developing-with-prisma-migrate/add-prisma-migrate-to-a-project)).

### Recommended path: dedicated empty integration database

Safest for local/dev (no silent wipes of your main ERP data):

1. Create a **new empty** database on the same MySQL instance (or a disposable instance).
2. Point **`INTEGRATION_DATABASE_URL`** at it.
3. Run **`npm run test:integration:prepare`** (runs `prisma db push` against that URL).

`db push` syncs the database to **`schema.prisma`**, which matches what the running app and integration tests expect. Use an **empty** database so push does not need destructive reconciles.

Example (MySQL CLI, adjust user/password):

```sql
CREATE DATABASE mini_erp_integration CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Required environment variables

| Variable | When |
|----------|------|
| `DATABASE_URL` | Normal dev server and **unit tests** (no DB for unit tests). |
| `INTEGRATION_DATABASE_URL` | Optional; when set **and** `ERP_RUN_DB_INTEGRATION=1`, integration tests override `DATABASE_URL` for that process only (see `erp-flows.integration.test.js`). |
| `ERP_RUN_DB_INTEGRATION=1` | Enables integration suites (otherwise they are skipped). |
| `JWT_SECRET` | Optional in dev; integration tests sign JWTs with the same rules as the app. |

Copy `backend/.env.example` to `.env` and optionally add `INTEGRATION_DATABASE_URL` (see `.env.integration.example`).

## Commands

### Unit tests (no MySQL required)

```bash
cd backend
npm test
```

### Prepare a clean integration schema (empty DB only)

```bash
cd backend
# Set a URL that is NOT your main dev database:
set INTEGRATION_DATABASE_URL=mysql://USER:PASS@localhost:3306/mini_erp_integration
npm run test:integration:prepare
```

PowerShell:

```powershell
$env:INTEGRATION_DATABASE_URL = "mysql://erp:erp1234@localhost:3306/mini_erp_integration"
npm run test:integration:prepare
```

The script **refuses** to run if `INTEGRATION_DATABASE_URL` equals `DATABASE_URL` (after loading `.env`) so you do not accidentally push against your primary DB.

### Run integration tests

```bash
cd backend
set ERP_RUN_DB_INTEGRATION=1
set INTEGRATION_DATABASE_URL=mysql://USER:PASS@localhost:3306/mini_erp_integration
npm run test:integration
```

PowerShell:

```powershell
$env:ERP_RUN_DB_INTEGRATION = "1"
$env:INTEGRATION_DATABASE_URL = "mysql://erp:erp1234@localhost:3306/mini_erp_integration"
npm run test:integration
```

If you already point `DATABASE_URL` at the integration database, you can omit `INTEGRATION_DATABASE_URL` and only set `ERP_RUN_DB_INTEGRATION=1`.

## If schema drift is detected

Symptoms:

- Prisma errors mentioning missing columns (e.g. `Dispatch.reversalOfId`).
- Integration `before` hook error referencing reversal columns.

Steps:

1. Confirm you are on the integration DB (or a disposable dev DB), **not** production.
2. Prefer **new empty DB + `npm run test:integration:prepare`**.
3. For a **long-lived dev DB** you cannot replace: either apply the SQL in `prisma/migrations/` in order (risky if history diverged) or use Prisma’s baseline/resolve workflow, then keep using `migrate deploy` going forward.

## Manual steps (still required)

- Install/start MySQL (e.g. repo `docker-compose.yml` for `mysql`).
- Create the empty database (`CREATE DATABASE ...`).
- Ensure the MySQL user can connect and DDL that database.

## Migration history note

The first migration file under `prisma/migrations/` may not represent the full evolution to the current `schema.prisma`. For a **from-empty** integration database, **`prisma db push` is the reliable alignment mechanism** in this repo; use `migrate deploy` only after you have verified the full migration chain on a clean database.
