# NO_QTY Agreement Planning Pipeline

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-022 |
| **Volume** | 2 — Business Architecture |
| **Chapter** | 3 — NO_QTY Agreement Planning Pipeline |
| **Title** | NO_QTY Agreement Planning Pipeline |
| **Version** | 1.0.8 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture |
| **Audience** | Product, workflow architects, implementation leads, Store/Purchase process owners |
| **Classification** | Product — Business Architecture |

**Parent documents:**

- [Chapter 1 — Business Models & Document Inheritance](./Chapter_01_Business_Models_and_Document_Inheritance.md)
- [Chapter 2 — REGULAR Order Planning Pipeline](./Chapter_02_REGULAR_Order_Planning_Pipeline.md)
- [Chapter 2 — FT ERP Constitution](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)
- [Chapter 3 — Glossary](../01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md)

**Related decisions:**

- [ADR-2026-001 — NO_QTY Planning and Execution Are Independent Axes](../10_Product_Lifecycle_and_Continuous_Evolution/adr/ADR-2026-001_NO_QTY_Planning_and_Execution_Are_Independent_Axes.md) — planning (RS/FG-line) and execution (WO) are independent axes; one RS may have multiple WOs.

---

## 1. Document Control

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial NO_QTY planning pipeline — agreement through Work Order creation |
| 1.0.1 | 2026-07-10 | FT ERP Product Team | Additional Plan source-identity coverage — RS/cycle components; no period+FG offset |
| 1.0.2 | 2026-07-10 | FT ERP Product Team | WO placement PA uses SO-wide locked-RS candidate (same as Execution Register) |
| 1.0.3 | 2026-07-10 | FT ERP Product Team | Admin reset: recovery/waiver children deleted before CarryForwardPending (Restrict FK order) |
| 1.0.4 | 2026-07-12 | FT ERP Product Team | §7.3 — draft RS continuous PRODUCTION_SHORTFALL sync / Store ownership |
| 1.0.5 | 2026-07-12 | FT ERP Product Team | §10 — RM-capped suggested WO; multi-WO RS remains open; RM Detail = proposed qty |
| 1.0.6 | 2026-07-14 | FT ERP Product Team | §11 / §11A — close/FG PA navigation; Current Stage vs SO close evaluation order |
| 1.0.7 | 2026-07-14 | FT ERP Product Team | §7.3 — Decision-only / Recovery-only cycle finalize when Current Requirement = 0 |
| 1.0.8 | 2026-07-14 | FT ERP Product Team | §7.3 — Post-RS-lock navigation: no Dispatch when zero FG; contextual Dispatch when ready |

**Supersedes:** None.

**Change authority:** Product Architecture. Changes affecting MPRS semantics or RS placement require Constitution compliance review and Volume 4 alignment.

**Out of scope for this chapter:** PMR, Material Issue, Production, QA, Dispatch, next-cycle replanning detail after dispatch (Volume 2, Chapter 4; cycle continuation in Volume 3).

---

## 2. Purpose

This chapter documents the **complete NO_QTY Agreement planning pipeline**—from commercial agreement through **Work Order creation**.

It explains **planning only**: how rolling customer demand becomes Requirement Sheet cycles, how **Monthly Production Planning Sheet (MPRS)** drives period procurement, how RM availability enables **WO placement**, and where planning **ends** at Work Order creation.

Manufacturing **execution** begins after Work Order and is documented in Volume 2, Chapter 4.

---

## 3. Scope

### 3.1 In scope

- NO_QTY planning philosophy and contrast with REGULAR
- Full planning pipeline stages (commercial + planning)
- Requirement Sheet and Planning Cycle behavior
- MPRS approval, freeze, and RM release
- MPRS procurement integration
- WO placement and creation
- Pending Actions and Control Tower for NO_QTY planning
- Planning Business Rules

### 3.2 Out of scope

- REGULAR Order planning ([Chapter 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md))
- Post–Work Order Execution Pipeline (Chapter 4)
- RM Control Center as primary REGULAR workspace (mentioned only for wrong-flow contrast)
- Workflow state matrices (Volume 4)
- Field-level specs (Volume 3)
- UI, API, database

### 3.3 Terminology

Uses [Glossary](../01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) terms. **NO_QTY Agreement** — not “No Qty SO” in specifications.

---

## 4. Relationship with Constitution & Business Models

| Source | Application in this chapter |
|--------|----------------------------|
| **Art. 4 — Business Model Selection at Enquiry** | Pipeline requires **NO_QTY Agreement** selected once at Enquiry |
| **Art. 5 — Business Model Inheritance** | All stages inherit NO_QTY from commercial chain |
| **Art. 6 — Two Planning Pipelines** | NO_QTY path only; no REGULAR_SO-primary planning |
| **Art. 7 — Planning vs Execution** | RS/MPRS/GRN/release do not start production; WO creation does not issue RM |
| **Art. 8 — One Manufacturing Pipeline** | WO creation hands off to common execution (Chapter 4) |
| **Ch. 1 §7** | NO_QTY lifecycle architecture |
| **Ch. 2** | Contrast reference for REGULAR differences |

---

## 5. NO_QTY Planning Philosophy

### 5.1 Quantity not fixed at agreement stage

**Internal Sales Order** under NO_QTY Agreement establishes the **commercial frame**—customer, terms, FG scope—not a fixed manufacturing quantity for the full agreement life. Quantities materialize in **Requirement Sheet** schedules and **MPRS** period plans.

*Contrast REGULAR:* Internal Sales Order lines commit fixed FG qty up front ([Chapter 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md) §5.1).

### 5.2 Demand-driven planning

Planning follows **actual and projected demand** (customer schedule, locked RS cycles, Green Level, carry forward)—not a single order-quantity explosion at SO creation.

### 5.3 Manufacturing follows Requirement Sheets

**Requirement Sheet (RS)** is the operational demand capture for a **Planning Cycle**. Work Orders are placed against **RS balance** when RM and policy allow—not directly from monthly plan lines.

### 5.4 Monthly planning drives procurement

**Monthly Production Planning Sheet (MPRS)** consolidates period FG intent and freezes RM requirement after **Purchase review** and **approval**. **RM release** publishes procurement demand to the **MPRS** pool—decoupling long-cycle RS from period-based buying.

*Contrast REGULAR:* Procurement driven by order-linked Material Requirement in **REGULAR_SO** pool without monthly plan document.

### 5.5 Procurement enables future Work Orders

Procurement from MPRS builds **RM availability** that enables future **WO placement** from RS—it does not by itself create Work Orders or start production.

---

## 6. Complete NO_QTY Planning Pipeline

| Stage | Owner (default) | Planning output |
|-------|-----------------|-----------------|
| **Enquiry** | Admin / commercial | Business Model = NO_QTY Agreement |
| **Feasibility** | Admin / commercial | Feasibility decision |
| **Quotation** | Admin / commercial | Commercial offer (agreement terms) |
| **Internal Sales Order (Agreement)** | Admin / commercial | Agreement frame; inherited NO_QTY |
| **Requirement Sheet** | Store | Cycle demand lines (FG schedule) |
| **Planning Cycle** | Store | Locked RS execution window |
| **Monthly Production Planning Sheet (MPRS)** | Store draft; Purchase review | Period FG plan; RM estimate |
| **Purchase review** | Purchase | Plan scrutiny before approval |
| **Approval** | Purchase | **Planning freeze** — RM Snapshot |
| **RM release** | Store | Procurement demand published (MPRS pool) |
| **Purchase Requisition** | Purchase | PR from MPRS Material Requirement |
| **Purchase Order** | Purchase | Supplier order |
| **Goods Receipt** | Store | RM into stock |
| **RM available** | System Read Model | Availability refresh |
| **WO placement** | Store | Validate RS balance vs RM |
| **Work Order creation** | Store | **Planning terminus** |

### 6.1 Stage narratives

**Commercial (Enquiry → Internal Sales Order)**  
Selects and inherits NO_QTY Agreement. Internal Sales Order is **agreement frame**—not primary qty driver for MPRS.

**Requirement Sheet & Planning Cycle**  
Store captures schedule/requirement lines per cycle. Locked RS becomes execution authority for WO placement quantity.

**MPRS → Purchase review → Approval**  
Store completes period FG plan. Purchase reviews (`AWAITING_PURCHASE_REVIEW` equivalent). Approval freezes plan and creates **Monthly Planning RM Snapshot**.

**RM release**  
Store releases frozen RM requirement to procurement—explicit handoff; **does not** create Work Orders.

**Procurement (MPRS pool)**  
Material Requirement in **MPRS** pool → Purchase creates PR → PO → Store GRN → availability refresh.

**WO placement → Work Order creation**  
When RS balance and RM readiness align, Store places one or more Work Orders (possibly **WO Batch**). Planning ends.

### 6.2 Contrast with REGULAR (summary)

| Dimension | REGULAR ([Ch. 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md)) | NO_QTY (this chapter) |
|-----------|---------------------------------------------------------------------|------------------------|
| Qty driver | Internal Sales Order FG qty | Requirement Sheet + MPRS |
| Primary Planning Workspace | RM Control Center / order RM readiness | Requirement & Cycle Planning + MPRS |
| Purchase review | PR/PO execution queue | **Monthly plan** approval |
| RM release | N/A (MR from order shortage) | Store release after plan approval |
| Procurement pool | REGULAR_SO | MPRS |
| PR creation (standard) | Store | Purchase (MPRS) |
| WO entry | Order WO prepare | RS **WO placement** |
| Cycles | Order completion | Repeating Planning Cycles |

---

## 7. Requirement Sheet

### 7.1 Demand capture

**Requirement Sheet** records **Requirement Lines**: FG item, schedule quantity (or planning quantity), and cycle identity. Lines express **what the factory should plan to make** for the cycle—not commercial invoice lines.

Demand may originate from customer schedule imports, manual entry, or carry forward from prior cycle shortfalls.

### 7.2 Planning cycles

A **Planning Cycle** is the bounded period associated with an RS version: plan → procure (via MPRS) → place WO → execute → dispatch → next cycle. Cycles preserve history; new RS versions supersede planning intent for forward work while retaining audit of locked sheets.

### 7.3 Carry forward

**Carry forward** rolls unmet or partially met cycle intent into the next planning view without double-counting fulfilled quantity. It maintains NO_QTY continuity across months—distinct from creating a new commercial order.

**Ownership:** Store owns next-cycle Requirement Sheet continuity. Production shortfall and final QC rejection create `CarryForwardPending` sources (`PRODUCTION_SHORTFALL` / `QC_FINAL_REJECTION`). The editable next-cycle draft RS **discovers** available recovery and seeds per-FG **PENDING Keep/Waive** decisions — it does **not** auto-allocate either type. Customer demand and system recovery remain separate RS line components. Planner Keep reserves all pending recovery for the FG item; Store or Admin Waive (mandatory reason) permanently waives it. Lock is blocked while any FG decision remains PENDING.

**Decision-only / Recovery-only cycle (zero Current Requirement):** When every carry-forward item is KEEP or WAIVE, Current Requirement = 0, Total To Produce = 0, Pending QC = 0, and no active WO / production pending, the RS **may still Finalize/Lock**. The UI shows “Recovery decisions completed. This cycle can now be finalized.” instead of “Awaiting requirement quantities.” After lock, the ACTIVE cycle closes without manufacturing (empty cycle cap). Historical RS cycles are execution history only — SO outstanding demand is **not** the sum of historical RS quantities. Outstanding resolves as Original Customer Demand − (Accepted & Dispatched + Waived). When Outstanding = 0, SO close becomes eligible.

**Post-lock navigation (RS Finalize):**
1. Recalculate NO_QTY flow state / dispatchable headroom.
2. If **no dispatchable FG** (decision-only waive, all already dispatched, or zero headroom) → return to the focused **NO_QTY Agreement summary** (Ready to Close or real blocker). **Do not** open Dispatch Workspace.
3. If **dispatchable FG exists** → open `/dispatch?flow=NO_QTY&source=no_qty_so&salesOrderId=…&cycleId=…` in **contextual mode** (SO + cycle pre-bound; no generic Sales Order dropdown / Open Line Queue hunt).
4. REGULAR SO and STOCK_REPLENISHMENT dispatch entry points are unchanged.

### 7.4 Green Level

**Green Level** is FG buffer planning metadata on items (manual or historically derived). It informs **suggested production** in MPRS composition—it is **not** RM minimum stock and not shop-floor safety stock.

### 7.5 Additional planning

**Additional Plan** (`planKind = ADDITIONAL` on Monthly Production Plan) captures incremental period demand after **Initial Plan** approval. Additional RM release follows same freeze/review discipline for delta requirement—ARR may cover ad-hoc needs outside main monthly freeze per Glossary.

---

## 8. Monthly Production Planning Sheet (MPRS)

### 8.1 Monthly demand consolidation

MPRS Workspace consolidates **period FG planned quantities** (from RS lines, suggestions, Green Level shortage composition) into a **Monthly Production Plan** document per period. Multiple plan documents per period may exist (Initial, Additional) with sequence numbering.

### 8.2 Procurement planning

Before approval, Store sees **live RM estimate** from planned FG; after Purchase **approval**, system creates **Monthly Planning RM Snapshot** (frozen RM lines). Procurement planning is snapshot-based post-approval—not live re-explosion at release.

### 8.3 Approval process

| Step | Actor | Outcome |
|------|-------|---------|
| Store completes draft | Store | Submit for Purchase review |
| Purchase review | Purchase | Approve or reject with reason |
| Approval | Purchase | Plan status **APPROVED**; RM Snapshot frozen |
| Pending release | Store | RM requirement visible; not yet in procurement queue |

*Contrast REGULAR:* No monthly plan document; MR raised directly from order shortage.

### 8.4 Planning freeze

**Planning freeze** occurs at Purchase **approval**. FG plan lines and RM Snapshot are immutable for execution reference until Additional Plan or formal revision policy (Volume 3). Execution and procurement must cite frozen revision.

### 8.5 Additional plans

**Additional Plan** documents capture mid-period FG/RM deltas for **uncovered requirement components** identified by Requirement Sheet / cycle / line / component type. Purchase reviews and approves; release adds incremental MR demand to MPRS pool without rewriting Initial Plan history.

**Must not** treat Additional Plan as `current period FG suggested qty − sum(all prior approved plan FG qty)`. An approved Plan 1 bound to RS-1 must not offset RS-2 demand for the same FG in the same period. Production shortfall already embedded on the eligible RS is counted once; pending QC rejection is not carried forward until finalized on the RS.

---

## 9. Procurement Integration

### 9.1 MPRS procurement pool

Released monthly plan demand creates **Material Requirement** documents with source **MONTHLY_PLAN**, visible in Procurement Workspace under demand pool **MPRS**—never **REGULAR_SO**.

### 9.2 Purchase ownership

| Activity | Owner |
|----------|-------|
| Monthly plan Purchase review & approval | Purchase |
| RM release to procurement | Store |
| Create Purchase Requisition (MPRS MR) | Purchase |
| Purchase Order | Purchase |
| GRN | Store |

*Contrast REGULAR:* Store creates PR; Purchase review means PR queue not plan approval ([Chapter 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md) §6).

### 9.3 RM release

**RM release** is Store’s explicit action after plan approval publishing frozen RM requirement to procurement **when Estimated Net RM Requirement > 0**. It is a **handoff**, not GRN and not WO creation.

**Branch (authoritative):**

**A. After Requirement Sheet lock (before Monthly Plan exists)** — evaluate **FG-item RM feasibility** for the locked RS remaining balance (shared-RM safe via batch placement):

- **FG item fully covered by free usable RM** → `READY_FOR_WO` for that FG → **allow WO creation** without waiting for Monthly Plan / Purchase / Release for that item  
- **FG item has RM shortage** → `PROCUREMENT_REQUIRED` for that FG → include only that shortage in Monthly Planning → block WO **only for that FG**  
- **All FG stock-covered (sheet Net RM = 0)** → Outcome **PROCUREMENT_NOT_REQUIRED** → **skip** Monthly Planning, Purchase Approval, and Procurement Release → Pending Action **Work Order Planning**  
- **Mixed RS** → Place WO for ready FG **and** Monthly Planning Pending for shortage FG may coexist; **do not** whole-RS-lock ready items behind period release  

**B. After Purchase Approval (frozen Monthly Planning RM Snapshot):**

- **Net RM > 0** → Release RM Requirement → MR in MPRS pool → Procurement → GRN → Execution  
- **Net RM = 0** → **Procurement Not Required** (sets `releasedAt`, **no** MR) → Execution Ready → WO / Material Issue  

**Rule:** RM release **never** creates Work Orders. Zero-net / stock-ready paths **SHALL NOT** create Procurement Workspace entries for covered FG. One FG shortage **SHALL NOT** block WO creation for other FG items on the same locked RS.

### 9.4 Purchase Requisition → PO → GRN

Standard procurement pipeline: MR → PR → PO → GRN. Traceability chain includes plan label, MR doc no, revision (Volume 3).

### 9.5 RM availability refresh

After GRN, **Material Availability** and placement readiness recompute. WO placement evaluates **current** stock plus incoming—not stale pre-GRN snapshots.

---

## 10. WO Placement

### 10.1 RM validation

Before Work Order creation, Store validates **per FG item**:

- Requirement Sheet cycle is **locked** and the FG line has remaining placement balance
- That FG’s BOM RM coverage supports the intended placement qty (policy-defined use of free usable stock, reservations, and shared-RM allocation across FG lines on the sheet)
- Approved BOM for the FG line
- Shortage FG may remain blocked for procurement while **other** RM-ready FG lines on the same locked RS **may** place WO without waiting for Monthly Plan release

Whole-RS “wait for period release before any WO” is **not** the gate when some FG are stock-executable.

### 10.2 Partial RM

If RM supports only part of RS line balance:

- **Suggested WO quantity** reduced proportionally or per line policy
- Multiple placement waves allowed as GRNs arrive
- Unplaced balance remains on RS for later cycles

*Contrast REGULAR:* Partiality tied to order line; here tied to **RS line balance**.

### 10.3 Suggested WO quantity

Minimum of:

- RS line remaining placement balance
- RM-readiness-constrained FG capacity (canonical free stock ÷ BOM requirement per FG unit, including wastage/UOM rules)
- Period/cycle policy limits (Volume 3)

Suggested WO quantity **must not** simply repeat full RS balance when RM cannot support it. Open PO / unposted GRN **must not** count as available RM.

### 10.4 Multiple WO placement

**Multiple Work Orders** may be created from **one Requirement Sheet** across placement waves or FG lines (**WO Batch** grouping). Each WO consumes RS placement balance by its **planned** quantity; cumulative placed qty cannot exceed RS line balance minus prior active placements.

After each WO creation:

- Recalculate remaining requirement and RM-limited capacity
- Keep the RS in Store’s Work Order Planning queue while Remaining Requirement > 0 (unless authorised waiver/closure completes)
- Allow Store to create the next WO immediately or return later
- Each created WO may proceed independently to Material Issue / Production

Creating one WO **does not** close the RS or remove it from the active placement queue.

### 10.5 Store ownership

**WO placement** and **Work Order creation** are Store-owned (Product Standard).

### 10.6 Planning ends after Work Order creation

Work Order is handoff to **Execution Pipeline** (PMR → Material Issue → Production → QA → Dispatch). Post-dispatch, factory returns to **next Planning Cycle** planning—not continuation of this chapter.

---

## 11. Pending Actions

**Active-cycle execution priority:** The active cycle remains the primary execution context while its locked RS has `remainingToPlace > 0`, or its Work Orders still have Store-owned execution. If FG-level RM capacity is positive, the primary action is **Create Work Order / Continue WO Planning** for that cycle; otherwise it is **View Planning Status / Await Procurement**. Production or QC completion of one WO does not make the next cycle primary. **Create Next Cycle** is emitted only after the canonical cycle-completion policy permits it. Pending Actions, Execution Register, and Control Tower use the same placement candidate, RM readiness, action type, and target.

Engine-generated only (Constitution Art. 12). Representative **NO_QTY planning-phase** actions:

### 11.1 Store

| Pending Action (examples) | Context |
|---------------------------|---------|
| Complete / lock Requirement Sheet | Cycle not ready for execution |
| Complete Monthly Production Plan draft | Period FG not submitted |
| Release RM requirement to procurement | Plan approved; `releasedAt` pending; **net RM > 0** |
| WO placement / Create Work Order / Material Issue | RS balance + RM readiness (includes **Procurement Not Required** when net RM = 0). Store WO Pending Action uses the **same SO-wide locked-RS candidate** as the Execution Register — not ACTIVE-cycle-only. |
| Continue NO_QTY planning | Post-dispatch next cycle (planning hub) |

### 11.2 Purchase

| Pending Action (examples) | Context |
|---------------------------|---------|
| Review Monthly Production Plan | `AWAITING_PURCHASE_REVIEW` |
| Approve plan | Freeze snapshot |
| Create Purchase Requisition | MPRS MR awaiting PR |
| Prepare RM PO | PR in MPRS pool |

### 11.3 Admin

| Pending Action (examples) | Context |
|---------------------------|---------|
| Commercial pipeline tasks | Enquiry → Quotation |
| Agreement amendments | Commercial only—no Business Model change |
| Accepted FG disposition required | Deep-link **NO_QTY Agreements** + FG disposition workspace (`action=no-qty-fg-disposition`) — never Regular Orders |
| NO_QTY SO blocked by unresolved downstream work | Deep-link focused NO_QTY Agreement with `highlight=downstream` |
| NO_QTY SO eligible for waiver closure | Deep-link NO_QTY Agreements close workspace (`action=no-qty-close`) |

*REGULAR-specific actions (order RM Control Center primary, Store PR from REGULAR_SO) must not appear as primary NO_QTY paths.*

---

## 11A. Current Stage & SO Close (downstream)

**Current Stage** on NO_QTY Agreements is computed from downstream evidence and **must not** combine Production and QA into one generic label.

| Stage examples | When |
|----------------|------|
| Production Running | Execution-aware production remaining on active cycle WOs |
| QC In Progress | Approved production batches with QC pending (shop floor may show Pending QC) |
| FG Disposition Pending | Accepted FG still needs disposition before close |
| Recovery Decision Pending | Closure mode `WAIVER_REQUIRED` |
| Dispatch Pending | Manufacturing complete; dispatch not posted |
| Ready to Close | **`assessNoQtySoClosure` mode = COMPLETE** (never from billing caption alone) |
| Dispatch Pending | Close still blocked on draft/unmet RS dispatch |
| Billing Pending Export | Finalized Sales Bill without `exportedAt` |

**SO close evaluation order** (`assessNoQtySoClosure`): Outstanding WO → Production (incl. PMR) → QC → FG Disposition → Recovery (waiver mode) → Dispatch dependency → Sales Bill / Export dependency → Close Allowed. Each blocker reports the **exact** record (e.g. `Dispatch D-26-0008 not finalized`, `Sales Bill SB-26-0003 not exported`, remaining RS dispatch qty by item)—never a generic outstanding-dispatch label when a specific document can be named.

**SSOT rule:** Current Stage, Pending Actions (`NO_QTY SO blocked by unresolved downstream work`), and Close validator **must** derive from `assessNoQtySoClosure`. Ready to Close and close success/failure cannot disagree. When billing caption shows “Billing completed · Exported” but ACTIVE-cycle locked RS still has unmet dispatch cap, Current Stage is **Dispatch Pending**, not Ready to Close.

### 11A.1 Work Order Tracking Report (NO_QTY flow)

The Analysis **Work Order Tracking** report must **not** apply Regular SO quantity-pipeline pending (WO qty − produced, Accepted − WO FIFO) to NO_QTY history.

When flow = **NO_QTY**:

- **Customer Demand** = locked RS `baseDemandQty` (fallback `requirementQty`) — never recovery / carry-forward / WO qty.
- **Active Production Pending** = 0 after SO/cycle/WO/execution closure or shortfall handoff (`getEffectiveProductionPendingQty`).
- **Active Dispatch Pending** = cycle SO+FG remaining vs locked RS cap — 0 when SO/cycle closed; never WO FIFO.
- Closed SO-242 / SO-243 style agreements must not appear as IN PRODUCTION under Active Only.

See `docs/WORK_ORDER_TRACKING_REPORT_STANDARD.md`.

---

## 12. Control Tower Visibility

| Theme | NO_QTY visibility |
|-------|-------------------|
| **Planning backlog** | Draft RS, draft MPRS, plans awaiting Purchase review |
| **Procurement bottlenecks** | Approved plan not released; MPRS MR/PR/PO/GRN aging |
| **RM shortages** | Cycle/period RM gap vs incoming |
| **Cycle progress** | RS locked → placed WO qty → remaining balance |
| **WO waiting for RM** | RS ready but placement blocked on availability |
| **Owner & recommended action** | Store vs Purchase per stage |

Control Tower monitors; Dashboard carries owned Pending Actions.

---

## 13. Business Rules

| ID | Rule |
|----|------|
| **NPL-01** | Pipeline applies only when inherited Business Model = **NO_QTY Agreement**. |
| **NPL-02** | **Requirement Sheet** drives manufacturing demand capture for WO placement. |
| **NPL-03** | **MPRS** drives period **procurement** after approval, release, and MR creation. |
| **NPL-04** | **Planning never starts execution**—no PMR/issue/production from plan approve/release/GRN. |
| **NPL-05** | **RM release never creates Work Orders.** |
| **NPL-06** | **Multiple Work Orders** may originate from one Requirement Sheet within balance limits. |
| **NPL-07** | Work Orders **consume Requirement Sheet placement balance** on creation. |
| **NPL-08** | **REGULAR_SO** and **MPRS** procurement pools **never mix** in one PR or MR source set. |
| **NPL-09** | NO_QTY demand **must not** use REGULAR order WO prepare as primary entry. |
| **NPL-10** | **Purchase review** on NO_QTY means **monthly plan approval**—not interchangeable with REGULAR PR queue review. |
| **NPL-11** | **Purchase** creates PR for MPRS MR (standard); Store creates PR for REGULAR_SO (standard). |
| **NPL-12** | **Planning freeze** at Purchase approval; execution cites frozen RM Snapshot. |
| **NPL-13** | **Customer PO** (reference) never starts RS, MPRS, release, or WO. |
| **NPL-14** | **ARR** and stock replenishment are supplementary—cannot replace base MPRS release for plan-driven demand. |
| **NPL-15** | WO creation **terminates** placement planning for placed qty; execution rules apply thereafter. |

---

## 14. Lifecycle Diagram

```mermaid
flowchart TB
  subgraph Commercial["Commercial (NO_QTY inherited)"]
    ENQ[Enquiry]
    FEZ[Feasibility]
    QUO[Quotation]
    ISO[Internal Sales Order<br/>Agreement frame]
    ENQ --> FEZ --> QUO --> ISO
  end

  subgraph Cycle["Requirement & cycle planning"]
    RS[Requirement Sheet]
    PC[Planning Cycle locked]
    HUB[Requirement and Cycle Planning]
    ISO --> HUB --> RS --> PC
  end

  subgraph MPRS["Monthly Production Planning Sheet"]
    MPP[MPRS period plan draft]
    PREV[Purchase review]
    APR[Approval / planning freeze]
    REL[RM release to procurement]
    PC --> MPP --> PREV --> APR --> REL
  end

  subgraph Procurement["Procurement (MPRS pool)"]
    MR[Material Requirement]
    PR[Purchase Requisition]
    PO[Purchase Order]
    GRN[Goods Receipt Note]
    AVAIL[RM available]
    REL --> MR --> PR --> PO --> GRN --> AVAIL
  end

  subgraph Placement["WO placement"]
    PL[WO placement validation]
    WO[Work Order created]
    AVAIL --> PL
    PC --> PL
    PL --> WO
  end

  subgraph Next["Handoff — not this chapter"]
    EXEC[Execution Pipeline<br/>PMR → Issue → Production → QA → Dispatch]
    WO -.->|planning ends| EXEC
  end
```

---

## 15. Review Checklist

- [ ] Planning-only; execution deferred to Chapter 4
- [ ] NO_QTY inheritance from Chapter 1
- [ ] Clear contrast with Chapter 2 (REGULAR) at §5–6 and tables
- [ ] Glossary terms; NO_QTY Agreement naming
- [ ] Purchase review = monthly plan (not REGULAR PR review)
- [ ] RM release distinguished from WO creation and GRN
- [ ] MPRS pool vs REGULAR_SO segregation
- [ ] RS balance consumption by WO documented
- [ ] Pending Actions and Control Tower sections complete
- [ ] Business Rules NPL-01–NPL-15
- [ ] Mermaid lifecycle diagram
- [ ] No UI, API, schema, implementation

---

## 16. Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial NO_QTY Agreement planning pipeline |

---

## 17. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture | | | |
| Store Process Owner | | | |
| Purchase Process Owner | | | |

---

## Document navigation

## Injection-moulding BOM calculation used by NO_QTY planning

NO_QTY live estimates and approved monthly RM snapshots consume the approved engineering recipe. Runner/sprue material is included through `Shot Weight = (FG Weight × Output Qty) + Runner Weight`. Component RM demand is derived from component mix against shot weight. Process wastage, QC rejection allowance, and planning buffer are not BOM inputs; planning policy remains explicit in the planning document and actual losses remain execution facts.

| | Link |
|--|------|
| **Previous** | [REGULAR Order Planning Pipeline](./Chapter_02_REGULAR_Order_Planning_Pipeline.md) (FT-PD-021) |
| **Next** | [Manufacturing Execution Pipeline](./Chapter_04_Manufacturing_Execution_Pipeline.md) (FT-PD-023) |
| **Volume** | [Business Architecture](./README.md) |
| **Product** | [Product Documentation Index](../README.md) |


## Batch 3E — Recovery / Closure analytics surfaces (read-only)

Dashboard, Pending Actions, Control Tower, and Reports consume `assessNoQtySoClosure()` and `getRecoverySummary()` / `getRecoverySummariesBatch()` via `noQtyRecoveryAnalyticsService`. Production Shortfall and QC Recovery remain separate **recovery types and RS line components**. They do **not** appear as duplicate Store inbox CTAs when Create Cycle N Requirement Sheet already covers the next-RS obligation. Reconciliation identity: Source Qty = Active Allocated + Waived + Available. No mutation of recovery, RS allocation, stock, dispatch qty, billing qty, or SO closure transactions in this batch.

**Navigation (FT-PD-040 §7.12):** FG disposition / waiver-close / downstream-blocked Pending Actions deep-link to **NO_QTY Agreements** with `salesOrderId` context (role-aware). Never Regular Orders / `focusSalesOrderId`.

## Batch 3F — Certification

Final cleanup validated: QA/QC recovery columns, Control Tower recovery monitor (read-only), reconciliation identity, migration `20260710120000_no_qty_recovery_foundation` applied on target DB, analytics surfaces consume `assessNoQtySoClosure` / `getRecoverySummariesBatch`. `MANUALLY_CLOSED` retained for dual-read only; operational close uses `CLOSED_WITH_WAIVER` / `COMPLETED`. Physical rework remains QA-owned; QC recovery starts at terminal rejection; Green Level isolated; WO shortfall waiver ≠ SO closure waiver.

## UAT — Current Stage / PA navigation / SO close

| Case | Setup | Expected |
|------|-------|----------|
| 1 | Everything complete (close SSOT COMPLETE) | Stage **Ready to Close**; no downstream-blocked PA; close succeeds |
| 2 | Dispatch incomplete (RS cap / draft) | Stage **Dispatch Pending**; close blocked with **exact** dispatch/RS reason |
| 3 | Sales Bill finalized but not exported | Stage **Billing Pending Export**; close blocked naming the bill |
| 4 | QA pending | Stage **QC In Progress**; close blocked |
| 5 | Recovery pending (waiver mode) | Stage **Recovery Decision Pending**; close requires waiver |
| 6 | Pending Action navigation | FG → FG workspace; Downstream blocked → focused NO_QTY Agreement; **never** Regular Orders |
| 7 | Decision-only recovery (all WAIVE, Current Requirement = 0) | Finalize RS enabled; lock succeeds; cycle closes; SO close reassessed — **no** infinite draft loop |
| 8 | Production cycle (positive Current Requirement) | Finalize still requires qty / Total to Produce; decision-only path **not** used |
| 9 | KEEP on carry-forward | Increases Total to Produce / RS demand; decision-only path blocked until produced or later waived |
| 10 | WAIVE remaining obligation | Removes outstanding; when Outstanding Qty = 0 and other gates clear, SO close eligible |
| 11 | SO outstanding identity | Original Customer Demand = Accepted & Dispatched + Waived + Outstanding — **not** sum of historical RS quantities |
| 12 | RS Finalize with no dispatchable FG | Lands on NO_QTY Agreement summary — **not** generic Dispatch Workspace |
| 13 | RS Finalize with dispatchable FG | Contextual `/dispatch?source=no_qty_so&salesOrderId&cycleId` — SO/cycle pre-bound |
