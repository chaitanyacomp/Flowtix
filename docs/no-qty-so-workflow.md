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
- **6b)** On **Confirm Report** with shortfall **Carried Forward**: WO stays open until Store approves RM return; it leaves **Active Production** (editing locked) and appears under **Pending Store Tasks**. Further production for the shortfall is on the next WO/cycle — not by reopening the finalized WO. Residual planned − produced alone does not keep the WO in Active Production.
- **6c)** Pending Actions **Open Production Workspace** for a multi-WO Ready/Continue bucket opens the matching Workbench tab (`pwSection=ready` or `active`) without pinning a completed sibling WO/cycle. Single Ready focuses the card (`pwFocus`); single Continue opens the executable remaining-balance screen.
- **6d) Pause / Resume:** Partial production may leave an entry in Pending QC while the WO stays In Progress with remaining qty. Pause (reason required) → execution BLOCKED / Paused Production; Resume → same WO Active. Confirm Report & Close WO is the only production finalization; shortfall/CF only at that point.
- **6e) Planned Process Allowance:** Store enters **Add Qty** only; Allowance % is server-calculated from applicable BOM. Excess starts above applicable BOM + Add Qty. Above 5%–10% requires reason + async Admin approval (no stock until Store final issue). Theoretical RM already includes runner. Planned allowance is issue planning—not actual wastage—and is reconciled against actual wastage in the mandatory Production Report.
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

### Admin Requirement Sheet Cancel/Reopen policy

Cancel/Reopen here means cancelling a finalized (`LOCKED`) Requirement Sheet so the same open Sales Order and cycle can create a fresh, higher-version RS. It does not edit or delete the finalized RS; the cancelled record remains as audit history.

Only Admin may perform this recovery, and only when the RS has absolutely no downstream execution or references. The eligibility check must confirm all of the following:

- no Work Order of any status (including cancelled or closed history)
- no Material Issue or Material Return
- no Production or QC entry
- no Dispatch or Sales Bill
- no Stock Transaction attributable to those documents
- no Monthly Plan coverage/reference
- no Material Requirement, Purchase Request, RM Purchase Order, GRN, or other procurement document derived from the RS
- no other downstream reference to the RS or its lines

The validation evaluates the complete graph and returns every discovered blocker in one business response. Database/schema validation errors fail closed as `VALIDATION_FAILED`; they must never partially cancel the RS or surface as an unhandled Prisma exception.

When eligible, cancellation runs in one database transaction: the RS becomes `CANCELLED`, actor/time/reason are persisted, the activity audit log is written, and the SO/cycle becomes eligible for a fresh RS version. No downstream row is deleted, because eligibility guarantees that none exists. A cancelled RS is history and must not itself prevent creation of the replacement RS.

#### Store Pending Actions after Admin cancellation

For an open NO_QTY SO, active/executable RS resolution ignores every `CANCELLED` row. If the active required cycle has cancelled RS history but no non-cancelled `DRAFT` or `LOCKED` replacement, the canonical Store creation resolver returns `SAME_CYCLE_CANCELLED_REPLACEMENT`.

- Store Pending Actions emits exactly one **Create Requirement Sheet** action.
- The action deep-links to the NO_QTY RS creation workspace with the same `salesOrderId` and active `cycleId`.
- Creation uses `max(existing version) + 1`; cancelled versions remain unchanged in history.
- A replacement `DRAFT` or `LOCKED` RS suppresses the creation action, preventing duplicates.
- Cancellation never creates or advances to a new cycle. A new cycle is created only by the normal next-cycle lifecycle.
- Closed SO statuses never emit Create Requirement Sheet.

Sales Order “Next RS Ready” and Store Pending Actions consume the same canonical replacement resolution. They must agree on eligibility, target cycle, and target version.

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

#### 3) Total to Produce (planning / procurement / dispatch cap)
\[
totalToProduce = shortfallQty + newWoQty
\]
- `shortfallQty`: read-only carry-forward from prior cycle (auto)
- `newWoQty`: operator-entered new requirement for this cycle
- Persisted as `RequirementSheetLine.suggestedWoQtySnapshot` at lock
- Used by MPRS, period coverage, and per-cycle dispatch caps — **not** copied into WO line qty

#### 3b) WO executable qty (this cycle — production only)
\[
woExecutableQty = newWoQty
\]
- Persisted as `RequirementSheetLine.requirementQty`
- `WorkOrderLine.qty` is set from `requirementQty` only at RS lock / create-wo
- Prior-cycle unmet demand stays on the prior-cycle WO; new cycles get incremental WO qty

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
Billing is quantity-allocation based. One Sales Bill may reserve and bill partial quantities from multiple locked dispatches belonging to the same Sales Order and customer. Commercial invoice lines may aggregate compatible sources while dispatch-wise allocations remain traceable and protected from duplicate billing.

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

#### Monthly Plan
- **Allowed** only when an active `NO_QTY` SO, an eligible `LOCKED` Requirement Sheet for the selected active cycle/period, and uncovered RS-backed demand all exist.
- Initial and Additional plans remain linked to that RS/cycle. Manual FG additions, where enabled, are additions inside that valid plan context; they cannot create a standalone plan.
- REGULAR SO demand, Regular WO shortage, and orphan/empty drafts never activate Monthly Planning. Store Pending Actions hide drafts that no longer have an eligible NO_QTY/locked-RS context.

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

- **Final QC rejection / production shortage recovery (NO_QTY)**
  - Both create recovery sources. On the next Requirement Sheet they appear as **Pending Recovery** per FG item. Planner must **Keep** (add to RS Qty) or **Waive** (Store or Admin + reason) before lock. Neither type auto-adds. Check detail panel for source RS / Cycle / WO provenance.

- **Dispatch blocked even though stock exists**
  - cycle cap remaining is 0, or the item is not in the current cycle plan, or requirement sheet not locked.

- **Sales Bill not available**
  - there is no unbilled confirmed (LOCKED) dispatch quantity.

- **Closed No Qty SO shows only Reopen**
  - closed state is history-only; only Admin can reopen and start a new cycle.

---

### Key implementation touchpoints (for developers)
- Requirement shortfall + snapshots: `backend/src/routes/requirementSheets.js`
- Production/QC cycle locks + first-pass terminal SCRAP recovery: `backend/src/routes/production.js`
- Disposition terminal scrap recovery: `backend/src/routes/qcRejectedDispositions.js` → `appendTerminalQcScrapRecovery`
- Recovery engine: `backend/src/services/noQtyRecoveryService.js`
- NO_QTY dispatch caps + validation: `backend/src/routes/dispatch.js`
- Sales Bill dispatch-only eligibility: `backend/src/services/salesBillService.js` and `backend/src/routes/salesOrders.js` (unbilled summary)
- Tally export qty source + narration: `backend/src/services/salesBillTallyExportPayload.js`, `backend/src/services/salesBillTallyXml.js`

# QC-accepted surplus carry-forward (2026-07-15)

## Dispatch cap for accepted excess

NO_QTY dispatchable quantity is `min(remaining locked customer/cycle demand, remaining QC-accepted pool, free USABLE FG stock)`. Accepted FG above a completed customer obligation remains in USABLE stock, stays traceable to the SO + FG, and is eligible for the next-cycle accepted-surplus resolver. It is not an optional dispatch, dispatch queue item, closure blocker, or billing obligation. Draft creation and finalization enforce the same cap.

- RS customer demand and WO planned quantity are historical commitments and never change when production exceeds plan.
- Excess becomes eligible only after final QC acceptance. Pending and rejected quantities contribute zero.
- Per SO + FG, the canonical resolver reconstructs prior accepted quantity, active locked customer demand, and locked dispatch/consumption. Cancelled versions are excluded; the highest active locked version per cycle wins.
- Available excess is `min(max(accepted - demand, 0), max(accepted - dispatched, 0))`; current **Net Production Requirement** is:

  `max(Customer Demand + Kept Recovery − allocated Prior Accepted Excess, 0)`

- The UI shows a **single** final executable quantity column: **Net Production Requirement** (not a separate Final RS Qty).
- Customer Demand edits refresh Net Production Requirement immediately in the draft grid (live allocation preview). Save Draft and Finalize both persist demand and recalculate accepted surplus atomically; Finalize is blocked while the draft is marked dirty.
- Unused balance rolls through the cumulative formula. Suggested WO and monthly planning consume Net Production Requirement only.
- Unused excess when demand < available pool is retained for future cycles (example: demand 300, pool 500 → net 0, unused 200).
# Multi-WO independence

See [Production multi-WO canonical rule](PRODUCTION_MULTI_WO_CANONICAL_RULE.md). One RS FG/cycle may have multiple concurrent, independent WOs; a later sibling never carries forward or replaces an earlier sibling.

Partial production and Pending QC do not close a NO_QTY WO. With remaining quantity, Pause preserves the batch, moves the WO to Paused Production (operator leaves the runner), and Resume returns it to Continue Production. Equal/extra production (plan met within RM-supported cap) parks **Production Report Pending**. Only explicit **Confirm Report & Close WO** assesses return, actual wastage, shortfall, carry-forward, and closure. After close, the operator lands on the **card Production Workspace → Ready to Start** — never the obsolete Select Work Order / Work queue / Log production screen.

For a draft Production Entry, the remaining-balance decision occurs at **Review & Finalize**, before posting. Continue and Pause retain remaining quantity in the same WO/cycle and never open the Production Report. **End Production with Shortage**, equal completion, and approved extra completion all require the mandatory Production Report before close; shortage recovery (`PRODUCTION_SHORTFALL`) is emitted only on report-confirmed closure. Draft quantities never contribute to produced totals or recovery. RM report reconciliation remains separate from production-entry finalization and from QC.
# Production-end RM reconciliation clarification (2026-07)

Draft quantities are not finalized production. Continue and Pause preserve the unproduced balance in the same WO and RS cycle. **End Production with Shortage**, equal production, and extra production (within RM cap) all require confirmation of the mandatory Production Report before WO close. Only after that confirmation does shortage enter Keep/Waive / next-cycle recovery. The report does not wait for QC; QC remains entry-specific and independent. Unused RM-supported FG capacity is not wastage until the operator allocates actual RM in RM UOM.
