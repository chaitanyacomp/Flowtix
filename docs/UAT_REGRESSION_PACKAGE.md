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

### Final pre-go-live checks (recommendations)

1. **Data backup** before UAT on shared environments; restore procedure documented.
2. **One full P0 pass** on production-like config (`NODE_ENV=production`) for error message wording.
3. **Parallel run:** compare report totals (dispatchable, shortage) to a **manual spreadsheet** for one complex SO.
4. **Access review:** confirm who can delete masters vs run transactions (smoke test UX-003).
5. **Rollback plan:** if critical defect in P0, freeze releases until fixed and re-run §4.

---

*Document version: 1.0 — aligned with post-integrity-fix manufacturing ERP behavior described in project context.*
