# FT ERP Product Design Principles

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-014 |
| **Volume** | 1 — Product Foundation |
| **Chapter** | 4 — FT ERP Product Design Principles |
| **Title** | FT ERP Product Design Principles |
| **Version** | 1.0.0 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture |
| **Audience** | Product designers, engineers, implementation architects, QA, partners |
| **Classification** | Product — Design Standards |

**Parent documents:**

- [Volume 0 — Product Vision & Strategy](../00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md)
- [Chapter 2 — FT ERP Constitution](./Chapter_02_FT_ERP_Constitution.md)
- [Chapter 3 — Glossary & Standard Terminology](./Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md)

---

## 1. Document Control

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial product design principles — implements Constitution for all modules and surfaces |

**Supersedes:** None (first design-principles release).

**Change authority:** Product Architecture. Material changes to surface philosophy (Dashboard, Workspace, Control Tower) require MINOR version increment and Volume 6 alignment review.

**Related documents:**

| ID | Document | Relationship |
|----|----------|--------------|
| FT-PD-012 | FT ERP Constitution | Laws this document implements—not duplicates |
| FT-PD-013 | Glossary | Official terms used herein |
| FT-PD-060+ | Volume 6 — UX Standards | Operational detail for screen patterns |
| FT-PD-040+ | Volume 4 — Workflow Engine | Workflow pattern specifications |

---

## 2. Purpose

This document defines the **permanent product design philosophy** for FT ERP.

It answers: *How should every module, workflow, screen, report, dashboard, and future feature be designed?*

The Constitution states **what must never be violated**. This chapter states **how designers and engineers apply those laws in practice**—patterns, priorities, and quality bars that keep FT ERP coherent as the product grows.

This is not module documentation. Domain behavior belongs in Volume 3; workflow mechanics in Volume 4; UX component specs in Volume 6.

---

## 3. Scope

### 3.1 In scope

- Cross-cutting design principles for FT ERP
- Standard philosophy for screens, workflows, Dashboard, Workspace, and Control Tower
- Error prevention, expansion, and review checklists

### 3.2 Out of scope

- Constitutional Articles (Chapter 2)
- Term definitions (Chapter 3)
- Field-level domain rules, API contracts, database design
- Customer configuration playbooks
- Visual design system (colors, typography tokens)—Volume 6

### 3.3 Audience use

| Role | Use |
|------|-----|
| Product | Feature design reviews |
| Engineering | Implementation acceptance criteria |
| Implementation | Partner solution design alignment |
| QA | UX and workflow regression scenarios |

---

## 4. Relationship with the Constitution

| Constitution theme | This document implements it as… |
|--------------------|--------------------------------|
| Manufacturing reality before software (Art. 1) | Manufacturing-first thinking; validation before transaction |
| Business first (Art. 2) | Business Rules before UI; business documents drive the system |
| ERP drives the factory (Art. 3) | Guided workflow; visibility before action; exception-driven management |
| Business Model at Enquiry (Arts. 4–5) | Consistent branching; no cross-model screen shortcuts |
| Two planning pipelines (Art. 6) | Reusable workflow patterns; separation of planning and execution |
| One execution pipeline (Art. 8) | Consistency across modules post–Work Order |
| Material accountability (Art. 9) | Validation before transaction; single source of truth for issued RM |
| Document ownership (Art. 10) | Role-based responsibility; Dashboard shows owned work only |
| Workflow before screens (Art. 11) | Workflow-first design; standard workflow philosophy |
| Pending Actions from engine (Art. 12) | Dashboard and Control Tower data rules |
| Dashboard / Control Tower (Arts. 13–14) | Dedicated surface philosophies |
| Core protection (Arts. 16–19) | Configuration before customization; future expansion principles |
| Architecture before development (Art. 21) | Product design checklist gating |
| Auditability (Art. 22) | Complete audit trail design expectation |

**Rule:** If a design choice satisfies this chapter but violates the Constitution, the Constitution wins. This chapter may be updated to clarify implementation—not to weaken laws.

---

## 5. Product Design Philosophy

The following principles apply to **every** FT ERP capability unless an Approved domain chapter documents a narrow, constitution-compliant exception.

### 5.1 Workflow-first design

Design begins with **Workflow State**, ownership, and valid transitions—not with forms or grids. Screens are projections of workflow; they do not invent parallel state.

**Practice:** Every new feature starts with a one-page workflow sketch: documents involved, owner per state, gates, and Pending Actions emitted.

### 5.2 Manufacturing-first thinking

Prioritize RM readiness, BOM truth, batch traceability, and role handoffs over accounting convenience or report aesthetics. If a design works in finance but fails on the shop floor, it is rejected.

**Practice:** Ask “What does Store / Purchase / Production need to do next?” before “What columns should the grid have?”

### 5.3 Business documents drive the system

**ERP-controlled documents** advance state. External references (Customer Purchase Order number, email PDF) are metadata only—they never substitute for Material Issue, Production Entry, or QA Inspection.

**Practice:** No “soft complete” buttons that skip document creation.

### 5.4 Business Rules before UI

Business Rules and Validation Rules are specified before wireframes. UI accommodates rules; UI must not silently weaken them for convenience.

**Practice:** Blocking messages cite the rule (“Production blocked: issued RM insufficient for PMR”) not generic errors.

### 5.5 Dashboard → Workspace → Control Tower

Three surfaces, three questions:

| Surface | Question | Design stance |
|---------|----------|---------------|
| **Dashboard** | What is **my** work? | Task entry, minimal depth |
| **Workspace** | How do I **do** this work? | Full document context, actions |
| **Control Tower** | What is the **factory** status? | Monitor, escalate, deep-link |

Never merge factory monitoring into Dashboard. Never use Control Tower as a second Dashboard with duplicate action buttons.

### 5.6 Minimal user decisions

Reduce cognitive load: default the next sensible action, pre-fill from frozen artifacts (PMR, approved plan, Internal Sales Order lines), and hide paths that are invalid for the user’s role or Business Model.

**Practice:** One primary CTA per context; secondary actions visually subordinate.

### 5.7 Guided workflow

Users should not hunt across modules. Pending Actions, continuity strips, and breadcrumbs route operators through REGULAR or NO_QTY paths without dead ends.

**Practice:** After completing an action, show “what changed” and “what is next” (including owner if not the current user).

### 5.8 Role-based responsibility

Every action is designed for an **owning role**. Non-owners may see read-only context but not execution controls (e.g. Purchase does not post GRN; Store does not prepare RM PO).

**Practice:** Permission denial explains *who* owns the next step, not only “access denied.”

### 5.9 Single source of truth

One authoritative record per concept: Workflow Engine for Pending Actions, Stock Ledger for on-hand, frozen PMR for production material, approved Monthly Planning RM Snapshot for MPRS procurement demand.

**Practice:** Duplicate counters on screens must trace to the same backend source or be removed.

### 5.10 Separation of planning and execution

Planning screens freeze intent; execution screens consume frozen intent. Approving a plan, Snapshot, or PMR does not move stock or start production.

**Practice:** Planning workspaces use language of *review, approve, release*; execution workspaces use *issue, produce, inspect, dispatch*.

### 5.11 Exception-driven management

Normal flow should be quiet; **exceptions** (shortage, overdue Pending Action, partial issue, QA reject) should surface prominently in Control Tower and role Dashboards.

**Practice:** Green-path happy flow requires few clicks; red-path exceptions provide diagnosis and one-click route to owning Workspace.

### 5.12 Visibility before action

Show status, owner, and consequence before destructive or irreversible actions (cancel PMR, reverse production, close WO with shortfall).

**Practice:** Confirmation dialogs summarize document numbers, quantities, and downstream impact.

### 5.13 Validation before transaction

Stock, material, and production postings validate **before** commit. Users receive actionable correction paths—not partial posts with silent rollback.

**Practice:** Validate at save and at workflow transition; prefer inline field feedback over post-submit failure.

### 5.14 Complete audit trail

Material and manufacturing disputes require **who / when / what document / what quantity**. Design for append-only Business Events; reversals are explicit documents, not deletes.

**Practice:** Every approval, release, issue, and reversal has a visible Workflow Trail entry.

### 5.15 Configuration before customization

Exhaust Configuration and Optional Modules before Custom Layer. Design features as parameters where variance is expected (buffers, thresholds, role assignment).

**Practice:** New toggle in Configuration Layer preferred over customer-specific branch.

### 5.16 Consistency across all modules

REGULAR and NO_QTY differ in **planning entry**, not in post–Work Order execution patterns. Procurement, production, and QA use shared interaction patterns (KPI strip, queue table, primary action column, trace panel).

**Practice:** Reuse workspace layout templates from Volume 6; do not invent a third procurement UX paradigm.

### 5.17 Progressive disclosure

**Operators** see only what is needed to complete the next step (qty, item, primary CTA). **Managers** expand rows, trace panels, and Control Tower columns for depth.

**Practice:** Collapse RM line detail by default; expand on focus Material Requirement or PMR.

### 5.18 Reusable workflow patterns

Repeated sequences use shared patterns:

- *Submit for review → approve → release*
- *Request → issue → confirm*
- *Draft → approve → post stock*
- *Inspect → accept / reject → rework or scrap*

New modules adopt existing patterns before inventing new status vocabularies.

### 5.19 Scalability without redesign

Design for growing SKU count, WO volume, and Pending Action depth without changing workflow semantics—pagination, filtering, demand pools, and normalized Control Tower rows.

**Practice:** Avoid designs that require full-list client rendering for factory-scale queues.

---

## 6. Standard Screen Design Philosophy

### 6.1 Purpose of a screen

Every screen serves exactly one primary purpose: **act** (Workspace), **summarize work** (Dashboard), **monitor** (Control Tower), or **maintain master data** (master screens). Hybrid “do everything” pages are prohibited unless explicitly defined as a Workspace with zones.

### 6.2 Document-centric layout

Workspaces anchor on a **document header** (number, status, owner, Business Model badge) and **stage indicator** (continuity strip or lifecycle chip). Line detail sits below; actions sit in a consistent header/footer action zone.

### 6.3 Status is always visible

Current **Workflow State** appears above the fold. Users never wonder “what stage is this in?”

### 6.4 One primary action

Each screen context exposes **one primary CTA** aligned with Pending Action or valid transition. Secondary actions are outline/ghost style. Destructive actions require explicit confirm.

### 6.5 Wrong-flow protection

When a user opens a document on an incompatible path (NO_QTY Agreement on REGULAR work-order preparation), the screen blocks with explanation and **one escape route** to the correct Workspace—never a silent wrong state.

### 6.6 Density and shop-floor readability

Manufacturing users work in kilograms, pieces, and document numbers—not abstract icons alone. Numeric columns are right-aligned; document numbers are monospaced or semibold; units always shown with quantities.

### 6.7 Empty states teach

Empty queues explain **why** empty and **what event** will populate them (e.g. “No MR awaiting PR—released monthly production plans appear here after Store release”).

### 6.8 Master data screens

Item, BOM, customer, and supplier masters are **maintenance** surfaces—not workflow drivers. Masters do not emit Pending Actions unless a deliberate master-approval workflow exists.

---

## 7. Standard Workflow Design Philosophy

### 7.1 Engine-owned state

Workflow State lives in the **Workflow Engine**. Screens read and request transitions; they do not store parallel status flags.

### 7.2 Explicit transitions

Every transition has: name, owning role, preconditions (Business Rules), validations, side effects (Business Events), and resulting Pending Actions.

### 7.3 Planning never auto-executes

Approving **Monthly Production Plan**, releasing RM to procurement, or submitting **PMR** does not issue material, create production output, or dispatch FG.

### 7.4 Frozen artifact consumption

Execution steps read **frozen** quantities (PMR lines, Planning Snapshot, MR shortage at release). Execution does not re-explode BOM with a stricter or different basis than the frozen artifact.

### 7.5 Ownership handoff as first-class event

When ownership changes (Store releases to Purchase, Purchase creates PR), the product generates Pending Actions for the **new owner** and clears or downgrades tasks for the prior owner.

### 7.6 Business Model firewall

Workflow definitions declare compatible Business Models. REGULAR-only transitions are unreachable from NO_QTY documents and vice versa, except in shared **Execution Pipeline** post–Work Order.

### 7.7 Terminal states are explicit

Closed, cancelled, fully procured, and commercially complete states are **terminal** with no ambiguous “half closed” behavior. Reopen paths require explicit reversal workflow.

### 7.8 Idempotent operator experience

Repeating a completed transition returns a clear “already done” state—not duplicate documents.

---

## 8. Standard Dashboard Philosophy

### 8.1 Definition

**Dashboard = My Work.** It answers: *What must I do today for my role?*

### 8.2 Content rules

| Include | Exclude |
|---------|---------|
| Pending Action Cards for current role | Other roles’ primary execution buttons |
| Role KPIs (counts, aging) | Full factory grid |
| Quick Actions to valid Workspaces | Ad hoc report builder |
| Short queue previews (optional) | Deep line editing |

### 8.3 Pending Actions only

Task lists on Dashboard **must** originate from the Workflow Engine. No screen-local “todo” arrays.

### 8.4 Prioritization

Show highest-impact work first: material blocking production, overdue review, customer commitment risk—using engine priority, not arbitrary sort.

### 8.5 Quick Actions

Quick Actions are **deep links** into Workspaces with context (demand pool, document id)—not shortcuts that bypass gates.

### 8.6 Role purity

Store Dashboard emphasizes issue, placement, dispatch readiness. Purchase Dashboard emphasizes PR/PO execution and monthly plan review. Production Dashboard emphasizes WO production entry—not procurement creation.

### 8.7 Monitor hints, not monitor replacement

Dashboard may show “awaiting Purchase” summary chips but must not duplicate Control Tower row grids.

---

## 9. Standard Workspace Philosophy

### 9.1 Definition

**Workspace = Do Work.** Document-context environment where role owners complete workflow steps.

### 9.2 Examples

| Workspace | Primary work |
|-----------|--------------|
| Procurement Workspace | PR creation, PO prep context, demand pool queues |
| Monthly Production Planning Sheet | FG plan, review, release |
| Production entry | Record and approve output |
| Material Issue | Issue against PMR |
| RM Control Center | REGULAR RM case allocation and handoff |

### 9.3 Full context in one place

Workspace shows document header, lines, trace/history, related Pending Actions, and valid CTAs—minimizing tab-hopping.

### 9.4 Write authority

Only the **owning role** (or Admin) sees write CTAs. Others get read-only Workspace via permission or monitor link from Control Tower.

### 9.5 Queue + detail pattern

List workspaces use **select row → detail panel** or expand row; demand pool tabs (REGULAR_SO, MPRS, STOCK_REPLENISHMENT) segregate planning sources without merging semantics.

### 9.6 Continuity strips

Multi-step manufacturing flows display **continuity strip** (approved MR → awaiting PR → PO → GRN) so users see stage without opening Control Tower.

### 9.7 Return navigation

Workspaces preserve `returnTo` context (Dashboard, Pending Actions, Control Tower) for coherent back navigation.

---

## 10. Standard Control Tower Philosophy

### 10.1 Definition

**Control Tower = Factory Work.** Cross-role monitoring, risk, and escalation—not personal task execution.

### 10.2 Questions answered

- What is blocked across the factory?
- Who owns each case?
- How long has it been waiting?
- What is the recommended next action?

### 10.3 Read-first design

Default interaction is **inspect and deep-link**. Execution buttons on tower rows are limited to escalation patterns defined in Volume 4—not routine PR/PO/issue actions.

### 10.4 Normalized rows

Tower rows use a **common shape**: document, FG/RM context, workflow stage, owner role, risk, age, recommended action, deep link. REGULAR and NO_QTY rows differ in metadata, not in grid philosophy.

### 10.5 Exception emphasis

Visual emphasis (risk badges, aging) applies to **exceptions**—shortages, partial issues, QA holds—not to healthy in-progress work.

### 10.6 No duplicate Pending Action engine

Tower may display the same recommended action as Pending Actions but does not compute competing task logic.

### 10.7 Manager audience

Plant heads and shift managers use Control Tower; shop operators live primarily on Dashboard and Workspace.

---

## 11. Error Prevention Philosophy

### 11.1 Design for mistake resistance

- Disable invalid CTAs rather than show cryptic errors after click.
- Block wrong Business Model paths at route level.
- Clamp production quantity to PMR-allowed and WO-remaining caps with visible ceiling.
- Prevent mixed demand-pool PR creation in one requisition.

### 11.2 Fail with guidance

Errors state: **what failed**, **why (rule)**, **who can fix**, **link to Workspace**.

### 11.3 No silent partial success

Multi-line operations (bulk issue, bulk approve) report per-line outcomes; do not fail silently on subset.

### 11.4 Concurrency clarity

If two users act on the same document, second actor sees refresh prompt with current Workflow State—not stale overwrite.

### 11.5 Reversal discipline

Reversals require reason, authority, and audit entry. Accidental tap cannot reverse production or issue.

---

## 12. Future Expansion Principles

### 12.1 Core stays intact

Optional Modules (e.g. **Subcontract Manufacturing**) add capability without forking Execution Pipeline or Business Model rules.

### 12.2 Extension points over forks

Integrations attach at published boundaries. Core workflow tables and states are not customer-patchable.

### 12.3 Additive vocabulary

New terms enter via Glossary amendment. New document types declare Business Model compatibility and ownership matrix up front.

### 12.4 Configuration growth

Prefer new Configuration keys over new code branches for regional or plant variance.

### 12.5 Backward-compatible upgrades

Design changes must allow existing customers to upgrade without breaking frozen historical documents (read-only archive of old plan revisions, PMR history).

### 12.6 Performance as feature

Scale patterns (pool tabs, pagination, async tower refresh) are part of design—not post-launch afterthoughts.

### 12.7 Industry packs

Vertical templates (plastic molding, electrical assembly) ship as **configuration packs** and documentation bundles—not Core forks.

---

## 13. Product Design Checklist

Use before approving any feature design:

- [ ] Workflow sketch exists (states, owners, transitions, Pending Actions)
- [ ] Business Model compatibility declared (REGULAR / NO_QTY / both / post-WO only)
- [ ] Planning vs execution classified; no auto-execution on approve
- [ ] Frozen artifact identified (if execution consumes planning output)
- [ ] Surface assigned: Dashboard, Workspace, Control Tower, or master only
- [ ] Owning role for each CTA confirmed
- [ ] Glossary terms used (Chapter 3); no new synonyms
- [ ] Constitution Articles cited if touching material, ownership, or surfaces
- [ ] Wrong-flow and empty states designed
- [ ] Audit events identified
- [ ] Configuration vs Custom classification completed
- [ ] Reuse existing workflow pattern (Section 5.18) or justify new pattern

---

## 14. Review Checklist

### 14.1 Principle compliance

- [ ] Workflow-first; not form-first
- [ ] Manufacturing-first; shop-floor test passed
- [ ] Business documents drive state; Customer PO not elevated
- [ ] Dashboard / Workspace / Control Tower boundaries respected
- [ ] Pending Actions engine-sourced only
- [ ] Planning separated from execution
- [ ] Material accountability preserved for RM paths
- [ ] Progressive disclosure applied

### 14.2 Consistency

- [ ] Matches existing workspace patterns (procurement, monthly planning, production)
- [ ] REGULAR / NO_QTY paths isolated in planning; shared in execution
- [ ] Error messages follow fail-with-guidance pattern

### 14.3 Product architecture

- [ ] No Core-breaking customer special case
- [ ] Configuration before customization considered
- [ ] Scalability pattern identified for queues

### 14.4 Documentation

- [ ] Volume 3 domain update planned before development
- [ ] Volume 6 UX update planned if new screen pattern introduced
- [ ] Glossary update planned if new term required

---

## 15. Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial product design principles — philosophy, surface standards, checklists |

---

## 16. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture | | | |
| UX / Design Lead | | | |
| Engineering Lead | | | |

**Status after approval:** Change from *Draft — Architecture Review* to *Approved*; Volume 6 must align before UI pattern deviations ship.

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [FT ERP Glossary & Standard Terminology](./Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) (FT-PD-013) |
| **Next** | [Business Models & Document Inheritance](../02_Business_Architecture/Chapter_01_Business_Models_and_Document_Inheritance.md) (FT-PD-020) |
| **Volume** | [Product Foundation](./README.md) |
| **Product** | [Product Documentation Index](../README.md) |

