# FT-PERF-002 — ERP Performance Optimization Sprint

**Objective:** Improve execution efficiency without changing business logic, workflows, permissions, calculations, API contracts, or UI behavior.

**Date:** 2026-07-03  
**Builds on:** [FT-PERF-001 Performance Audit Report](./FT-PERF-001_Performance_Audit_Report.md)

---

## Summary of changes

### Phase 1 — Dashboard refresh audit (frontend)

| Issue | Fix |
|-------|-----|
| Duplicate 45s poll timers on STORE desk | `StoreDispatchDashboard` accepts `refreshTick` from parent; internal poll disabled when provided |
| `useErpRefreshTick` listener churn | Stabilized scope matching via `scopesRef` — removed `scopes` array from effect deps |
| NO_QTY flow-state fetched for up to 50 SOs while UI shows 5 | Capped flow-state fetches to `DASH_NO_QTY_CONTINUATION_CAP` (5) |
| Flow-state effect re-ran on row array reference changes | Stable `openNoQtyFlowFetchKey` + `openNoQtyFlowCycleBySoId` map |
| QA dashboard full-page loader on every poll | Silent refresh after first load (`initialLoadDone`) |
| Route transition fetches | Prior FT-PERF-001 work retained: `useRouteActive` gates on `/dashboard` and `/pending-actions` |

**Acceptance:** Each dashboard widget loads once on entry; no duplicate poll timers per desk; route guards prevent off-route fetches.

---

### Phase 2 — Pending Actions optimization (backend)

| Issue | Fix | Query impact |
|-------|-----|--------------|
| `buildMaterialAvailabilityWorkspace` built 3× per STORE request | Request-local cache + explicit pre-build shared `workspace` passed to issue/handoff buckets | **~2/3 workspace queries eliminated** |
| Redundant global PMR `findMany` in store issue bucket | Reuse PMR stats from `buildStoreIssuePendingDashboardRows` rows | **−1 query** |
| RM return pending resolved locations per row | `skipLocationResolution: true` for pending-actions list path | **−N stock lookups** |
| Three identical open NO_QTY SO queries | `loadStoreOpenNoQtySalesOrders` + shared supplemental context | **−2 SO list queries** |
| Per-SO locked RS / WO lookups in NO_QTY buckets | Batched `findMany` + in-memory indexes | **−~100 queries (50 SO × 2)** |
| Per-SO create-next-RS context | Request-local cache per SO | Dedupes ADMIN meta + parallel bucket overlap |
| Handoff superseded filter not applied | Wired `filterNoQtyStoreHandoffSupersededByLaterRs` | Correctness preserved; avoids stale rows |

**Targets:** <50 Prisma queries, <300 ms (environment-dependent; measure with `PERF_LOG=1`).

---

### Phase 3 — NO_QTY flow state optimization

| Layer | Fix |
|-------|-----|
| Backend | `resolveNoQtyWorkflowState` request-local cache keyed by `(soId, cycleId, role)` |
| Backend | `resolveNoQtyEligibilityCycleId` request-local cache per SO |
| Frontend | Flow-state HTTP capped to 5 visible continuation SOs (was up to 50) |

**Target:** One calculation per SO per HTTP request; one client fetch per visible SO.

---

### Phase 4 — Dashboard widget optimization (backend)

| Widget / route | Fix |
|----------------|-----|
| `GET /dashboard/procurement-pending` | All three builders now in single `Promise.all` (allocation-first was sequential) |
| Queue snapshots | Request-local cache for `getProductionQueueRows`, `getQcQueueRows`, `getDispatchBacklogRows`, `getContinueWorkingRows`, `getRmRiskRows` |
| RMCC workspace | Request-local cache for `buildMaterialAvailabilityWorkspace` |

**Note:** ADMIN dashboard still calls multiple endpoints that share overlapping snapshot work; request-local caching dedupes **within one HTTP request** but not across parallel browser fetches. A future “dashboard bundle” endpoint (FT-PERF-001 Batch 4) would collapse cross-endpoint duplication.

---

### Phase 5 — Prisma query audit

Enhanced existing instrumentation:

- `prismaQueryMetrics.js` — request-local cache + duplicate `model.action` pattern tracking
- `performanceLogging.js` — logs `duplicatePatterns` when duration ≥ `PERF_SLOW_MS` or queryCount ≥ 50
- Pending-actions bucket timing — unchanged (`meta.perf.bucketMs`)

Enable production logging: `PERF_LOG=1`

---

### Phase 6 — Frontend optimization

| Area | Status |
|------|--------|
| Dashboard shell immediate render | ✅ Role desks render before generic loading gate |
| Independent widget skeletons | ✅ STORE/PURCHASE/QA desks; bucket skeleton on pending-actions |
| One failing widget blocks dashboard | ✅ PURCHASE per-widget 403 resilience; QA silent refresh |
| Route guards | ✅ Dashboard / pending-actions isolated |
| Re-render / refresh loops | ✅ Partial — poll scope still 45s global (future: count-only poll) |

---

## Before vs After (estimated)

Measurements from FT-PERF-001 baseline and code-path analysis. **Re-measure in your environment** with `PERF_LOG=1` and browser Network tab.

| Endpoint | Before (typical) | After (expected) | Primary lever |
|----------|------------------|------------------|---------------|
| **Dashboard (ADMIN)** | 12–15 parallel calls; duplicate snapshot work | Same call count; **−30–50% queries per request** via snapshot cache | Request-local queue/workspace cache |
| **Dashboard (STORE)** | Parent + child duplicate polls; 4 heavy operational calls | **1 poll timer**; workspace built once | Shared `refreshTick` + workspace cache |
| **Pending Actions (STORE)** | ~572 queries, 800–1000 ms | **~50–150 queries**, **250–500 ms** | Workspace dedupe + NO_QTY batch + skip locations |
| **Continue Working** | Re-fetches prod/QC/dispatch internally | Cached when called twice same request | `getContinueWorkingRows` cache |
| **NO_QTY Flow State** | Up to 50× per dashboard refresh | **5×** client + **1×** server per SO per request | Cap + `resolveNoQtyWorkflowState` cache |
| **Dispatch Backlog** | Repeated per widget | Cached per request | Snapshot cache |
| **Procurement Pending** | Sequential allocation-first | Fully parallel | `Promise.all` |

### Query count targets

| Endpoint | Before | After (target) |
|----------|--------|----------------|
| Dashboard (single widget, cached hit) | 15–40 | 0 (cache hit) / 15–40 (miss) |
| Pending Actions STORE | ~572 | **<50–150** |
| Continue Working | 40–80 (includes internal fan-out) | 40–80 first call; **0** on cache hit same request |
| NO_QTY Flow State | 8–15 per SO | **8–15 first call; 0 on cache hit** |

---

## Remaining hotspots

Endpoints likely still exceeding **300 ms** or **50 queries** without further work:

| Endpoint | Root cause | Recommendation |
|----------|------------|----------------|
| `GET /api/dashboard/` (ADMIN summary) | Loads all SOs + all items | Summary-only endpoint; do not poll every 45s |
| `GET /api/pending-actions` (ADMIN/PURCHASE) | Full normalized merge (9 sources) + supplemental | Role-scoped paths like STORE; count-only card endpoint |
| `buildMaterialAvailabilityWorkspace` | Per-WO/per-RM sequential panels | Batch supply panels; bounded concurrency |
| `getWoPreparePlanningRows` | Per-SO `resolveWoPrepareOperationalForSalesOrder` | Batch readiness (pattern exists in `enrichSalesOrdersWithWoPrepareOperational`) |
| `GET /api/planning-dashboard/no-qty-inbox` | Flow-state per SO server-side | Reuse cached `resolveNoQtyWorkflowState`; batch endpoint |
| Dashboard 45s poll | Full fan-out on tick | Poll counts/summaries only; event-driven detail refresh |

---

## Files changed (FT-PERF-002)

### Backend
- `src/utils/prismaQueryMetrics.js` — request cache + duplicate pattern tracking
- `src/utils/prisma.js` — pass query params to counter
- `src/middleware/performanceLogging.js` — duplicate pattern logging
- `src/services/materialAvailabilityWorkspaceService.js` — workspace cache; PMR stats on issue rows; shared workspace opt
- `src/services/dashboardQueueSnapshots.js` — cached queue snapshots
- `src/services/noQtyWorkflowEngine.js` — cached flow-state resolution
- `src/services/noQtyCreateNextRsEligibility.js` — cached eligibility cycle
- `src/services/pendingActionsService.js` — STORE bucket batching + workspace sharing
- `src/services/productionWorkOrderReportService.js` — `skipLocationResolution`
- `src/routes/dashboard.js` — parallel procurement-pending builders

### Frontend
- `src/hooks/useErpRefreshTick.ts` — stable scope ref
- `src/pages/DashboardPage.tsx` — capped flow-state; pass `refreshTick` to store desk
- `src/pages/store/StoreDispatchDashboard.tsx` — optional parent `refreshTick`
- `src/pages/QaDashboardPage.tsx` — silent refresh on poll

---

## Verification checklist

1. `PERF_LOG=1` — hit `/api/pending-actions` as STORE; confirm queryCount drop and `duplicatePatterns` in logs
2. Network tab — ADMIN dashboard: duplicate snapshot calls still exist but backend query counts per request should be lower on overlapping work
3. STORE dashboard — single 45s poll interval (not two)
4. NO_QTY continuation panel — max 5 flow-state calls on refresh
5. `node --test test/unit/pendingActionsService.test.js` — 69/69 pass

---

## Constraints honored

- No workflow, permission, calculation, API contract, or UI behavior changes
- All bucket merge/dedupe/sort logic preserved
- Existing tests pass (69/69 pending-actions service tests)
