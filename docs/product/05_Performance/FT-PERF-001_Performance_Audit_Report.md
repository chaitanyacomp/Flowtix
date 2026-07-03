# FT-PERF-001 — Performance Audit Report

| Field | Value |
|-------|-------|
| **Status** | Batch 1 implemented; Batches 2–4 planned |
| **Date** | 2026-07-03 |
| **Rule** | No business-logic or workflow changes |

## Measurement added

### Backend (`PERF_LOG=1` or non-production)

- Middleware: `backend/src/middleware/performanceLogging.js`
- Logs per `/api/*` request: endpoint, duration ms, role, Prisma query count, response size, status
- Slow threshold: `PERF_SLOW_MS` (default 700 ms) → `console.warn`
- Pending actions service logs bucket timings: `normalizedMerge`, `monthlyPlan`, `supplemental`, `total`

### Frontend (dev or `localStorage erp:perfLog=1`)

- `frontend/src/lib/performanceTiming.ts` — page marks + API timing via `apiFetch`
- Marks: login page, login submit, login→dashboard ready, dashboard, pending-actions

---

## Audit table

| Page / API | Est. current (local) | Root cause | Fix | Risk | Status |
|------------|----------------------|------------|-----|------|--------|
| **Login submit** | 200–800 ms | `bcrypt.compare` + awaited audit write on success | Fire-and-forget success audit; separate dashboard data load | Low — audit still written | **Done** |
| **Login → dashboard shell** | 1.5–4 s | Large JS bundle (no route splitting); dashboard fan-out starts immediately | Perf marks added; defer pending-actions 150 ms on main dashboard | Low | **Partial** |
| **GET /api/dashboard/** (ADMIN) | 2–8 s | Loads all SOs + dispatch + lines; all RM/FG items; in-memory KPI loop | Batch 4: summary-only endpoint; indexes; `select` not `include` | Medium — needs careful parity | Planned |
| **Dashboard page (ADMIN)** | 3–10 s first load | 12–15 parallel API calls + up to 50× `no-qty-flow-state` | Batch 2: lazy NO_QTY flow-state; reduce poll scope | Low | Planned |
| **Dashboard (PURCHASE/QA)** | 2–5 s | Parent `DashboardPage` fetched widgets then child desk re-fetched same data | Skip parent widget fetch when dedicated desk renders | Low | **Done** |
| **GET /api/pending-actions** | 1.5–5 s | FULL control-tower merge (9 queue builders, unbounded rows) + sequential STORE supplemental | Parallel STORE supplemental fetches; bucket timing logs | Low | **Done** |
| **Dashboard pending count** | Same as full PA | Full pending-actions payload fetched for count only | Batch 1: deferred 150 ms; Batch 4: `?countOnly` lightweight path | Low | **Partial** |
| **Pending Actions page** | 1.5–5 s | Same heavy backend path; 60 s poll | `useStablePageLoad` dedup already present; perf marks added | Low | **Measured** |
| **Sales Bill edit** | 1–3 s | Bill + ship-to options + SO head sequential | Batch 2: parallel independent fetches | Low | Planned |
| **Production workspace** | 2–4 s | Multiple queue/report APIs on mount | Batch 2: lazy-load panels | Low | Planned |
| **Dispatch workspace** | 1–3 s | Backlog + masters | Batch 2 | Low | Planned |
| **Analysis / Reports** | 3–15 s | Reports load on page open before Search | Batch 3: route lazy + search-gated fetch | Low | Planned |
| **Initial JS bundle** | Large | ~90 pages static-imported in `App.tsx` | Batch 3: `React.lazy` for heavy workspaces | Low | Planned |
| **Cold Prisma/MySQL** | +100–300 ms first query | Connection pool on first request | Health check at startup already runs | None | OK |
| **45 s dashboard poll** | Repeats full fan-out | `useErpRefreshTick` on dashboard scope | Batch 2: poll counts/summaries only | Low | Planned |

---

## Batch plan

### Batch 1 — Login + dashboard + pending actions ✅

1. Backend request timing middleware + Prisma query counter  
2. Frontend `performanceTiming` + `apiFetch` duration logs  
3. Login success audit non-blocking  
4. PURCHASE/QA: skip duplicate dashboard widget API fan-out  
5. Defer dashboard pending-actions fetch 150 ms (shell renders first)  
6. STORE pending-actions supplemental queries parallelized  
7. Pending-actions bucket timing logs  

### Batch 2 — Workspaces (planned)

- Sales bill, dispatch, production: `Promise.all` for independent calls  
- Cap/defer NO_QTY per-SO flow-state fetches on dashboard  
- Narrow dashboard poll to changed sections  

### Batch 3 — Analysis + code splitting (planned)

- `React.lazy` for: Reports, Production, Dispatch, RM Control Center, Control Tower, Sales Bill edit  
- Reports: fetch only after Search  

### Batch 4 — DB + query cleanup (planned)

- Index review: `status`, `createdAt`, `salesOrderId`, `dispatchId`, `workOrderId`, export flags  
- Dashboard summary endpoint (counts/KPIs only)  
- Pending-actions count-only mode  
- Replace heavy `include` chains with `select`  

---

## Acceptance targets (local)

| Target | Current (est.) | After Batch 1 |
|--------|----------------|---------------|
| Login → dashboard shell | 1.5–4 s | Improved (audit + defer PA) |
| Dashboard summary | 2–8 s (ADMIN) | Unchanged for ADMIN; PURCHASE/QA faster |
| Pending Actions count | 1.5–5 s | Same backend cost; deferred on dashboard |
| Pending Actions details | 1.5–5 s | STORE supplemental faster |
| Normal workspace | 2–4 s | Batch 2 |
| Reports | On-open load | Batch 3 |

---

## How to measure

```bash
# Backend — watch [perf] lines in dev console
cd backend && npm run dev

# Frontend — open DevTools console, filter [perf:fe]
cd frontend && npm run dev

# Enable perf logs in production build preview
localStorage.setItem("erp:perfLog", "1")
```

```bash
# Force backend perf logs in production
PERF_LOG=1 PERF_SLOW_MS=500 npm start
```

---

## Notes

- No workflow, billing, export, or pending-actions **rules** were changed.  
- `meta.perf` on pending-actions response is additive diagnostics only.  
- Payment tracking hide (FT-WF-024) unaffected.
