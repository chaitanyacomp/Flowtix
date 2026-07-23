# Operator Guide — Flowtix ERP v1.0.0

## Combined dispatch billing and transportation charges

On **Create Sales Bill**, select one Sales Order, eligible dispatch rows, and positive **Bill Now** quantities within **Available to bill**. Availability excludes finalized billing and other draft reservations. Reducing/removing quantities or deleting a draft releases reservations; finalization rechecks all sources. Compatible items may combine while source dispatch allocations remain traceable.

Choose **Our Company** to include transportation and proportionately apply each line's GST rate. Choose **Transporter Directly** when the transporter bills separately. Highest-rate treatment is not automatic. Final tax and mixed-supply policy requires the client's GST consultant approval.

## Roles (product)

| Role | Typical work |
|------|----------------|
| ADMIN | Configuration, overrides, all modules |
| STORE | Stock, GRN, issues/returns, dispatch support |
| PURCHASE | Procurement planning, RM PO, purchase bills |
| PRODUCTION | Work orders, production entry, consumption |
| QA | QC posting and reports |

Sign-in uses email + password. Ask your administrator for an account.

On the login screen, use the eye control beside the password field to **Show password** / **Hide password** while typing (password stays hidden by default). Enter still submits Sign in.

## Master Data Workbench (quick)

1. Open **Masters → Masters hub** (`/masters`) or a master list (Customers, Suppliers, Items, …).
2. Use **Back to Masters** on a list to return to the hub (not browser Back alone).
3. Search by name (Items also match HSN); apply filters; sort headers; change rows per page (25/50/100).
4. Select checkboxes on the **current page only** — Select All does not mean the whole master.
5. When permitted, use Activate / Deactivate / Delete; blocked deletes stay and show a reason (record in use).
6. Add/Edit Save or Cancel returns to the same list.

**Items:** Use **+ Add Item** and choose Raw Material, Finished Good, Semi-finished Good, or Consumable. Opening quantity is entered under Opening Stock, not on item create. Item type cannot be changed after the item is used in transactions.

## Daily path (manufacturing)

1. Check **Dashboard** / pending actions for your role.
2. Work only from **document screens** (SO → RS → WO → Production → QC → Dispatch → Bill).
3. Do not invent stock adjustments to “fix” shortages without approval.
4. Use **Activity** / document history when investigating a document.

### Work Order Planning (locked NO_QTY RS)

- Enter WO quantities per FG; **Live RM Requirement** updates after you pause typing (debounced).
- **Updating RM…** appears only while a real feasibility request is in flight — quantities you typed are not reset.
- Create WO stays available based on validation (not locked solely because RM is refreshing).
- Soft BOM/stock refresh does not wipe in-progress quantity entry.

### Production Workspace — canonical tabs

Dashboard, Pending Actions, Workbench tabs/cards, and the process screen share one classifier (`productionWorkbenchState`).

| Tab | Meaning |
|-----|---------|
| **Ready to Start** | Never-started (or draft-only) WOs that can start now |
| **Continue Production** | Partial finalized qty with executable remaining balance |
| **Paused Production** | Explicitly paused; Resume restores the same WO |
| **Production Report Pending** | WO quantity finished or End-with-Shortage chosen; open mandatory RM Production Report before close |
| **Pending QA/QC** | Production execution cannot continue — only QA is next |
| **Awaiting Store Approval** | Production-complete WOs waiting on RM-return Store approval |
| **Recent Entries** | Historical production entries (entry QC may show Pending QC here) |

- A finalized partial batch may be **Pending QC** in Recent Entries while the same WO stays under **Continue Production** with remaining quantity. Entry QC does **not** replace WO execution status.
- After **Confirm Report** with shortfall **Carried Forward**, the WO leaves Continue/Ready and appears under **Awaiting Store Approval** until Store approves RM return. Production editing stays locked.
- Clicking a workbench **card** (or its primary button) opens the matching process: Start / Review & Finalize / Continue / Resume / Open QA.
- Compact card grid (up to 20–25 jobs): search, flow filter, sort, page size 12/20/25; tab/filter/page preserved in the URL when returning from a process.

### Pending Actions → Production Workspace

| Pending Action | Destination |
|----------------|-------------|
| Ready to Start | **Ready to Start** tab (+ `pwFocus` card highlight for a single WO) |
| Continue Production | **Continue Production** tab; single WO opens the executable remaining-balance screen |
| Paused Production | **Paused Production** tab with Resume |
| Complete Production Report | Exact WO with `pwSection=reportPending&focusReport=1` (stable Opening Production Report… then report; Back to Pending Actions preserved) |
| Pending QA/QC | QA/QC workflow (not a dead Production “Waiting for QA” page when balance remains) |

- Multi-WO Ready/Continue never pins a stale SO/cycle/WO. Left-menu **Production Workspace** stays `/production`.
- **Back** restores Pending Actions / Workbench filters (`from` / `returnTo`, `pwSection`, `pwq`, page).
- If a deep-linked WO’s state changed, the Workbench redirects to its current valid tab and explains the change.

### Pause / Resume Production

- Saving a **partial** production entry (e.g. 3,000 of 5,000) does **not** close the WO. That entry may show **Pending QC** while the WO stays **Continue** with remaining quantity and a fresh entry is allowed.
- **Pause** (e.g. Machine Breakdown) requires a reason (optional remarks). Finalize the batch to QC, keep the remaining quantity on the same WO, move it to **Paused Production**, and leave the production runner (next eligible WO loads automatically when available). No Production Report is requested on Pause. Prior entries, QC, and RM state are preserved. **Resume** restores Planned / Produced / Remaining for that WO.
- **Resume** returns the **same** WO to **Continue Production**. It does not create a new WO or duplicate prior entries.
- Only **Confirm Report & Close WO** finalizes production execution. Shortfall / carry-forward is assessed only at that confirmation.
- After Confirm Report & Close WO, you return to the **card Production Workspace → Ready to Start** (not the old Select Work Order / Log production screen). Success: “Production report confirmed and WO closed.”
- If RM return awaits Store approval, the WO may stay open under **Awaiting Store Approval** (not Continue Production).

## Printing & reports

- Document print/PDF from the document screen where offered.
- Operational reports from the Reports menu (stock, dispatch, production, QC, commercial matching).

## What operators must not do

- Edit `shared\.env` or run Prisma commands.
- Run demo seed on production.
- Share passwords or paste `.env` into chat/email.
# Multiple Work Orders for one FG

Treat every business WO number as a separate batch. A second WO for the same item does not replace the first. Dashboard and Production Workspace counts include every released, unpaused WO still able to accept production.

For partial production, earlier entries may wait for QA while Continue Production remains available. A paused screen shows only its summary, reason, Resume action, and read-only entry history. Remaining issued RM is labelled available for continuation, not wastage. Use Prepare/Confirm Final Report only when deliberately finalizing.
### Review & Finalize (finalize ≠ close)

Save Draft to keep an entry editable. Select **Review & Finalize** only when the recorded output is ready to post. Finalizing confirms the batch and sends it to QC — it does **not** close the WO.

- Remaining WO balance: choose **Continue**, **Pause**, or **End with Shortage**.
- WO balance complete (equal or extra within RM-supported capacity): finalize still opens the **mandatory Production Report**; unused RM-supported capacity is not automatic wastage — allocate return/wastage in RM UOM until unexplained balance is zero, then **Confirm Report & Close WO**.
- The Production Report is a **compact one-viewport workbench**: summary strip (Planned / Produced / Shortage-Extra / RM Issued / Accounted / Balance / Status), full-width RM table with **Unexplained Balance**, compact wastage rows, optional remarks, and a sticky **Confirm Report & Close WO** footer. Continue Production is not shown while the report is pending.
- Reconciliation uses one live formula everywhere: **Accounted RM = Consumed + Returned + Classified Wastage**; **Balance = Issued - Accounted**. Values use RM/UOM decimal precision. For example, 82 Kg issued, 81.23 Kg consumed, 0 Kg returned, and 0.77 Kg classified wastage gives 82.00 Kg accounted and zero balance, enabling **Confirm Report & Close WO**.
- RM Kg quantities keep decimals (e.g. 0.77 Kg, not 1 Kg). Classify wastage until **Remaining to classify** is 0; **Add Wastage Reason** then disables and Confirm enables when unexplained balance is also 0.
- Recent Entries default to **this work order only** (do not mix sibling WO history unless you select the global-history filter).

Continue/Resume use the same WO. Shortage Keep/Waive / next-cycle recovery happens only after report-confirmed closure. A paused WO does not prevent work on another WO.
# Production and Store RM workflow

On Material Issue, Store enters **Add Qty** only (extra RM for process wastage). **Qty (BOM)** always shows the original BOM requirement for the RM line (runner already included). **Already Issued** is cumulative. **Remaining** is the unissued balance. **Allowance %** is read-only: `Add Qty ÷ remaining BOM entitlement × 100` (two decimal places)—the remaining balance is not itself an allowance. **Issue Now** defaults to remaining + Add Qty (or remaining alone when Add Qty is 0) and may be reduced for a valid partial issue.

**Intentional partial issue:** Store may issue less than Remaining. After a successful partial issue the form clears, the WO moves to the **Partially Issued** side-queue tab, and Store continues with the next Ready WO. Production may proceed on RM already issued. Return later from **Partially Issued** to issue more, or use **Close Remaining (Short Issue)** only as an explicit optional action (never automatic).

Side-queue tabs: Ready to Issue · Partially Issued · Approval Pending · Approved · Rejected / Revision Required. Approval-pending WOs never appear in Ready.

**From Pending Actions:** Open / Open List lands on Material Issue with the correct queue already selected and its WO cards visible. You do not need to re-pick the tab, SO, WO, or PMR for a list open. Opening a specific item loads that WO/PMR and its RM lines in one step. Use **Back to Pending Actions** to return.

Allowance bands:

- **0%–5%:** Store issues normally with **Issue Material**. Stock moves immediately.
- **Above 5% through 10%:** Reason is mandatory. Store selects **Send for Admin Approval** (no stock movement). The WO moves to **Approval Pending** in the side queue; Store immediately continues with another WO. Admin approves or rejects in Pending Actions. After **Approved · Ready to Issue**, Store opens the WO, confirms **Approved by Admin**, and issues with stock revalidation. Rejection shows **Rejected · Revise** with the Admin reason; Store may revise and resubmit.
- **Above 10%:** Blocked on this card; use **Additional RM Issue**.

Changing WO/PMR/RM line/Add Qty/Issue Now after approval invalidates that approval and requires resubmission. Store cannot issue more than the approved Issue Now quantity. Theoretical BOM RM already includes runner; never add runner a second time. Planned allowance supports issue planning only and does **not** post actual wastage. Production records actual wastage later in the mandatory Production Report.
