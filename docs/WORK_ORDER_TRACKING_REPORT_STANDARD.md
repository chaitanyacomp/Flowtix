# Work Order Tracking Report Standard

**Status:** Authoritative for `GET /api/reports/work-order-tracking` and `WorkOrderTrackingReportPage`  
**Updated:** 2026-07-16

This report is a **single** operational surface with a **required Work Order Flow** selector. Regular and NO_QTY work orders are never mixed in one grid.

---

## 1. Flow selector (required)

| Value | API `flow` | Meaning |
|-------|------------|---------|
| Regular Sales Orders | `REGULAR` | All non-`NO_QTY` sales orders (`NORMAL`, `REPLACEMENT`, …) |
| NO_QTY Sales Orders | `NO_QTY` | `SalesOrder.orderType === NO_QTY` only |

Missing/invalid `flow` → HTTP 400 (`VALIDATION`).

---

## 2. WO Status filter

| UI | API | Default |
|----|-----|---------|
| Active Only | `includeClosed` omitted / false | **Yes** |
| Include Closed | `includeClosed=true` | Optional |

**Active Only**

- **REGULAR:** hide WOs that are production-operationally closed (`COMPLETED`, `REJECTED`, `CLOSED_WITH_SHORTFALL`, etc. via `workOrderOperationalStatus`).
- **NO_QTY:** also hide closed SO statuses (`COMPLETED`, `CLOSED`, `MANUALLY_CLOSED`, `CLOSED_WITH_WAIVER`) and closed cycles (`SalesOrderCycle.status === CLOSED`), plus operationally closed WOs.

---

## 3. Regular Work Order Tracking

### Columns

SO No · Customer · WO No · Item · **Ordered Qty** · Required · Planned · Produced · Accepted · Rejected · Dispatched · Production Pending · QC Pending · Dispatch Pending · Status

### Business rules

| Field | Rule |
|-------|------|
| Ordered Qty | Sum of `SalesOrderLine.qty` for the FG on the SO |
| Required | `WorkOrderLine.qty` |
| Planned | `WorkOrderLine.plannedQty` |
| Produced / Accepted / Rejected | APPROVED production + active QC |
| Dispatched | WO-line FIFO share of SO+item confirmed dispatch (presentation) |
| Production Pending | `max(0, Required − Produced)` |
| Dispatch Pending | `max(0, Accepted − WO-FIFO dispatched)` |
| Status | Quantity stage gate (`deriveWoTrackingOperationalStatus`) |

### Empty state

`No Regular Sales Order work orders found for the selected filters.`

---

## 4. NO_QTY Work Order Tracking

### Columns

SO No · Customer · WO No · Item · **RS No** · **Cycle** · **Customer Demand** · Required · Planned · Produced · Accepted · Rejected · Dispatched · **Active Production Pending** · QC Pending · **Active Dispatch Pending** · **Recovery / Carry Forward** · Status

**Do not show Ordered Qty.**

### Customer Demand

Source: locked RS line `baseDemandQty`, fallback `requirementQty` (`RequirementSheetLine.itemId` = FG).

Never use: WO qty, Planned, Recovery, Carry-forward, Produced.

### Active Production Pending

Reuse `getEffectiveProductionPendingQty` when the WO is still operationally open.

**= 0** when any of:

- SO closed (`COMPLETED` / `CLOSED` / `MANUALLY_CLOSED` / `CLOSED_WITH_WAIVER`)
- Cycle closed (`CLOSED`)
- WO terminal (`COMPLETED` / `REJECTED` / `CLOSED_WITH_SHORTFALL`)
- Execution `COMPLETED` or `SHORTFALL_PENDING`

Shortage moved to the next cycle must not remain pending on the previous WO. Never reopen history via Planned − Produced after closure.

### Active Dispatch Pending

Dispatch belongs to **SO + FG (+ cycle)**, not WO.

- Remaining = locked RS cycle cap − cycle LOCKED net dispatch (same cap idea as `assessNoQtyCycleDispatchCapMet`)
- **= 0** when SO closed or cycle closed
- Never invent pending from Accepted − WO FIFO

### Recovery / Carry Forward

Label from `enrichSalesOrdersWithRecoveryClosure` / recovery summary (KEEP / WAIVE / OPEN / NONE).

### Status

Workflow-aware (`deriveNoQtyTrackingStatus`): closed SO/cycle/terminal WO → `COMPLETED`; otherwise Active Production / QC / Active Dispatch gates; `SHORTFALL_PENDING` when execution awaits shortfall decision.

### Empty state

`No active NO_QTY work orders found for the selected filters.`  
(With Include Closed: `No NO_QTY work orders found for the selected filters.`)

---

## 5. Implementation map

| Layer | Location |
|-------|----------|
| Service | `backend/src/services/workOrderTrackingReportService.js` |
| Route | `GET /api/reports/work-order-tracking` in `backend/src/routes/reports.js` |
| UI | `frontend/src/pages/WorkOrderTrackingReportPage.tsx` |
| UI helpers (presentation only) | `frontend/src/lib/woTrackingReportUi.ts` |
| Types | `frontend/src/lib/woTrackingResponse.ts` |
| Tests | `backend/test/unit/workOrderTrackingReportService.test.js`, `frontend/test/unit/woTrackingFlowReport.test.ts`, `frontend/test/unit/woTrackingReportUi.test.ts` |

Canonical reuse: `productionExecutionService.getEffectiveProductionPendingQty`, `workOrderOperationalStatus`, `noQtyRecoveryAnalyticsService.enrichSalesOrdersWithRecoveryClosure`, cycle dispatch net via `netDispatchedByItemId`, Regular helpers in `reportMetrics.js`.

---

## 6. UI / UX workbench (presentation only)

Business metrics and APIs are unchanged. The page is an **Operational** report under [FT-PD-066](./product/06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md) §17.7 Report Grid & Analytics UX Standard (grid/density reference). **Page shell / ReportChrome layout** follows §17.15 — shared `ReportPageShell` with the same max width, margins, and chrome as **Production Wastage — WO Analysis** (canonical ReportChrome reference). Optimized for 1366×768 without horizontal scroll.

### Filter toolbar (single row)

| Control | Behavior |
|---------|----------|
| **Flow** | Dropdown: Regular / NO_QTY (required; never mixed) |
| **Status** | Open / Closed / All (maps to `includeClosed` + client scope filter) |
| Customer | Optional text filter |
| Date From / To | Optional |
| Search | Optional free text |
| Clear | Resets filters to defaults |

No large radio blocks for flow or Active/Include Closed.

### KPI strip

| Flow | KPIs |
|------|------|
| **NO_QTY** | Open WOs · Open Cycles · Active Production Pending · Carry Forward Qty · Recovery Pending |
| **Regular** | Open WOs · Pending Production · Pending QC · Pending Dispatch |

### Default table columns (NO_QTY)

SO (customer as subtitle) → RS / Cycle → WO → Item → Customer Demand → Production → QC → Dispatch → Recovery → Status

- **No duplicate Customer column.** Demand is its own column, not nested under Customer.
- **Progress blocks:** e.g. Production `1905 / 2000` (produced / planned); Dispatch similarly compact.
- **Recovery:** colored badge (`Carry Forward` / `Keep` / `Waived` / `None`). Click opens a compact modal with shortfall / keep / waive / allocated detail.
- **Status:** single colored badge (e.g. Pending Production, In Production, Carry Forward, Cycle Closed, SO Closed).
- **Row expand:** Required, Planned, Accepted, Rejected, Active Dispatch Pending, recovery text, context — secondary detail only.

Regular flow uses Ordered Qty instead of Customer Demand / Recovery, with the same progress + expand pattern.

### Density

Compact ERP table (`table-fixed`), tighter padding, existing badges/modals. Target: no horizontal scroll at 1366×768 during normal operation.

---

## 7. Test scenarios (must stay green)

1. Regular open WO  
2. Regular completed WO  
3. NO_QTY active WO  
4. NO_QTY carried-forward shortage (execution COMPLETED → active prod pending 0)  
5. Recovery Keep label  
6. Recovery Waive label  
7. Closed RS cycle  
8. Closed NO_QTY SO  
9. Multiple WOs same FG  
10. SO+item dispatch must not create false WO FIFO pending  
11. Customer Demand source  
12. Flow dropdown / Status Open·Closed·All  
13. UI: no horizontal scroll @ 1366×768; recovery badge → modal; row expand  

---

## 8. Related docs

- `docs/product/06_UI_and_Experience_Architecture/Chapter_06_Reports_and_Analytical_Surfaces.md`
- `docs/product/06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md` (§ report workbench density)
- `backend/docs/REPORTING_VERIFICATION.md`
- `docs/UAT_REGRESSION_PACKAGE.md`
- NO_QTY closure SSOT: `noQtySoClosureService.assessNoQtySoClosure`
