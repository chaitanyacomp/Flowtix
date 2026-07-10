# Batch 3A Migration Validation Report

**Migration:** `20260710120000_no_qty_recovery_foundation`  
**Date:** 2026-07-10  
**Scope:** Schema + backfill + terminal-status dual-read compatibility (no recovery engine)

## Automated checks

| Check | Result |
|-------|--------|
| `prisma validate` | PASS |
| `prisma generate` | PASS |
| Migration map unit tests | PASS (9) |
| CF / production execution unit tests | PASS |
| Close eligibility / operational auto-close unit tests | PASS (run with Batch 3A) |
| Live `prisma migrate deploy` | **Pending** on target DB |

## Backfill coverage

1. CF `sourceQty`, `recoveryType`, `recoveryStatus`, provenance  
2. Duplicate provenance → `migrationIncomplete`  
3. RS line quantity components  
4. `MANUALLY_CLOSED` → `CLOSED_WITH_WAIVER`  
5. Best-effort `RecoveryAllocation` for CONSUMED+target RS  
6. New empty tables: Waiver, WaiverLine, AcceptedFgDisposition  

## Compatibility

- Legacy `CarryForwardPending.status` / `remainingQty` retained  
- Enum retains `MANUALLY_CLOSED`  
- App terminal guards updated to accept `CLOSED_WITH_WAIVER`  
- `POST /close` now writes `CLOSED_WITH_WAIVER`  

## Risks

- Incomplete allocation reconstruction for some CONSUMED rows  
- Live migrate not executed in this environment  
- Rollback requires careful reverse of enum/data (see migration comments)  
