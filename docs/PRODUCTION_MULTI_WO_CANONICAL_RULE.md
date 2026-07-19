# Production multi-WO canonical rule

One Requirement Sheet FG and cycle may own multiple concurrent Work Orders. Each WO is an independent execution batch: creating, producing, pausing, resuming, sending to QA, finalizing, or closing one WO must not mutate or advance a sibling.

## Production eligibility

A WO is Active/Ready when it is released, not paused, not terminal, its execution is neither completed nor awaiting a final shortfall decision, and the production-entry gate says it can accept production. WO ordering, a higher database id, another WO for the FG, RS remaining quantity, and current-cycle ownership are not terminal evidence.

Carried Forward requires authoritative finalization evidence: a finalized production report/shortfall decision for that WO and a later-cycle continuation. A same-cycle sibling is never carry-forward evidence.

## Orthogonal production state

WO execution, remaining FG quantity, Production Entry QC, RM disposition, and the final Production Report are separate axes. Finalizing a production entry is **not** closing the Work Order. A finalized batch may be Pending QC while its WO is Running, Paused, Production Report Pending, or (after report confirmation) Completed. Example: a 3,000-unit finalized entry may be Pending QC while a 5,000-unit WO remains Continue Production with 2,000 remaining — or, after Pause, under Paused Production with the same remaining balance. Dashboard, Pending Actions, Production Workbench, and the process screen must use the same canonical workbench state. Pause blocks entry and finalization on that WO; Resume restores the same WO to Continue Production without changing prior entries, QC, RM consumption, or audit history. Pending QC must not automatically pause, close, or hide a still-executable WO.

Workbench queues: Ready to Start · Continue Production · Paused Production · **Production Report Pending** · Pending QA/QC · Awaiting Store Approval · Recent Entries. Report-pending WOs are not QC-only cards. Recent Entries default to the **current WO** (stable `workOrderId`); a labelled global-history filter is required to show sibling WOs that share the same SO/cycle/FG.

## Draft finalization and remaining-WO disposition

Draft quantity is editable and is not finalized production, QC output, shortage, stock, or carry-forward. **Review & Finalize** shows WO planned quantity, previously finalized quantity, the current draft, total after the entry, **WO quantity balance**, UOM, **RM-supported production maximum**, **unused RM-supported capacity** (FG-equivalent; not itself a wastage posting), and tolerance. A partial draft requires exactly one persisted decision in the same transaction as finalization:

- **Continue Production** — finalize batch → QC; WO stays active; **no** Production Report.
- **Pause Production** — finalize batch → QC; preserve remaining qty; save pause reason; move WO to **Paused Production**; leave the runner (next eligible WO or workspace); **no** Production Report.
- **End Production with Shortage** — finalize batch → QC; park WO as **Production Report Pending** (`SHORTFALL_PENDING`); UI uses a sticky **Opening Production Report…** gate so Continue / production-entry never flash, then mounts the mandatory RM Production Report on that WO (or via Workbench **Production Report Pending** / Pending Action **Complete Production Report**); lock production entry; shortage Keep/Waive / next-cycle recovery only after **Confirm Report & Close WO**.

When production reaches or exceeds the WO plan within the issued-RM-supported cap (equal or extra), finalization still does **not** close the WO. The WO moves to **Production Report Pending**. Meeting the planned FG quantity does **not** prove issued RM is reconciled.

Unused RM-supported FG capacity (example: plan 3,000, RM supports 3,150, produced 3,075 → 75 Nos equivalent unused capacity) is not automatic wastage. Reconcile the actual material in RM UOM:

`Total RM Issued − RM accounted for by finalized production − recorded runner/process/other wastage − RM returned to Store = Unexplained RM Balance`

**Confirm Report & Close WO** is enabled only when unexplained balance is zero within documented rounding tolerance. Operator allocates remaining material to usable return and/or documented wastage categories — never inferred.

**UI (presentation only):** The Production Report workbench is a compact single-viewport layout — horizontal summary strip, full-width RM reconciliation (Unexplained Balance), compact wastage rows with a sticky Confirm footer. It must not require page-level scroll for normal wastage entry, and Continue Production must not appear while the WO is Production Report Pending. Per RM line, required allocation is `issued − consumed − returned` at authoritative RM precision (Kg keeps decimals; never whole-number rounding for 0.77 Kg). Default manual wastage fills that remainder (after auto runner) so unexplained starts at zero; Add Wastage Reason disables when classification is complete.

**Post–Confirm Report & Close WO routing:** After a successful close, navigate to the card-based Production Workspace → **Ready to Start** (`/production?productionBucket=readyToStart&pwSection=ready`). Never land on the obsolete NO_QTY “Select Work Order to Produce” / Work queue / Log production screen. Do not auto-open another WO. Pending Actions return (`from` / `returnTo`) may be preserved. Navigate to the workspace URL before refresh so orphan `source=no_qty_so` URLs cannot paint. Lifecycle and backend reconciliation rules above are unchanged.

Finalized entries are immutable. Pause never creates recovery and never blocks a sibling WO. Only report-confirmed closure may transfer shortage to the next RS cycle. Excess accepted FG and QC rejection recovery retain their existing separate rules and Keep/Waive ownership.

Unconsumed RM remains **available for continued production** until explicitly returned or declared as actual wastage. Before final confirmation: `available = issued − consumed − returned − declared actual wastage`. At confirmation, consumed + approved return + explicitly classified actual wastage must equal issued RM within tolerance. Unconsumed RM is never inferred as wastage.

The Production Report is mandatory whenever the operator chooses to **close** the WO (shortage, equal, or extra). It is not required for intermediate Continue/Pause finalization. Pending QC, navigation, pause, and resume never open or confirm it. A paused WO cannot render or submit report, reconciliation, wastage, closure, or carry-forward actions.

The business document number (`WorkOrder.docNo`, for example `WO-26-0001`) is the only user-facing WO identity. The numeric primary key is permitted in route and API keys only.

### Live reconciliation calculation authority (2026-07-19 correction)

Every live surface and the confirmation API use the same authoritative three-decimal identity: `Accounted RM = Consumed RM + Returned RM + Classified Wastage` (including separately identified automatic runner wastage), and `Unexplained RM Balance = Issued RM - Accounted RM`. The Wastage Details summary, RM row, top summary, sticky footer, close-button state, and backend confirmation guard derive from those current quantities; a cached or submitted variance value is never a separate calculation authority.

For WO-26-0006, `81.23 + 0 + 0.77 = 82.00 Kg`. The unexplained balance is zero and **Confirm Report & Close WO** is enabled.

## Dashboard measures

- **Pending Actions**: actionable work items for the signed-in role.
- **WO needs action**: distinct production-eligible Work Orders.
- **Active Production**: production-eligible WO lines; where one WO has one FG line this equals the distinct-WO count.
- **Queue**: production action rows, not historical rows.
- **Operations clear**: true only when all applicable actionable queues, including Pending Actions and production-eligible WOs, are empty.

Counts refresh after WO creation, production entry/report, pause/resume, QA transitions, finalization, and closure.

## Diagnostics and recovery

Flag `CLOSED_WITH_SHORTFALL`/carried-forward presentation without a final report or shortfall decision, active quantity with terminal execution, and any UI WO label built from a numeric id. Reconciliation may reopen only a WO proven to have no final report, no valid carry-forward decision, and no terminal closure event; it must not broadly reopen historical WOs.
