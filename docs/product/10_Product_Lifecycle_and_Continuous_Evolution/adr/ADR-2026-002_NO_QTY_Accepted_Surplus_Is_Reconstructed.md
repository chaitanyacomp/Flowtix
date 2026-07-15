# ADR-2026-002: NO_QTY Accepted Surplus Is Reconstructed

- Status: Accepted
- Date: 2026-07-15

## Decision

One backend service reconstructs accepted surplus from canonical QC, active locked RS demand, cycle-owned production, and locked dispatch records, scoped by SO + FG. Only the existing locked RS net-production snapshot is persisted; no manual allocation ledger is added.

Cumulative active demand consumes excess once while unused excess rolls forward. Dispatch caps physically remaining accepted FG. Cancelled versions, pending/rejected QC, unrelated opening stock, and other FG items are excluded.

## Consequences

Draft reads and lock-time calculation share the resolver, and locking recomputes transactionally. `totalRsQty` remains gross demand/recovery; `suggestedWoQtySnapshot` is the operational net quantity used by WO and workflow consumers. No migration, cleanup/reset registration, or backfill is required.
