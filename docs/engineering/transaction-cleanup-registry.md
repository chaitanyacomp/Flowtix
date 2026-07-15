# Transaction Cleanup Registry

**Owner:** Engineering / Admin tooling  
**SSOT code:** `backend/src/services/cleanup/cleanupRegistry.js`

## Purpose

Prevent new Prisma models / Restrict FKs from silently breaking Admin reset tools.

## Design

| Piece | Role |
|-------|------|
| `cleanupRegistry.js` | Canonical list of transactional models: phase/order, parent deps, master preservation |
| `noQtyRecoveryCleanupService.js` | Executes the recovery cluster in registry order (all reset entry points) |
| `cleanupDependencyValidator.js` | Parses `schema.prisma` Restrict FKs; fails if a child is missing or ordered after its parent |
| `verify-cleanup-dependencies.js` | CLI / CI diagnostic |

## CarryForwardPending FK graph (blocking children)

| Child | FK field | Must delete before CFP |
|-------|----------|------------------------|
| `NoQtyRsItemRecoveryDecisionLine` | `recoverySourceId` | Yes |
| `RecoveryAllocation` | `recoverySourceId` | Yes |
| `NoQtySoWaiverLine` | `recoverySourceId` | Yes |

## Entry points (all use the same recovery helper)

- Reset Transaction Data (`runResetTransactionDataInTransaction`)
- Reset NO_QTY Data (`applyNoQtyRecoveryDependencyCleanup` scoped)
- Full Demo Reset
- MPRS Test Reset
- `scripts/resetTransactions.js`

## Developer commands

```bash
cd backend
npm run verify:cleanup-dependencies
npm run test:cleanup
npm run reset:transactions   # destructive — local/dev only
```

When adding a migration that introduces a transactional table or Restrict FK to a transactional parent, update `cleanupRegistry.js` until verification passes.
