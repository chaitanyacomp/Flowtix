# Repair plan: legacy QC FG double-reject ledger

## Background

Until the application fix, `POST /api/production/qc-entries` posted two `QC` stock rows per inspection when `rejectedQty > 0`:

- `qtyIn = acceptedQty` (where `acceptedQty = checkedQty − rejectedQty`)
- `qtyOut = rejectedQty`

Because `acceptedQty` was already net of rejection, the `qtyOut` row **double-subtracted** rejects: **ledger net = acceptedQty − rejectedQty** instead of **acceptedQty**.

**Correct model:** only `qtyIn = acceptedQty` (no reject OUT). Usable FG stock was therefore understated by **sum(qtyOut)** on those `QC` rows for each active `QcEntry`.

## What counts as “affected”

A historical `QcEntry` is affected if:

1. `reversedAt` is **null** (not voided by QC reversal), and  
2. There exists at least one `StockTransaction` with `transactionType = QC` and `refId = QcEntry.id` whose **`qtyOut` sum > 0**.

New postings after the fix have **no** `QC` `qtyOut` rows for rejects, so they are **not** selected.

## Per-row correction math

| Field | Meaning |
|--------|--------|
| `acceptedQty`, `rejectedQty` | From `QcEntry` (unchanged) |
| **Wrong ledger effect** | `+acceptedQty IN` and `−Σ(qtyOut) OUT` → net `acceptedQty − Σ(qtyOut)` |
| **Correct ledger effect** | `+acceptedQty IN` only → net `acceptedQty` |
| **Correction qty** | `Σ(qtyOut)` on `QC` rows for that `refId` (typically equals `rejectedQty`) |

**Additive fix:** insert one `StockTransaction` per affected `QcEntry`:

- `transactionType = ADJUSTMENT`
- `itemId` = FG from the work order line
- `qtyIn = correctionQty`, `qtyOut = 0`
- `refId = QcEntry.id` (see idempotency below)

Original `QC` rows are **not** deleted or edited.

## Idempotency and safety

- **Convention:** `ADJUSTMENT` rows created by this script use **`refId = QcEntry.id`**. The normal admin UI adjustment uses **`refId = 0`**, so corrections are distinguishable.
- Before insert, the script looks for an existing `ADJUSTMENT` with the same `(refId, itemId)`. If found with matching `qtyIn`, status **SKIP_ALREADY_CORRECTED** — safe to re-run.
- If an `ADJUSTMENT` exists with a different `qtyIn` or with `qtyOut > 0`, the script **skips** and reports a conflict so you can resolve manually.

## How to run

From `backend/` (after `DATABASE_URL` is set and DB backup is taken):

```bash
# Preview (dry-run)
npm run repair:qc-fg-ledger

# Apply
npm run repair:qc-fg-ledger -- --apply
```

Or: `node scripts/repair-qc-fg-double-reject-ledger.js` / `... --apply`.

## Verification after correction

### Stock balance

- `GET /api/stock/summary` (or internal aggregation): for each FG `itemId` that had corrections, **on-hand should increase by the sum of correction** amounts for that item.
- Spot-check: `sum(qtyIn) − sum(qtyOut)` over `StockTransaction` for the item = expected **usable FG** (same as `getItemStockQty`).

### Dispatch availability

- Dispatch caps use **SO-line FIFO headroom** and **usable stock** from the same `StockTransaction` ledger. QC accepted rollups remain for tracking; after correcting FG stock, **dispatchable** is **min(line remaining, usable stock)**, and **SO line caps** still limit dispatch to ordered quantity (unchanged by this repair).

### Report totals

- **`QcEntry` rows are not modified** — accepted/rejected/pending QC metrics **unchanged**.
- **WO / production reports** that depend on **QC facts** (not raw stock) are unchanged.
- **Stock** reports and dashboards that use the ledger will show **higher FG** where the bug had understated it.

## What this does *not* touch

- Reversed QC (`reversedAt` set): excluded; legacy reversal already netted the old `QC` + `QC_REVERSAL` pair.
- Items with inconsistent `QC` stock rows (multiple `itemId` for one `refId`): skipped with a warning.

## Audit trail

Corrections appear as **`ADJUSTMENT`** lines in the stock ledger and in `/api/stock/adjustments` (admin). They can be cross-referenced to `QcEntry.id` via `refId`.
