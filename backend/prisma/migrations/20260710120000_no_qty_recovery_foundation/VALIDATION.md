# Batch 3A Migration Validation Report

**Migration:** `20260710120000_no_qty_recovery_foundation`  
**Date:** 2026-07-10  
**Scope:** Schema + backfill + terminal-status dual-read compatibility  
**Batch 3F re-validation:** 2026-07-10 (local `erp` @ localhost:3306)

## Automated checks

| Check | Result |
|-------|--------|
| `prisma migrate deploy` | **PASS** — applied `20260710120000_no_qty_recovery_foundation` |
| `prisma migrate status` | **PASS** — Database schema is up to date |
| Migration map unit tests | PASS |
| Reconciliation sample (live) | **PASS** — 0 exceptions on 1 CF source |
| `migrationIncomplete` count | **0** |

## Live backfill snapshot (Batch 3F)

| Metric | Value |
|--------|-------|
| CF sources | 1 × PRODUCTION_SHORTFALL / OPEN (sourceQty 75) |
| Recovery allocations | 0 |
| Waivers | 0 |
| NO_QTY SO statuses | 1 × IN_PROCESS (no residual MANUALLY_CLOSED) |
| RS line components | baseDemand 160000 · prodShortfall 75 · qcRecovery 0 · totalRs 160075 |

## Compatibility

- Legacy `CarryForwardPending.status` / `remainingQty` retained  
- Enum retains `MANUALLY_CLOSED` for dual-read / rollback window  
- App terminal guards accept `CLOSED_WITH_WAIVER`  
- Close-with-waiver writes `CLOSED_WITH_WAIVER`; complete close writes `COMPLETED`

## Risks

- Incomplete allocation reconstruction may still appear on larger historical datasets (`migrationIncomplete`)  
- Prisma client regenerate may need a process restart if `EPERM` locks the query engine DLL during `prisma generate`
