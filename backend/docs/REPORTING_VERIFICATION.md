# Reporting verification checklist

Use this after changes to dispatch allocation, `reportMetrics`, dashboard queue builders, or operations-exception logic. Run `npm test` in `backend` (unit: `reporting-formulas.test.js`, `regression-guardrails.test.js`). Optional DB integration: see **`docs/INTEGRATION_TEST_DB.md`** (`ERP_RUN_DB_INTEGRATION=1`, optional `INTEGRATION_DATABASE_URL`, `npm run test:integration:prepare` on an empty DB).

## Scenario matrix

| Scenario | Automated (unit) | Notes |
|----------|------------------|--------|
| SO, one FG line, partial dispatch | Partial | FIFO + `remainingDispatchCapacityForSoItem`; full E2E not in suite |
| Duplicate FG across multiple SO lines | **Pass** | `salesOrderDispatchAllocation` — no double subtraction |
| Duplicate FG + partial dispatch, SO-line FIFO | **Pass** | Same suite + `computeSalesOrderDispatchLineStats` totals |
| WO linked to SO, partial production | Partial | WO FIFO dispatch test uses line `acceptedQty`; production pending not DB-backed in tests |
| QC partial accept / reject | **Pass** | QC batch pending formula |
| Dispatch-ready = SO FIFO × min(usable, QC pool when SO+item has QC) | **Pass** | `buildDispatchableQtyBySalesOrderLineId` / `getSoItemDispatchableReadyQty`; aligns with WO guard |
| FG usable high but QC pool low | **Pass** | Shared ship cap; WO not blocked by usable alone when dispatch-ready < pending SO |
| SO totals vs WO-line pending (both correct) | Partial | Row-level `quantityContexts` not asserted; WO vs SO FIFO numerics covered |
| Reversal / undo in dispatch ledger | **Pass** | `netDispatchedByItemId` negative lines |
| Draft SO edit, per-item qty sum valid | Not covered | Validated in routes; add test if `salesOrders` helpers are extracted |

## What the tests assert

- `backend/test/reporting-formulas.test.js` — `salesOrderDispatchAllocation`, `reportMetrics` dispatchable/QC pool, WO FIFO vs SO FIFO, QC pending, `computeWorkOrderTrackingSummaryFromRows` / `assertWorkOrderTrackingSummaryMatches`, `operationsExceptionClassification`, `computeSalesOrderDispatchLineStats`.
- `backend/test/regression-guardrails.test.js` — draft SO floor helper, WO summary contract, dashboard context map, exception builders, reversal math.
- `backend/test/integration/erp-flows.integration.test.js` — draft SO PUT/PATCH, work-order-tracking, dashboard queues, operations-exceptions, dispatch sales-orders (seeded Prisma + supertest).

## API consumers (frontend)

| Endpoint | Consumers |
|----------|-----------|
| `GET /api/reports/work-order-tracking` | `WorkOrderTrackingReportPage` (+ `normalizeWoTrackingApiResponse` for legacy array) |
| `GET /api/reports/operations-exceptions` | `OperationsExceptionReportPage` |
| `GET /api/dashboard` (+ queue subroutes) | `DashboardPage`, `ReportsPage`, `RMShortageReportPage` |
| `GET /api/dispatch/sales-orders` | `DispatchPage` |

## Gaps / follow-ups

- Integration suite does not cover `POST /api/dispatch/dispatches` / `POST /api/dispatch/reverse` (read-only GET assertions on ledger + `maxReversibleQty`).
- `GET /api/dashboard` aggregates are only lightly asserted (`pendingDispatchCount` consistency with backlog presence); not every strip is numerically pinned to seed data.
- Legacy databases missing `Dispatch.reversalOfId` must be migrated before integration hooks can insert dispatch rows.

## Breaking changes to document

- Work-order-tracking response is `{ rows, summary, ... }`. Older clients sending/receiving a bare array should use `normalizeWoTrackingApiResponse` (frontend) or migrate to the object shape. Backend contract is not weakened.
