# Manufacturing ERP — Regression & UAT Package

**Purpose:** Manual regression and user acceptance testing after integrity fixes across Sales → Work Order → Production → QC → Dispatch, master data, and error handling.

**How to use:** Execute cases in priority order (§8). Record pass/fail and evidence. Use §7 for defects.

**Assumptions:** Tester has appropriate roles (Admin / Sales / Store / Production as needed). Test environment has a clean or known baseline DB when validating stock math.

---

## Table of contents

1. [Regression checklist by module](#1-regression-checklist-by-module)
2. [Detailed test cases (ID, steps, expected)](#2-detailed-test-cases)
3. [High-risk scenarios (explicit)](#3-high-risk-scenarios-explicit)
4. [End-to-end UAT script (sample flow)](#4-end-to-end-uat-script-sample-flow)
5. [Bug report template](#5-bug-report-template)
6. [Test priority (P0 / P1 / P2)](#6-test-priority-p0--p1--p2)
7. [Summary & recommendations](#7-summary--recommendations)

---

## 1. Regression checklist by module

Use as a quick coverage map; detailed steps are in §2 and §3.

| Module | Focus areas |
|--------|-------------|
| **Master data** | Item (RM/FG), Customer, Supplier, BOM; duplicates; unsafe delete; BOM/item locks after WO |
| **Quotations / enquiry** | Create from enquiry; link to SO where applicable; no breakage of downstream IDs |
| **Sales orders** | Draft vs confirmed; duplicate FG lines; qty floors; edit/delete rules; status transitions |
| **Work orders** | Multi-WO same SO+FG; planned qty / buffer rules; edit/delete after production |
| **Production** | Partial batches; append-only after QC; caps vs planned |
| **QC** | Partial accept/reject; pending math; reversal removes effects from active totals |
| **Dispatch** | SO+item level; cap by SO remainder and QC-passed stock; partial dispatch |
| **Stock / inventory** | RM consumption; FG only after QC; no direct FG from production alone |
| **Reports / dashboard / exceptions** | Consistency after each step; queue metrics; no stale numbers after QC reversal |
| **Error handling / UX** | Friendly messages; no raw Prisma/DB strings on common failures |
| **Permissions** | Role-gated masters vs transactions; admin-only destructive actions |

---

## 2. Detailed test cases

**Classification legend**

- **Happy path** — nominal success case  
- **Validation** — system rejects invalid input with clear message  
- **Edge case** — unusual but allowed or boundary behavior  
- **Regression-sensitive** — area touched by recent fixes; high regression risk  

---

### 2.1 Master data

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| MD-001 | Master | Create RM item | Logged in as role allowed to create items | Create item type RM, name unique, unit e.g. KG | Item saved; appears in lists | Happy path |
| MD-002 | Master | Create FG item | — | Create FG with distinct name | Item saved | Happy path |
| MD-003 | Master | Duplicate item name | Item "Bolt A" exists | Create second item same name | Blocked with clear duplicate message (not raw DB error) | Validation |
| MD-004 | Master | Edit item name when used | Item on draft SO or stock txn | Change display name only | Allowed if business rules permit | Happy path / Edge |
| MD-005 | Master | Change item type when used | Item referenced in SO/WO/stock | Change RM↔FG | **Blocked** with business-friendly 409-style message | Validation / Regression-sensitive |
| MD-006 | Master | Change unit when used | Same | Change unit | **Blocked** with same class of message | Validation / Regression-sensitive |
| MD-007 | Master | Delete item not used | Item only on master list | Delete | Success (204/no content) | Happy path |
| MD-008 | Master | Delete item in use | Item on SO/BOM/stock/etc. | Delete | **Blocked**; message explains transactional use | Validation / Regression-sensitive |
| MD-009 | Master | Customer duplicate name | Customer "ACME" exists | Create another "ACME" | Blocked; professional duplicate message | Validation |
| MD-010 | Master | Delete customer with SO | Customer has sales order | Delete customer | **Blocked**; in-use message | Validation |
| MD-011 | Master | Supplier duplicate (case) | Supplier "Steel Co" exists | Create "steel co" | Blocked per duplicate rules | Edge / Validation |
| MD-012 | Master | Delete supplier with RM PO | Supplier on purchase history | Delete | **Blocked** | Validation |
| MD-013 | Master | Create BOM for FG | FG without BOM, RMs exist | Add BOM lines unique RM | BOM saved | Happy path |
| MD-014 | Master | BOM duplicate RM line | BOM draft | Two lines same RM | Validation error; friendly text | Validation |
| MD-015 | Master | Edit BOM after WO exists | FG has work order line | Change BOM lines | **Blocked**; message references work order / finished good | Regression-sensitive |
| MD-016 | Master | Delete BOM after WO exists | Same | Delete BOM | **Blocked** | Regression-sensitive |
| MD-017 | Master | Edit BOM before any WO | SO may exist, no WO for FG | Change quantities/wastage | Allowed | Happy path / Edge |

---

### 2.2 Quotations / enquiry (if used in your rollout)

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| QN-001 | Quotation | Create quotation from enquiry | Enquiry with lines | Complete quotation workflow | Totals and taxes consistent | Happy path |
| QN-002 | Quotation | Convert to SO | Approved quotation | Create SO from quotation | SO links correctly; no duplicate line corruption | Regression-sensitive |

---

### 2.3 Sales orders

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| SO-001 | SO | Create SO with single FG line | Customer, FG item, BOM | Add line, qty, save draft | Draft saved | Happy path |
| SO-002 | SO | Duplicate FG lines same item | — | Add two lines same FG item different or same qty | Both lines persist; system treats as **separate lines** (FIFO/rollup rules apply downstream) | Regression-sensitive |
| SO-003 | SO | Confirm SO | Draft valid | Confirm / approve per workflow | Status updated; WO creation allowed | Happy path |
| SO-004 | SO | Reduce qty below floor | WO/dispatch/production exist per rules | Lower qty past allowed floor | **Blocked** or clamped per implementation; message clear | Validation / Regression-sensitive |
| SO-005 | SO | Delete draft line (duplicate FG) | Draft SO, two lines same FG | Remove one line | Other line unaffected; totals recalc | Regression-sensitive |
| SO-006 | SO | Edit/delete after downstream | Production/QC/dispatch per rules | Attempt unsafe edit | Blocked with business message | Validation |

---

### 2.4 Work orders

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| WO-001 | WO | Create WO from SO | Confirmed SO | Create WO, assign FG lines | WO created | Happy path |
| WO-002 | WO | Two WOs same SO + same FG | SO with duplicate FG lines or single line | Create **second WO** planning same FG | Allowed; planning sums stay consistent | Regression-sensitive |
| WO-003 | WO | Planned qty includes buffer | Business buffer rules | Enter planned > ordered if allowed | Saved; production cap respects rules | Happy path / Edge |
| WO-004 | WO | Edit WO after production | Production entries exist | Change qty/planned | Blocked or restricted per rules | Validation / Regression-sensitive |
| WO-005 | WO | Delete WO after production | Same | Delete | Blocked | Validation / Regression-sensitive |

---

### 2.5 Production

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| PR-001 | Production | First production batch | Open WO line | Record produced qty &lt; planned | Saved; **no** dispatchable FG stock until QC | Happy path |
| PR-002 | Production | Partial production | — | Multiple smaller production entries | Cumulative tracked; pending QC math correct | Regression-sensitive |
| PR-003 | Production | Append-only after QC | QC posted for batch | Edit/delete production | **Blocked** per append-only rules | Validation / Regression-sensitive |
| PR-004 | Production | Exceed planned cap | — | Enter qty above allowed cap | Validation error | Validation |

---

### 2.6 QC

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| QC-001 | QC | Partial accept | Production exists | Accept part of batch | Accepted moves to usable FG pool; pending reduces | Happy path |
| QC-002 | QC | Reject qty | — | Record rejected + reason | Rejected **not** dispatchable | Validation / Happy path |
| QC-003 | QC | Pending = produced − accepted − rejected | Mixed partials | Compare screen vs manual formula | Matches; reversals excluded from active | Regression-sensitive |
| QC-004 | QC | Reverse QC | QC entry active | Perform reversal with reason | Active totals and stock **remove** QC effects | Regression-sensitive |

---

### 2.7 Dispatch

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| DS-001 | Dispatch | Dispatch uses SO + item | QC-pass stock & SO remainder | Dispatch qty | Recorded at **SO + item** (not WO); cannot exceed SO remaining or stock | Happy path |
| DS-002 | Dispatch | Block over SO remainder | — | Enter qty &gt; line remainder | Blocked / validation | Validation |
| DS-003 | Dispatch | Block over QC stock | Insufficient accepted FG | Dispatch | Blocked | Validation |
| DS-004 | Dispatch | Partial dispatch | — | Multiple dispatch events | Cumulative; FIFO/attribution per design | Happy path / Edge |
| DS-005 | Dispatch | Dispatch reversal | Reversal supported in app | Reverse one dispatch line | Stock and SO remaining restore per rules | Edge / Regression-sensitive |
| DS-006 | Dispatch | Delivery location select | Customer has multiple active Delivery Locations | Prepare dispatch | Dropdown shows active locations only; default preselected; inactive excluded | Happy path |
| DS-007 | Dispatch | Snapshot immutability | Dispatch prepared with location | Edit Customer Delivery Location master | Print/export/Sales Bill still show original dispatch snapshot | Regression-sensitive |
| DS-008 | Dispatch | Used location delete blocked | Location referenced by Dispatch | Delete location on Customer | Blocked; mark Inactive instead | Validation |
| MD-011 | Master | Same GSTIN Customer + Registered Office | Customer GSTIN equals Registered Office location GSTIN | Save Customer | Allowed (not a within-customer duplicate error) | Validation |

---

### 2.8 Stock / inventory

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| ST-001 | Stock | FG not from production alone | Production without QC | Check FG stock | No dispatchable FG from production only | Regression-sensitive |
| ST-002 | Stock | FG after QC accept | QC accepted | Check FG stock | Increases by accepted qty net of dispatch | Happy path |
| ST-003 | Stock | After QC reversal | Reversal done | Check FG stock | Decreases consistent with reversal | Regression-sensitive |
| ST-004 | Stock | RM consumption | GRN / issues per process | Issue RM to WO | RM stock consistent | Happy path |

---

### 2.9 Reports / dashboard / exceptions

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| RP-001 | Reports | Dispatchable / shortage | Known SO+QC state | Open relevant report | Numbers match operational reality | Regression-sensitive |
| RP-002 | Dashboard | Queue / exceptions | Staged defects | Open dashboard | Metrics match drill-down | Happy path |
| RP-003 | Reports | After QC reversal | Reversal just done | Refresh reports | No stale QC-approved totals | Regression-sensitive |
| RP-010 | Reports | WO Tracking Regular flow | Open Regular WOs | Flow = Regular; Status = Open | Ordered Qty from SO line; no NO_QTY rows; production-oriented KPIs | Regression-sensitive |
| RP-011 | Reports | WO Tracking closed NO_QTY SO | Closed SO (e.g. 242/243) | Flow = NO_QTY; Status = Open | Not listed as IN PRODUCTION; Status = Closed/All → Active pending 0 | Regression-sensitive |
| RP-012 | Reports | WO Tracking Customer Demand | Locked RS baseDemand ≠ WO qty | NO_QTY flow | Customer Demand column; no Ordered Qty; customer not duplicated | Regression-sensitive |
| RP-013 | Reports | WO Tracking Active Dispatch | Multi-WO same FG | NO_QTY flow | Pending is SO+FG+cycle, not Accepted−WO FIFO | Regression-sensitive |
| RP-014 | Reports | WO Tracking UI density | Laptop 1366×768 | Open WO Tracking both flows | No horizontal scroll on main table; compact toolbar; progress blocks | Regression-sensitive |
| RP-015 | Reports | WO Tracking recovery UX | Row with recovery outcome | Click Recovery badge | Compact modal (shortfall/keep/waive/outcome); table stays compact | Regression-sensitive |
| RP-016 | Reports | WO Tracking row expand | Any result row | Expand row | Secondary qty + recovery/context; scan columns unchanged | Happy path |
| RP-017 | Reports | Report Grid standard (FT-PD-066 §17.7) | Analysis catalog | Spot-check WO Tracking + one High-priority gap report | Shared KPI/filter chrome; scan cols vs expand/drawer per §17.8–§17.11 | Regression-sensitive |
| RP-018 | Reports | ReportPageShell consistency | Analysis catalog | Open WO Analysis, Type Analysis, Scrap, RM Wastage, RM Ledger | Same max width / margins / header·KPI·filter·table rhythm (FT-PD-066 §17.15) | Regression-sensitive |
| RP-019 | Reports | Analysis Back to Reports | Receivables + Payables + Scrap tiles | Open from Reports catalog | Back label is **Back to Reports** (not Dashboard) | Regression-sensitive |
| RP-020 | Reports | Scrap date validation UX | Scrap Report | Enter invalid / From>To dates | Errors say DD-MM-YYYY; never YYYY-MM-DD; blanks omit; partial ranges ok | Regression-sensitive |
| RP-021 | Reports | ReportChrome compliance | Production Wastage WO Analysis | Visual check vs other Analysis reports | Uses ReportPageShell + ReportKpiStrip + ReportFilterToolbar + ReportTableShell | Happy path |

---

### 2.10 Error handling / UX & permissions

| ID | Module | Scenario | Pre-condition | User action | Expected result | Type |
|----|--------|----------|---------------|-------------|-----------------|------|
| UX-001 | Error | Invalid payload | — | Submit form with bad data | Zod-style path: **no** raw stack trace in UI | Validation |
| UX-002 | Error | DB duplicate / FK | Trigger P2002/P2003 class error | Observe toast/message | Short business message; optional `code` not scary | Regression-sensitive |
| UX-003 | Perm | Master delete | Non-admin user | Delete item/customer | Forbidden or hidden per role | Validation |
| UX-004 | Perm | Transaction entry | Store user | Create GRN/dispatch per role | Allowed where designed | Happy path |

---

## 3. High-risk scenarios (explicit)

Execute these **in addition** to §2 for release confidence.

| ID | Risk theme | Setup | Action | Expected | Type |
|----|------------|-------|--------|----------|------|
| HR-01 | Same FG repeated on SO | SO with 2+ lines same FG | Plan WOs; dispatch; verify FIFO/rollup | No double-count or wrong remainder | Regression-sensitive |
| HR-02 | Same FG in multiple WOs | One SO line, two WOs | Production on both; QC; dispatch | Planning + pending + stock coherent | Regression-sensitive |
| HR-03 | Partial production | WO with planned buffer | Several production posts | Pending QC = produced − QC sums (active) | Regression-sensitive |
| HR-04 | Partial QC accept/reject | Large batch | Split QC rows | Stock and dispatch limits correct | Edge |
| HR-05 | QC reversal | Accepted qty in stock | Reverse QC | Totals and reports exclude reversed QC | Regression-sensitive |
| HR-06 | Partial dispatch | Enough QC stock | Dispatch 30% then 50% of remainder | SO remainder + stock match | Happy path |
| HR-07 | Dispatch reversal | If supported | Reverse last dispatch | Stock returns; SO open qty increases | Edge |
| HR-08 | Draft SO delete duplicate FG line | Draft with duplicate FG | Delete one line | Other line and validations OK | Regression-sensitive |
| HR-09 | Draft SO qty below floor | WO/dispatch state | Lower qty | System prevents with clear reason | Validation |
| HR-10 | WO edit/delete after production | Production posted | Edit/delete WO | Blocked with clear message | Validation |
| HR-11 | BOM edit/delete after WO | WO exists for FG | Edit/delete BOM | Blocked | Regression-sensitive |
| HR-12 | Item type/unit after use | Item on SO | Change type/unit | Blocked | Validation |
| HR-13 | Duplicate masters | Known duplicates | Create duplicate item/customer/supplier | Prevented; message professional | Validation |
| HR-14 | Raw technical errors | Force server error in test | Observe UI in prod-like build | Generic friendly 500 message | Regression-sensitive |

---

## 4. End-to-end UAT script (sample flow)

**Goal:** One repeatable script covering masters → SO → 2 WOs → production → QC (parts + reversal) → dispatch (parts + reversal if available) with checks after each milestone.

**Roles:** Use Admin/Store for masters and purchases; Sales for SO; Production for WO/production/QC/dispatch as per your deployment.

### Phase 0 — Masters (10–15 min)

1. Create **Customer** `UAT Industries`.
2. Create **Supplier** `UAT Raw Metals`.
3. Create **RM** items: `UAT-RM-Plate`, `UAT-RM-Bolt` (units consistent with BOM).
4. Create **FG** item: `UAT-FG-Assembly`.
5. Create **BOM** for `UAT-FG-Assembly` (2 RM lines, unique RMs, realistic base qty + wastage).
6. **Verify:** BOM displays; no errors.

### Phase 1 — Sales order with duplicate FG lines

7. Create **Sales Order** for `UAT Industries`.
8. Add **line 1:** `UAT-FG-Assembly`, qty **100**.
9. Add **line 2:** **same FG** `UAT-FG-Assembly`, qty **50** (duplicate FG lines intentional).
10. Save as **draft**, then **confirm** per workflow.
11. **Verify:** SO shows two lines; totals correct.

### Phase 2 — Two work orders (same SO / same FG)

12. Create **WO #1** covering FG demand (e.g. line 1 or combined per UI).
13. Create **WO #2** for remaining FG demand (second WO for same SO+FG if UI allows split).
14. Set **planned/production target** per rules (include allowed buffer if applicable).
15. **Verify:** Both WOs show consistent planned vs SO; no unexplained validation errors.

### Phase 3 — Production (partial)

16. On WO #1, post **production batch A** (e.g. 40 units).
17. On WO #2, post **production batch B** (e.g. 20 units).
18. **Verify stock:** FG **dispatchable** stock should **not** increase solely from production — check FG available for dispatch vs QC step next.

### Phase 4 — QC (partial + reversal)

19. For batch A, post **QC** accepting **30**, rejecting **5** (adjust to match produced).
20. For batch B, post partial accept/reject as needed.
21. **Verify:** Pending QC matches `produced − accepted − rejected` (non‑negative); rejected not dispatchable.
22. **Reverse** one QC entry (e.g. the 30 accepted from step 19) using the app’s reversal flow.
23. **Verify:** Active accepted totals decrease; FG usable stock decreases accordingly; reports/dashboard refresh.

### Phase 5 — Dispatch (partial + reversal if supported)

24. Dispatch **partial** qty against SO+item (e.g. 25) — should succeed only if ≤ SO remainder and ≤ QC‑passed pool.
25. Attempt **over‑dispatch** (remainder + 1) — **must fail** with clear message.
26. If **dispatch reversal** exists: reverse the 25; **verify** SO open qty and FG stock.
27. If reversal not supported: document **N/A** and skip.

### Phase 6 — Reports & dashboard

28. Open **dispatch / operations / shortage** reports relevant to your rollout.
29. Open **dashboard / exception** screens.
30. **Verify:** Figures align with: SO open qty, cumulative dispatch, QC‑accepted pool, WO pending.

**Sign-off row (copy to test log):**

| Step | Screen | Pass? | Notes |
|------|--------|-------|------|
| Masters | Items/BOM | | |
| SO duplicate FG | SO detail | | |
| 2 WOs | WO list/detail | | |
| Production | Production entry | | |
| QC + reversal | QC | | |
| Dispatch | Dispatch | | |
| Reports | Reports/Dashboard | | |

---

## 5. Bug report template

Copy for each defect.

```
Title: [Short description]

Environment: [e.g. UAT / version / browser]
Tester: [name]
Date: [YYYY-MM-DD]
Screen / URL route: [e.g. Sales Orders → SO #123]

Severity: [ Critical | High | Medium | Low ]
Type: [ Functional | Data | UX | Performance | Security ]

Pre-conditions:
- 

Steps to reproduce:
1. 
2. 
3. 

Actual result:
- 

Expected result:
- 

Business impact:
- 

Screenshot / evidence:
- [Attach screenshot or paste redacted API response body]

Logs / correlation (if any):
- Request id / time / user role:

Regression note:
- Related test ID from UAT package: [e.g. HR-05]
```

---

## 6. Test priority (P0 / P1 / P2)

### P0 — Must test before go-live

- End-to-end §4 (or equivalent shortest path: SO → WO → production → QC → dispatch).
- HR-01, HR-02 (duplicate FG lines + multi-WO same FG).
- HR-03, HR-04, HR-05 (partial production/QC, QC reversal).
- HR-06, HR-09 (partial dispatch; SO qty floor).
- DS-001–DS-003 (dispatch capped by SO + QC stock).
- MD-005, MD-006, MD-015, MD-016 (item type/unit; BOM after WO).
- UX-002 / HR-14 (no raw technical errors for common failures).

### P1 — Should test

- WO-004, WO-005, PR-003 (WO/production safety after downstream).
- HR-07, HR-08 (dispatch reversal; draft line delete duplicate FG).
- QN-001–QN-002 if quotations are in scope.
- RP-001–RP-003 (reports after state changes).
- Full §2.1 master duplicate prevention (MD-003, MD-009, MD-011).

### P2 — Nice to test

- Edge quotas (exactly zero stock, exactly full SO remainder).
- Multiple browsers / roles (UX-003–UX-004).
- Performance with large line lists on SO/WO screens.

---

## 7. Summary & recommendations

### Critical business flows covered

- **Order-to-cash manufacturing path:** SO (including duplicate FG lines) → multiple WOs → production → QC (with reversal) → dispatch at **SO + item** level with **QC‑passed FG** as the dispatchable pool.
- **Inventory truth:** Production alone does not create dispatchable FG; QC acceptance drives usable FG; reversals roll back active totals.
- **Master data integrity:** Unsafe structural edits and BOM changes after manufacturing exists; professional API/UI messaging.

### Known limitations / intentionally unchanged (for test planning)

- **Machine master:** Not modeled as a separate entity in current schema — no separate machine regression module.
- **Dispatch reversal:** UAT assumes “if supported”; confirm in app before mandating HR-07.
- **Permissions model:** Not redesigned in recent work — test **as deployed** (Admin vs Store vs Sales vs Production).

### NO_QTY Decision-only Recovery Cycle (P0 regression)

Authoritative SSOT: FT-PD-022 §7.3 / FT-PD-031 §7.2 / Planning State Machine §8.1.

| ID | Setup | Action | Expected |
|----|-------|--------|----------|
| NQ-DOC-01 | Recovery draft RS, Current Requirement = 0, all CF WAIVE/KEEP, no WO | Open RS workbench | Banner: “Recovery decisions completed. This cycle can now be finalized.” Finalize enabled |
| NQ-DOC-02 | Same as NQ-DOC-01 | Finalize / Lock RS | Lock succeeds; ACTIVE cycle closes (empty cap); no WO required |
| NQ-DOC-03 | After NQ-DOC-02, Outstanding Qty = 0, other gates clear | Assess / Close SO | SO close eligible; demand identity = Original − (Dispatched + Waived) — **not** sum of historical RS qty |
| NQ-DOC-04 | Positive Current Requirement / Total to Produce | Finalize | Existing production-cycle rules unchanged; decision-only path **not** used |
| NQ-DOC-05 | KEEP on carry-forward | Keep | Increases demand / Total to Produce; decision-only blocked until resolved |
| NQ-DOC-06 | WAIVE remaining | Waive | Removes outstanding obligation; does not invent new customer demand |
| NQ-NAV-01 | RS Finalize, no dispatchable FG (decision-only / all waived) | Lock RS | Lands on NO_QTY Agreement summary with `salesOrderId` — **not** `/dispatch` |
| NQ-NAV-02 | RS Finalize, dispatchable FG > 0 | Lock RS | Opens `/dispatch?source=no_qty_so&salesOrderId&cycleId` with SO/cycle pre-bound (no blank SO dropdown) |
| NQ-NAV-03 | REGULAR SO dispatch deep-link | Open `/dispatch?salesOrderId=` without `source=no_qty_so` | Generic REGULAR workbench unchanged |

### Final pre-go-live checks (recommendations)

1. **Data backup** before UAT on shared environments; restore procedure documented.
2. **One full P0 pass** on production-like config (`NODE_ENV=production`) for error message wording.
3. **Parallel run:** compare report totals (dispatchable, shortage) to a **manual spreadsheet** for one complex SO.
4. **Access review:** confirm who can delete masters vs run transactions (smoke test UX-003).
5. **Rollback plan:** if critical defect in P0, freeze releases until fixed and re-run §4.

---

*Document version: 1.0 — aligned with post-integrity-fix manufacturing ERP behavior described in project context.*
# Tally Compatibility — Release-1 UAT Gate

The Release-1 gate covers Primary Unit, one Alternate Unit, precision, missing Unit/Location, external-ID/GSTIN/duplicate/ambiguous/inactive matching, HSN/GST, location-wise opening quantity/rate/value, approval and safe rerun, BOM history protection, invoice generation, duplicate-attempt prevention, acknowledgement, rejection persistence and retry. Deferred features must be reported as unsupported, never silently ignored. See the [Tally Compatibility Contract](./product/05_Data_Architecture/Tally_Compatibility_Contract.md).

## Production Pause / Resume (1,500 → 500 → pause → resume → continue)

1. NO_QTY WO planned 1,500; produce/approve **500**; confirm entry may show Pending QC in Recent Entries.
2. Confirm WO remains **Active** with **1,000** remaining (not removed because of entry QC).
3. Pause with reason → Pending Actions “Production Paused”; Workspace **Paused Production** shows WO with remaining 1,000; production API rejects new entries.
4. Resume → same WO under **Active Production**; continue producing remainder without duplicating the 500 entry.
5. Confirm Report & Close WO only then finalizes; no carry-forward before that confirmation.
6. RM-return pending (if any) appears under Awaiting Store Approval, not Active.

## Pending Actions → Production Workspace routing

1. Seed two Ready to Start NO_QTY WOs (e.g. new-format `WO-NQ-26-0003` / `WO-NQ-26-0004`, or legacy `WO-26-0003` / `WO-26-0004`) on the same or different SOs; leave a prior completed WO on the same cycle if available.
2. Pending Actions → Ready to Start Production (2) → **Open Production Workspace**.
3. Expect **Ready to Start** tab with both cards — **not** empty Continue Production, and **not** “Production entry completed for this cycle”.
4. URL must include `productionBucket=readyToStart`, `pwSection=ready`, and `from`/`returnTo=pending-actions`, and must **not** pin a completed `workOrderId` / stale `salesOrderId`+`cycleId`.
5. Continue Production (partial + prior Pending QC + remaining) opens executable Continue screen — not Waiting for QA only.
6. Back returns to Pending Actions; left-menu Production Workspace opens bare `/production` overview.
7. Single-item Ready Pending Action still opens that WO directly; completed WO history link stays read-only when no siblings are actionable.

## Production Workspace — Active Production eligibility (UI classification)

Preserve WO closure only after Store RM-return approval. Fix classification only:

1. Partially produce a NO_QTY WO (planned > produced), leave execution open → WO appears in **Active Production**; Open enters editable production.
2. Confirm production report with shortfall **Carried Forward** → WO **leaves Active Production**; production editing locked; WO still open; appears under **Pending Store Tasks / Awaiting Store Approval**; Recent Production Entries still show the batch (e.g. Pending QC).
3. Fully produce with Pending QC only → not in Active Production; counts under **Pending QA** (WO-scoped).
4. Same SO/cycle: another WO that can still accept production remains in Active Production.
5. Open from Active Production must not reopen a finalized/terminal-for-production WO into editable entry.
6. Pending QA KPI matches distinct WOs with pending QC on the production queue (may be 1 while Recent shows 2 Pending QC rows on that WO).

## Material Issue — Planned Process Allowance

1. Load a PMR with Theoretical RM **27 Kg** and sufficient stock.
2. Enter Allowance Qty **1 Kg** → percentage is approximately **3.5714%**, Recommended is **28 Kg**.
3. Enter **Add Qty** so Issue Now defaults to applicable BOM + Add Qty (e.g. BOM 27 + Add 1 → Issue Now **28 Kg**) and status is Ready / Normal · No approval required when ≤5%.
4. Enter Issue Now **29 Kg** → “Excess issue: 1 Kg above recommended.”
5. Enter Issue Now **27 Kg** → below recommended by 1 Kg, but not a true BOM short.
6. Enter Issue Now **26 Kg** → true short against theoretical RM.
7. Enter **7%** → reason required and Admin approval required. Enter **11%** → blocked; use Additional RM Issue.
8. Edit Allowance % on one of several RM lines; verify other lines do not recalculate.
9. At desktop/tablet/mobile widths verify no nested horizontal scroll, no clipped controls, normal rows remain compact, and only the line needing approval expands.
10. Confirm the issue-line audit snapshot includes source, entered/calculated allowance, recommended/actual issue, UOM/conversion, approval, user/time. Confirm no wastage is posted until Production Report.

## NO_QTY RM-supported overproduction UAT

- WO 2,000 / RM capacity 2,050: 2,020 saves with a non-blocking 20 excess warning.
- WO 2,000 / RM capacity 2,000: 2,020 is blocked.
- Approved 1,900 / cumulative capacity 2,050: additional 150 is allowed and 151 is blocked.
- Store return reduces the displayed and enforced capacity.
- Multiple BOM components use the lowest component capacity.
- Excess enters normal QC; accepted qty posts FG stock and rejection remains recordable.
- WO planned qty and RS balance/placed quantity do not change.
- Regular SO production tolerance remains unchanged.

**Master import runtime check (mandatory):** After any Tally mapper change, stop all Node backends on port 4000, start a single backend, hard-refresh the UI, and confirm Preview Network → `POST /api/admin/tally-import/preview` returns `runtime.pipelineId` matching the current contract. Mapper unit tests alone are not sufficient — run `tallyMasterImportHttpPreview.test.js`. For an existing wrong TATA row (Address=`TATA`, blank GSTIN), use “Update empty fields only” only after clearing wrong non-empty fields, or delete/reset the customer first.
# NO_QTY active-cycle action priority (2026-07-15)

- Active Cycle 2, RS 12,251, WO placed 3,251, remaining 9,000, RM-supported FG 9,000: Pending Actions and Execution Register both show Create Work Order for Cycle 2 and open its RS execution workspace.

### Admin-cancelled NO_QTY RS — Store recovery

Precondition: an open NO_QTY SO has active Cycle 1 and a locked RS with no Work Order, material movement, production, QC, dispatch, stock transaction, procurement document, or other downstream reference.

1. As Admin, cancel/reopen the locked RS and record a reason.
2. Confirm the SO remains open and Cycle 1 remains the active/current cycle.
3. Confirm the cancelled RS remains in history with status `CANCELLED`, actor, time, and reason.
4. As Store, open Pending Actions. Confirm exactly one **Create Requirement Sheet** action appears for the SO.
5. Open the action. Confirm it deep-links to NO_QTY RS creation for the same SO and Cycle 1; it must not prepare Cycle 2.
6. Create the replacement. Confirm its version is greater than the cancelled version.
7. Refresh Pending Actions. Confirm the Create Requirement Sheet action is gone while the replacement draft exists.
8. Confirm Sales Order “Next RS Ready” and Pending Actions agree before creation and both use the same target cycle/version.
9. Negative check: close the SO and confirm no Create Requirement Sheet action appears.

Pass criteria: cancelled history never counts as active/locked; one same-cycle Store action is emitted only while no replacement exists; no duplicate RS/action or unintended cycle is created.
- With the same balance but zero executable FG capacity, both surfaces show Await Procurement / View Planning Status.
- A completed earlier WO, or Production/QC completion for one WO, does not expose Create Cycle 3 while Cycle 2 placement balance or Store execution remains.
- With placement balance zero but open Production/QC work, next-cycle action follows the canonical completion policy.
- Once the cycle is canonically complete, Create Next Cycle becomes available exactly once.
# NO_QTY QC-accepted production surplus (2026-07-15)

### Dispatch suppression for excess FG

1. Demand 6,000, accepted 6,500, dispatched 6,000: confirm SO Balance 0, Usable FG 500, Dispatchable and Dispatching Now 0, no mandatory queue/save action, and the next-cycle stock note.
2. With dispatched 5,500, confirm dispatchable 500. With accepted 5,500 and dispatched 5,000, confirm dispatchable 500.
3. Confirm the remaining 500 stays in USABLE stock, remains available to next-cycle carry-forward, creates no billing obligation, and does not block SO closure.
4. Attempt draft creation/finalization above remaining demand and confirm the backend rejects it.
5. Smoke-test Regular SO dispatch and billing behavior.

Use SO-26-0001: Cycle 1 demand 6,000; WOs planned 2,000 each; production 2,000 + 2,000 + 2,500; QC acceptance 6,500.

1. Before final QC, accepted excess is zero and Pending QC reflects undisposed production.
2. After final QA, Pending QC is zero and Cycle 1 accepted excess is 500.
3. Recalculate Cycle 2 demand 3,500: Prior Accepted Excess 500, **Net Production Requirement** and Suggested WO 3,000, with the explanatory note. No separate Final RS Qty column.
4. Edit Customer Demand to 4,000 on the draft grid: Net Production Requirement updates immediately to 3,500 without reload.
5. Edit Customer Demand to 300: Net Production Requirement becomes 0; unused excess 200 retained for a following cycle.
6. Save Draft preserves updated demand and refreshes authoritative net; Finalize is blocked until Save/Recalculate clears dirty state; lock persists demand + net atomically.
7. Customer demand and prior WO planned/placed quantities stay unchanged by surplus reconstruction.
8. Acceptance 6,300/rejection 200 gives 300 excess; acceptance 6,000 gives zero.
9. Verify partial dispatch, multiple WOs, FG isolation, cancelled-version exclusion, existing-draft Recalculate, and lock-time stale recalculation.
10. Smoke-test Regular SO and Green Level workflows.

---

## Browser recovery, navigation, and flicker (2026-07-16)

**Reference:** [`docs/ERP_BROWSER_NAVIGATION_AND_RECOVERY_STANDARD.md`](./ERP_BROWSER_NAVIGATION_AND_RECOVERY_STANDARD.md)

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| NAV-001 | Deep link after expiry | Open RS/WO URL → force 401 / clear token → login | Returns to original URL, not only Dashboard |
| NAV-002 | Logout then Back | Logout → browser Back | Login (or redirect); no protected content from prior session |
| NAV-003 | Dirty RS demand | Edit Customer Demand → refresh / sidebar leave | Browser or in-app leave warning; after Save Draft, no warning |
| NAV-004 | Dirty BOM / Monthly Plan | Edit without save → Back / sidebar | Confirm leave; cancel keeps edits |
| NAV-005 | Production recovered draft | Edit production report → refresh same tab | “Recovered draft” banner; confirm still posts to server |
| NAV-006 | Double finalize | Rapid double-click Finalize / Confirm / Dispatch | Single server effect; button disabled while pending |
| NAV-007 | Hard nav absence | Customer return → SO focus; Green Level WO → Material Issue | SPA `navigate` (no full white reload) |
| NAV-008 | Unknown route | Visit `/this-route-does-not-exist` while authed | Redirect to Dashboard |
| NAV-009 | Shell stability | Sidebar navigate Dashboard → Sales Orders → Dispatch | Shell stays; content-area loading only |
| NAV-010 | Role / flow context | Pending Action for NO_QTY | Opens NO_QTY context (not Regular SO/Dispatch) |
| NAV-011 | Chrome + Edge | Repeat NAV-001–010 | Same behaviour |
| NAV-012 | Viewports | 1920×1080 and 1366×768 | Primary actions usable; no layout collapse on operational pages |
| NAV-013 | List → Record → Back | Sales Orders / WO with filters | Filters and scroll restore; no restored action/modal |
| NAV-014 | Dispatch boot | Open `/dispatch` with pending work | No false “Dispatch complete” before load |
| NAV-015 | Dispatch finalize retry | Finalize with same key after network fail | No duplicate stock post; key reused until success |
# Multi-WO production acceptance

For Cycle 1 demand Round Plate 5,000 and Square Box 3,000, create WOs 3,000 / 2,000 and 2,000 / 1,000 respectively. Verify four canonical business numbers, four Active/Ready WOs, four Pending Actions, four WO-needs-action records, no Carried Forward row, correct links, and Operations Clear false. Repeat after pausing/resuming one WO, partial production, sibling QA, explicit finalized shortfall, and terminal closure; only the targeted WO may change.

For WO 3,000, issue 41 Kg, approve 1,500 consuming 20.25 Kg, and leave the entry Pending QC. Verify WO remains Active with 1,500 remaining and 20.75 Kg available. Pause with Machine Breakdown: only paused summary, Resume, and read-only history render; report/finalization APIs reject. Resume and save the remaining quantity without duplicating the first entry. Only explicit final confirmation may resolve return/actual wastage and close.
## Production Review & Finalize disposition UAT

1. WO 6,000: save Draft 3,000; verify no stock/QC/shortage posting.
2. Review & Finalize -> Continue; verify 3,000 Pending QC and 3,000 active in the same WO.
3. Repeat with Pause; start another WO, then Resume the original and verify only its balance returns active.
4. Repeat with Close WO with Shortage; verify terminal WO and exactly one 3,000 `PRODUCTION_SHORTFALL` source after retry/refresh and next-cycle creation.
5. Verify Pending Actions/deep links open Ready, Continue, Paused, draft Review & Finalize, or QC according to persisted state.
# Production RM planning/reconciliation acceptance

Verify 0%, 2.5%, and Admin-approved 7% allowance calculations; above-10% blocking; runner included once; Continue and Pause without report/carry-forward; Equal/Shortage/Extra routing to a QC-independent Production Report; automatic runner plus manual non-runner wastage; explained variance; Store-confirmed return; and exactly-once shortage recovery after report confirmation.
