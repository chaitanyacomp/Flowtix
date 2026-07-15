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

### Recommended path: dedicated empty integration database

Safest for local/dev (no silent wipes of your main ERP data):

1. Create a **new empty** database on the same MySQL instance (or a disposable instance).
2. Point **`TEST_DATABASE_URL`** at it.
3. Run **`npm run test:integration:prepare`** (runs `prisma migrate deploy` against that URL).

`migrate deploy` applies the committed migration history in `prisma/migrations/`, so the integration database is built **exactly like development and production** — including MySQL 8 expression-default DDL (`DEFAULT ('')`) on TEXT snapshot columns that schema-driven `db push` cannot generate on Prisma 5.22.0. Use an **empty** database so the full history applies cleanly from scratch.

> **Do not use `prisma db push` for this database.** On Prisma 5.22.0 it emits an illegal literal `TEXT ... DEFAULT ''` for `@default("") @db.Text` fields, which MySQL rejects with error 1101 ("BLOB, TEXT, GEOMETRY or JSON column can't have a default value").

### Why `prisma migrate deploy` can hit P3005

P3005 appears when Prisma sees a **non-empty** database that was never marked as migrated. That is normal for an existing dev DB full of data, but it does **not** happen for the recommended empty integration DB. For a long-lived dev DB you cannot replace, baseline migrations explicitly (see [Prisma baselining](https://www.prisma.io/docs/guides/migrate/developing-with-prisma-migrate/add-prisma-migrate-to-a-project)) before using `migrate deploy`.

Example (MySQL CLI, adjust user/password):

```sql
CREATE DATABASE mini_erp_integration CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Required environment variables

| Variable | When |
|----------|------|
| `DATABASE_URL` | Normal dev server and **unit tests** (no DB for unit tests). |
| `NODE_ENV=test` | Required by the strict prepare/run scripts so DB-backed tests cannot run in a normal dev/production mode. |
| `TEST_DATABASE_URL` | Required by the strict prepare/run scripts. Must point at a dedicated disposable test DB and must not equal `DATABASE_URL`. |
| `INTEGRATION_DATABASE_URL` | Legacy fallback still accepted by the raw skipped integration tests, but prefer `TEST_DATABASE_URL`. |
| `ERP_RUN_DB_INTEGRATION=1` | Internal guard used by `npm run test:integration:db`; raw `npm run test:integration` skips suites unless this is set. |
| `JWT_SECRET` | Optional in dev; integration tests sign JWTs with the same rules as the app. |

Copy `backend/.env.example` to `.env` and keep test DB credentials separate in `TEST_DATABASE_URL`.

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
set NODE_ENV=test
set TEST_DATABASE_URL=mysql://USER:PASS@localhost:3306/mini_erp_test
npm run test:integration:prepare
```

PowerShell:

```powershell
$env:NODE_ENV = "test"
$env:TEST_DATABASE_URL = "mysql://erp:erp1234@localhost:3306/mini_erp_test"
npm run test:integration:prepare
```

The script **refuses** to run unless `NODE_ENV=test` and refuses if `TEST_DATABASE_URL` equals `DATABASE_URL` (after loading `.env` and `.env.integration`) so you do not accidentally migrate your primary DB.

### Run integration tests

```bash
cd backend
set NODE_ENV=test
set TEST_DATABASE_URL=mysql://USER:PASS@localhost:3306/mini_erp_test
npm run test:integration:db
```

PowerShell:

```powershell
$env:NODE_ENV = "test"
$env:TEST_DATABASE_URL = "mysql://erp:erp1234@localhost:3306/mini_erp_test"
npm run test:integration:db
```

Use `npm run test:integration:db` for real DB-backed tests. The lower-level `npm run test:integration` command remains available for CI plumbing, but it skips suites unless the integration guard is set.

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

For a **from-empty** integration database, **`prisma migrate deploy` (the committed migration history) is the reliable alignment mechanism** in this repo. It reproduces development/production exactly, including MySQL expression-default DDL that schema-driven `db push` cannot emit on Prisma 5.22.0. `npm run test:integration:prepare` runs `migrate deploy` for you.
