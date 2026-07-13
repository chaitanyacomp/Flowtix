# ADR — NO_QTY Planning and Execution Are Independent Axes

| Field | Value |
|-------|-------|
| **Decision identifier** | ADR-2026-001 |
| **Document ID** | FT-ADR-2026-001 |
| **Governing policy** | [FT-PD-101 — Feature Governance, Change Control & ADRs](../Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md) §7 |
| **Volume** | 10 — Product Lifecycle & Continuous Evolution (ADR registry) |
| **Title** | NO_QTY Planning and Execution Are Independent Axes |
| **Status** | Proposed |
| **Date** | 2026-07-13 |
| **Version** | 1.0.0 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture Board |
| **Audience** | Product owners, architecture board, workflow leads, Store/Production/QA/Purchase process owners, implementation partners, validation leads |
| **Classification** | Product — Architecture Decision Record |

**Parent / authoritative documents:**

- [FT-PD-022 — NO_QTY Agreement Planning Pipeline](../../02_Business_Architecture/Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md)
- [FT-PD-031 — Planning Domain Specification](../../03_Domain_Specifications/Chapter_02_Planning_Domain_Specification.md)
- [Volume 4 Ch. 1 — Workflow Engine Overview & Pending Actions Contract](../../04_Workflow_Engine/Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md)
- [Volume 4 Ch. 4 — Planning Workflow State Machine](../../04_Workflow_Engine/Chapter_04_Planning_Workflow_State_Machine.md)
- [Volume 6 Ch. 3 — Control Tower Architecture](../../06_UI_and_Experience_Architecture/Chapter_03_Control_Tower_Architecture_and_Factory_Monitoring.md)
- [FT-PD-101 — Feature Governance, Change Control & ADRs](../Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md)

---

## 1. Title

**NO_QTY Planning and Execution Are Independent Axes** — the NO_QTY workflow is modelled as two concurrent, independently-evaluated axes (Planning = Requirement Sheet / FG-line; Execution = Work Order), never as a single linear pipeline collapsed onto one representative Work Order or one scalar cycle state.

## 2. Status

**Proposed** (ADR lifecycle per FT-PD-101 §7.3: Proposed → Accepted → Superseded/Rejected). Acceptance by the Architecture Board authorizes the phased implementation in §24.

## 3. Date

2026-07-13. First entry in the FT ERP ADR registry.

## 4. Context

The authoritative NO_QTY hierarchy is:

```
NO_QTY Sales Order
  └─ Sales Order Cycle
       └─ Requirement Sheet (Planning)
            └─ Multiple FG Lines
                 └─ Each FG Line → Multiple Work Orders (Execution)
                      └─ Production Batches
                           └─ QA / QC
                                └─ Dispatch (pooled by FG item where documented)
```

Business facts (authoritative):

- One Requirement Sheet (RS) may contain **multiple FG lines**.
- Each FG line may generate **multiple Work Orders (WOs)**.
- **RS = planning**: it calculates FG demand and BOM-based total RM requirement and drives Monthly Planning / procurement.
- **WO = execution**: production and QC are WO-centric.
- Dispatch is **pooled by FG item** where documented.
- **Current execution and future planning may run in parallel** (rolling planning).

The multi-WO capability (one RS creating multiple WOs against remaining RS balance) is now live (see FT-PD-022 §10). Investigations proved the workflow engine and several consumers still carry a legacy **one-RS-one-WO** assumption originating from the era when a Requirement Sheet produced exactly one Work Order. That assumption survives as scalar/boolean collapses and as a linear pipeline that promotes "next RS" over active production.

## 5. Problem Statement

The workflow engine and its consumers conflate **planning** and **execution** and collapse a multi-WO cycle to a single representation, producing incorrect operator guidance. Concretely observed and confirmed:

- A cycle with WO-A (produced, QC done) and WO-B (active, 0 produced, full remaining) is reported as **"Cycle ready for Next RS"**, suppressing WO-B's production action.
- Root cause: **"any production exists in the cycle" is treated as "cycle production complete"**, and **"next RS eligible" is promoted above active WO production**.
- Secondary carriers of the same assumption: a single exported representative Work Order id (last WO), boolean "production exists / QC exists" completion proxies, a single "best WO per Sales Order" dashboard collapse, cycle auto-close driven by dispatch alone (ignoring active WOs), and a Control Tower that re-derives status from isolated rows and de-duplicates them at cycle level (hiding sibling WO states).

This ADR must **eliminate every future interpretation** of:

1. One RS = One WO
2. One FG = One WO
3. Any production means cycle complete
4. Any QC means cycle complete
5. Next RS readiness means current execution is complete

## 6. Decision

**The NO_QTY workflow shall be modelled as two independent axes evaluated concurrently:**

- **Planning axis** — owned by the Requirement Sheet, aggregated at **RS / FG-line** level: RS balance, create-WO eligibility, RM-supported capacity, next-RS eligibility, planning completeness.
- **Execution axis** — owned by the Work Order, aggregated **per WO** (and summed to cycle only for quantity totals): active WOs, production required, QC pending, dispatch-ready quantity, all-WOs-terminal.

The Workflow Engine **consumes both axes** and emits decisions and role actions. It shall **not** treat planning and execution as a single linear pipeline, shall **not** designate a single representative WO as the cycle, and shall **not** use "production exists" or "QC exists" as completion proxies. **Next-RS planning may be offered in parallel but must never suppress or outrank active Work Order execution.**

Canonical quantity math is owned by the planning/execution contracts (§9); the engine must not re-derive it.

## 7. Domain Boundaries

| Boundary | Owns (authoritative) | Must NOT own |
|---|---|---|
| **Requirement Sheet (Planning)** | Customer FG requirement snapshot; FG-line requirement qty; BOM-based total RM requirement; WO qty placed per FG; RS balance per FG; planning status; procurement coverage | Production completion; QC completion; WO operational status; dispatch execution status |
| **Work Order (Execution)** | Planned execution qty; material issue; production qty; production remaining; QC state; WO completion / shortfall status | Customer requirement; RS balance; RM demand calculation; next-RS eligibility |
| **Sales Order Cycle** | The container linking one planning RS to 1..N execution WOs; cycle lifecycle (ACTIVE/CLOSED) | Being "complete" because one WO finished |
| **Workflow Engine** | Decisions and role actions derived from both axes | Quantity formulas; single-WO representation; completion proxies |

Customer Requirement never changes. Existing WOs remain immutable except through documented lifecycle actions.

## 8. Canonical Data Ownership

- **RS owns** (planning): FG-line requirement quantities, BOM RM requirement, `woPlacedQty` per FG (Σ across all non-rejected WOs), `rsBalanceQty` per FG, planning status, procurement coverage.
- **WO owns** (execution): planned execution qty, material issue, produced qty, production remaining, QC state, terminal status (COMPLETED / CLOSED_WITH_SHORTFALL / REJECTED).
- **Recovery** (shortfall / QC rejection) is owned at the **recovery-source / carry-forward** level, keyed to its originating WO where applicable; it is **not** absorbed back into RS planning quantities and never mutates existing WO quantities.
- **Single source of truth:** planning quantities are produced once by the planning contract and read (not recomputed) by every consumer; execution quantities are produced once per WO and read by every consumer.

## 9. Canonical Quantity Rules

Let a Requirement Sheet cover FG lines `f ∈ F`, each with `RSRequirementQty(f)`.

**Participating WO statuses (placed):** `PENDING, IN_PROGRESS, HOLD, PAUSED, COMPLETED, CLOSED_WITH_SHORTFALL`. **Excluded:** `REJECTED` (and any voided/reversed WO).

**Per FG line — RS Balance:**

```
RSBalanceQty(f) = max(0, RSRequirementQty(f) − Σ WOPlannedQty(w, f))
                  over all WOs w in {participating statuses} for FG line f
```

**Cycle planning totals:**

```
TotalRSRequirement = Σ_f RSRequirementQty(f)
TotalWOPlaced      = Σ_f Σ_w WOPlannedQty(w, f)
TotalRSBalance     = Σ_f RSBalanceQty(f)
```

**Per WO — Production Remaining (execution axis):**

```
ProductionRemainingQty(w) =
    (w is ACTIVE)  →  max(0, WOPlannedQty(w) − ApprovedProducedQty(w))
    (w is TERMINAL) → 0
```

- **ACTIVE** = `PENDING, IN_PROGRESS, HOLD, PAUSED` (HOLD/PAUSED are active-but-suspended; remaining exists but is gated).
- **TERMINAL** = `COMPLETED, CLOSED_WITH_SHORTFALL, REJECTED`. **A WO closed with shortfall must not remain "Production Required."**

**Cycle execution remaining:**

```
CycleProductionRemaining = Σ over ACTIVE WOs of ProductionRemainingQty(w)
```

**Non-negativity:** all balances and remainders are floored at 0. No negative allocation. RM-supported executable capacity caps a new WO in addition to RS balance (create-WO eligibility requires `RSBalanceQty(f) > 0` AND RM-supported capacity `> 0`).

## 10. Planning State Model (RS / FG-line axis)

| Planning signal | Definition |
|---|---|
| `rsBalanceQty(f)`, `totalRSBalance` | Remaining unplaced FG demand (§9) |
| `createWoEligible(f)` | `rsBalanceQty(f) > 0` AND RM-supported capacity `> 0` |
| `rmSupportedCapacity(f)` | RM-limited executable quantity for the FG line |
| `nextRsEligible` | Demand-driven rolling eligibility (RS locked/cancelled, no later locked/draft RS, WO coverage present) — **independent of execution completion** |
| `planningComplete` | `totalRSBalance ≤ 0` (all FG demand placed) or explicitly waived |

Planning state is **cycle/RS-scoped** and remains valid regardless of how many WOs exist or their execution status.

## 11. Execution State Model (WO axis)

Per Work Order `w`:

| Execution signal | Definition |
|---|---|
| `status(w)` | ACTIVE (PENDING/IN_PROGRESS/HOLD/PAUSED) or TERMINAL (COMPLETED/CLOSED_WITH_SHORTFALL/REJECTED) |
| `productionRemainingQty(w)` | §9 (0 when terminal) |
| `qcState(w)` | per-WO / per-batch QC pending / accepted / rejected |
| `dispatchReadyQty` | QC-accepted-undispatched, **pooled by FG item** across WOs |
| `allWosTerminal` | every non-rejected WO on the cycle is terminal |

The canonical execution summary is a **list of WOs with their per-WO state**, plus FG-pooled dispatch headroom — never a single representative WO.

## 12. Workflow Decision Model

The engine receives `{ planningState, executionSummary[] }` and emits: an ordered set of **available actions** (not a single scalar that hides parallel work), a **primary action** for single-CTA surfaces, and **role-scoped actions**.

Rules:

1. The engine **reads** planning and execution signals; it does **not** recompute §9 formulas.
2. **Production** is decided **per active WO** (`productionRemainingQty(w) > 0`) and is never suppressed by any planning signal.
3. **Next-RS** is a **planning-axis action**, emitted **in parallel** as secondary whenever `nextRsEligible`, and is chosen as *primary* only when the execution axis has **no active work** (see §13/§14).
4. No decision may be derived from `productionExists` / `qcExists` booleans or a single representative WO id.

## 13. State Priority Rules

Canonical priority for selecting the **primary** action on single-CTA surfaces (higher = wins). Execution actions are per-WO and planning actions are parallel; this ordering resolves only the *headline*:

1. **Blocking validation / unresolved disposition** (rework/hold pending)
2. **Active WO production** (any active WO with `productionRemainingQty > 0`)
3. **QC pending** (per WO / batch)
4. **Dispatch action** (FG-pooled dispatch-ready qty)
5. **Create another WO** (`rsBalanceQty > 0` AND RM capacity)
6. **Next RS planning** (parallel; secondary)
7. **Completion / idle**

**NEXT_RS may always be *available* as a parallel planning action but must never suppress or outrank active WO execution (ranks 2–4).** One completed WO must not raise the cycle to a "Next RS ready" headline while a sibling WO is active.

## 14. Completion Rules

A **cycle** is complete only when **all** of the following hold:

- All relevant WOs are **terminal**;
- **No active production** remaining (`CycleProductionRemaining ≤ 0`);
- **No QC pending** on any batch;
- **No unresolved disposition** (rework/hold);
- **Dispatch / commercial completion** as applicable (FG-pooled);
- **RS balance zero or explicitly waived**;
- **No hidden sibling WO** remaining.

**Dispatch quantity alone must not close a cycle while active WOs remain.** WO completion and cycle completion are distinct: completing one WO never implies cycle completion.

## 15. Next RS Rules

- Next-RS eligibility and current execution are **independent**.
- The next RS **may be planned while current WOs are active** where rolling planning applies.
- However: the **Production Workspace must continue showing active WO actions**; Next RS remains **secondary/parallel**; **one completed WO must not make the cycle `NEXT_RS_READY`**; **RS balance and active WOs must be visible separately.**
- Next-RS eligibility remains demand-driven (planning), not gated on execution completion — but it does not *promote* to primary while execution work remains.

## 16. Pending Actions Ownership

Ownership is defined **by action**, derived from both axes — **not** by a single cycle state. (This ADR documents the authoritative mapping; it does **not** change existing ownership.)

| Action | Axis | Canonical owner |
|---|---|---|
| Create WO / place WO | Planning | **Store** |
| Issue material | Execution | **Store** |
| Execute active WO (production) | Execution | **Production** |
| Pending QC | Execution | **QA** |
| Procurement actions | Planning-driven | **Purchase** |
| Dispatch | Execution (FG-pooled) | **Store** |
| Create Next RS (planning) | Planning | **Store** |
| Commercial closure / waiver | Completion | **Admin** (where documented) |

Because ownership is per action, a Store "Create Next RS" action and a Production "execute active WO" action **legitimately coexist** for the same cycle.

## 17. Dashboard / Control Tower Representation

- **Production Workspace is WO-centric** — shows each active WO's own production action; never gated by a cycle-level scalar.
- **Store RS Workspace is RS / FG-line-centric** — shows RS balance and create-WO per FG line.
- **Dashboard may show multiple active WOs** for one cycle (no one-row-per-SO production collapse).
- **Control Tower must not collapse sibling WO states into one misleading cycle row.** It must consume the authoritative engine axes and preserve per-WO rows; de-duplication must not discard differing sibling statuses.
- **Planning actions and execution actions may both appear simultaneously.**

## 18. Reporting Impact

- Execution reports (production, QC, WO completion/shortfall) aggregate **per WO** and roll up to cycle only as sums.
- Planning reports (RS balance, RM requirement, procurement coverage, placed vs. demand) aggregate at **RS / FG-line**.
- "Cycle progress" must be computed from **all** WOs and RS balance, not a single WO. Any report that currently reads a representative WO or a scalar cycle state is in scope for correction (Phase D/E).

## 19. Recovery Impact

- Production shortfall (auto) and QC final rejection (manual) remain **distinct carry-forward records** at recovery-source level, keyed to the originating WO where applicable.
- Recovery is **not** moved back into RS planning quantities and **never** mutates existing WO quantities (see Rejected Alternatives §21.6–§21.7).
- A terminal WO closed with shortfall generates recovery and is **not** counted as "production required" (§9).

## 20. Compatibility and Migration Strategy

- **Backward-compatible scalar fields may temporarily remain**, but every field that represents cycle state through a single WO — notably a representative `workOrderId` (last/first WO) and the `productionExists` / `qcExists` completion proxies, and any single `overallWorkflowState` used as the sole cycle representation — is hereby **marked deprecated**.
- Deprecated fields must be retained only until consumers migrate to the planning/execution contracts, then removed (Phase F).
- New consumers **must not** read deprecated scalar fields as cycle truth.
- Migration is phased (§24) to preserve protected behaviors; no big-bang cutover.

## 21. Rejected Alternatives

1. **One overall scalar state as the sole representation of a multi-WO cycle** — rejected; cannot express concurrent planning + execution.
2. **Selecting the latest or first WO as the representative WO** — rejected; hides sibling WOs and misroutes deep-links/ownership.
3. **Using any production entry as proof of production completion** — rejected; this is the confirmed root cause.
4. **Using any QC entry as proof of cycle completion** — rejected; late QC on one WO must not complete the cycle.
5. **Fixing only the ProductionPage message** — rejected; the assumption is systemic (engine, next-action API, dashboard, control tower, close/eligibility gates).
6. **Moving execution recovery back into RS planning** — rejected; violates planning/execution separation and recovery ownership.
7. **Mutating existing WO quantities to absorb recovery** — rejected; existing WOs are immutable.

## 22. Consequences

**Positive:** correct operator guidance under multiple WOs; production never suppressed by planning; parallel rolling planning preserved; single source of truth for quantities; clearer ownership; accurate Control Tower/dashboards/reports.

**Negative / cost:** contract and consumer refactor across engine, next-action API, dashboard, pending actions, control tower, and close/eligibility gates; temporary dual (scalar + axis) surface during migration; more rows on some surfaces (per-WO).

**Neutral:** RS/planning-scoped surfaces (e.g. next-RS status panel) are already correct and largely unchanged; quantity math already correct in the planning layer is formalized, not reinvented.

## 23. Risks

1. **Legitimate shortfall-only → Next RS** regressing: a single WO closed with shortfall leaves remaining > 0 on a WO that can no longer produce; the "remaining" test must count only **active** WOs (§9).
2. **Rolling planning breakage** if Next-RS is removed instead of demoted; it must remain a parallel secondary action.
3. **Ownership/role routing shifts** as primary action changes; Pending Action ownership must remain per FT-PD-040 (documented, unchanged here).
4. **Cycle-close tightening** may keep cycles open longer; verify SO-closure and dispatch-cap flows still close genuinely complete orders.
5. **Control Tower row-count changes** (per-WO) may alter board/queue totals; verify no double counting.
6. **Contract change to WO list** affects deep-links; a single-WO compatibility shim is required during migration.

## 24. Required Follow-up Work (phased — not implemented by this ADR)

- **Phase A** — Fix workflow **primary-action selection** (production never suppressed by Next-RS); add **multi-WO engine tests**; keep Next RS as a **secondary** action.
- **Phase B** — Create canonical **planning-state** and **execution-state** services/contracts; remove duplicate state derivations.
- **Phase C** — Migrate **Production Workspace** and the **next-action API** onto the contracts.
- **Phase D** — Migrate **Dashboard, Pending Actions, and Control Tower** onto the contracts.
- **Phase E** — Tighten **cycle-close and coverage** rules (all WOs terminal; RS-line → WO coverage).
- **Phase F** — Retire deprecated scalar assumptions (representative `workOrderId`, `productionExists`/`qcExists` proxies, sole `overallWorkflowState`).

Each phase requires impact sign-off per FT-PD-101 §8 and PBL preservation per FT-PD-081.

## 25. Acceptance Criteria

This ADR is satisfied when:

1. Planning and execution are represented as **two independent axes**; no surface derives cycle truth from a single WO or a `productionExists`/`qcExists` proxy.
2. With WO-A complete and WO-B active, the system shows **Continue Production for WO-B** and **never** "Cycle ready for Next RS" as the headline.
3. Next RS is **available in parallel** (secondary) while active WOs exist and never suppresses execution.
4. Canonical formulas (§9) are computed **once** and read by all consumers.
5. Cycle completion requires **all** §14 conditions; dispatch alone cannot close a cycle with active WOs.
6. A multi-WO regression test proves `overallWorkflowState` (or its successor) is execution-primary while any active WO has remaining production.
7. Deprecated scalar fields are marked and scheduled for removal (§20, Phase F).
8. Pending Action ownership is documented per action (§16) with no ownership change introduced by this ADR.

---

## Governance metadata (FT-PD-101 §7.2 / §12B)

| Element | Value |
|---|---|
| **Related Constitution Articles** | Document-ownership & immutability articles (existing WO immutability; single source of truth); Core Product boundary |
| **Related Protected Behaviors (PBL)** | "Existing WOs remain immutable"; "Late QC must not interrupt manufacturing flow"; "Existing NO_QTY execution must not be disturbed"; "One RS may create multiple WOs while RS balance > 0" |
| **Related Workflow chapters** | Volume 4 Ch. 1 (Workflow Engine Overview & Pending Actions Contract); Ch. 4 (Planning Workflow State Machine); Ch. 5 (Procurement Workflow State Machine) |
| **Superseded decisions** | None (first ADR in registry) |
| **Change authority** | Product Architecture Board (acceptance required before implementation authorization) |

## Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-07-13 | FT ERP Product Team | Initial ADR — NO_QTY planning and execution are independent axes |

## Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture Board Chair | | | |
| Workflow Lead | | | |
| Validation / QA Lead | | | |
| Documentation Steward | | | |
