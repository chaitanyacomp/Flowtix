## No Qty Sales Order (NO_QTY) — Workflow, Rules, and Support Notes

This document describes the **NO_QTY Sales Order** workflow only.

- **Scope**: applies only when `SalesOrder.orderType === "NO_QTY"`.
- **Non-scope**: Regular Sales Orders (`NORMAL`, `REPLACEMENT`) keep their existing behavior and validations.

### Operator workflow (training summary)
- **1)** Create / select **No Qty SO**
- **2)** Open **Requirement Sheet**
- **3)** Enter **New WO qty** (shortfall is auto-filled when applicable)
- **4)** **Lock Requirement Sheet**
- **5)** Create **Work Order** from the locked Requirement Sheet
- **6)** Record **Production**, then approve the batch
- **7)** Record **QC** until the relevant qty is finalized
- **8)** Do **Dispatch** (only usable QC-passed stock, within cycle cap)
- **9)** Create **Sales Bill** from confirmed dispatch
- **10)** **Export Sales Bill to Tally**
- **11)** Close SO when completed; **Reopen** (Admin only) if a new cycle is needed

---

### Stages (No Qty SO)
Stages shown on Sales Order list (No Qty mode):
- Closed
- Requirement Pending
- Requirement In Progress
- Ready for Production
- Production In Progress
- QC In Progress
- Ready for Dispatch
- Partly Dispatched
- Ready for Sales Bill

**Stage priority order** (highest wins):
- Closed
- Ready for Sales Bill
- Ready for Dispatch
- Partly Dispatched
- QC In Progress
- Production In Progress
- Ready for Production
- Requirement In Progress
- Requirement Pending

---

### Internal cycle model (reopen behavior)
NO_QTY runs in internal cycles to preserve history.

- **One active cycle at a time**
- **Reopen (Admin-only)**:
  - requires a mandatory reason
  - creates a **new cycle** (`cycleNo = last + 1`, status `ACTIVE`)
  - sets `SalesOrder.currentCycleId` to the new cycle
  - keeps all previous cycles **locked / history-only**

---

### Formulas (exact)

#### 1) Shortfall (previous cycles only; after QC finalization)
\[
shortfall = \max(0,\ \text{WO Qty} - \text{QC Passed Qty})
\]
- **WO Qty**: WorkOrderLine planned/target qty for the previous cycle
- **QC Passed Qty**: sum of active QC accepted qty for that WO line
- **Only after QC finalization** (no pending QC for the produced qty)

#### 2) Adjusted shortfall (stock-aware)
\[
adjustedShortfall = \max(0,\ shortfall - usableQcPassedStock)
\]
- `usableQcPassedStock`: usable FG stock for the SKU (USABLE bucket)

#### 3) Total WO qty (per Requirement Sheet row / per cycle)
\[
totalWoQty = shortfallQty + newWoQty
\]
- `shortfallQty`: read-only (auto)
- `newWoQty`: operator-entered (editable)

#### 4) Dispatchable qty (NO_QTY; per item; current cycle only)
\[
dispatchableQty = \min(usableQcPassedQtyAvailableForDispatch,\ cycleCapRemaining)
\]
Where:
- `usableQcPassedQtyAvailableForDispatch` = usable FG stock (USABLE bucket) still available
- `cycleCapRemaining = cycleCap - netDispatchedInCycle`
- `cycleCap` comes from the **locked Requirement Sheet Total WO qty**

#### 5) Billable qty (dispatch-driven only)
\[
billableQty = validDispatchedQty - alreadyBilledQty
\]
Phase-1 system is **dispatch-wise billing** (1 dispatch → 1 bill), so bill eligibility is based on **unbilled confirmed dispatch**.

#### 6) Export qty (Tally)
\[
exportQty = billedDispatchQty
\]
Export uses **SalesBillLine.qty** (dispatch-derived) only.

---

### Entry locks (what blocks what)

#### Requirement Sheet
- **Allowed**: NO_QTY SO open
- **Blocked**:
  - SO closed (history-only)

#### Production + QC
- **Allowed** only when:
  - Work Order belongs to the **current cycle**
  - Requirement Sheet for current cycle is **LOCKED**
  - SO is not closed
- **Blocked message** (typical):
  - “Requirement Sheet must be locked before production.”
  - “This work order/production batch does not belong to the current active cycle.”

#### Dispatch
- **Allowed** only when:
  - active cycle exists
  - current cycle Requirement Sheet is locked
  - item is in current cycle plan
  - dispatchableQty > 0
  - usable stock exists
- **Blocked message** (typical):
  - “Dispatch exceeds current cycle allowed quantity.”
  - “Usable QC-passed stock is not available.”

#### Sales Bill
- **Allowed** only when unbilled confirmed dispatch exists.
- **Not allowed** when only WO/Production/QC exists but no dispatch.

---

### Troubleshooting (support quick answers)

- **Production button / create production fails**
  - Requirement Sheet is not locked, or WO is not in current cycle.

- **Shortfall didn’t appear**
  - QC is not finalized for the relevant produced qty yet (pending QC exists), so shortfall is deferred.

- **Dispatch blocked even though stock exists**
  - cycle cap remaining is 0, or the item is not in the current cycle plan, or requirement sheet not locked.

- **Sales Bill not available**
  - there is no unbilled confirmed (LOCKED) dispatch quantity.

- **Closed No Qty SO shows only Reopen**
  - closed state is history-only; only Admin can reopen and start a new cycle.

---

### Key implementation touchpoints (for developers)
- Requirement shortfall + snapshots: `backend/src/routes/requirementSheets.js`
- Production/QC cycle locks: `backend/src/routes/production.js`
- NO_QTY dispatch caps + validation: `backend/src/routes/dispatch.js`
- Sales Bill dispatch-only eligibility: `backend/src/services/salesBillService.js` and `backend/src/routes/salesOrders.js` (unbilled summary)
- Tally export qty source + narration: `backend/src/services/salesBillTallyExportPayload.js`, `backend/src/services/salesBillTallyXml.js`

