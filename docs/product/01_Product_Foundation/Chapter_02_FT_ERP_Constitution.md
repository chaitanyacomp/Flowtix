# FT ERP Constitution

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-012 |
| **Volume** | 1 — Product Foundation |
| **Chapter** | 2 — FT ERP Constitution |
| **Title** | FT ERP Constitution |
| **Version** | 1.0.0 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture |
| **Audience** | Product, engineering, implementation, QA, partner architects |
| **Classification** | Product — Constitutional |

**Parent documents:** [Volume 0 — Product Vision & Strategy](../00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md)

---

## 1. Document Control

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial Constitution — Draft for Architecture Review |

**Supersedes:** None (first constitutional release).

**Related documents:**

| ID | Document | Relationship |
|----|----------|--------------|
| FT-PD-000 | Volume 0 — Product Vision & Strategy | Strategic parent; Volume 0 governs on strategic conflict until Constitution is Approved |
| FT-PD-011 | Volume 1, Chapter 1 — Introduction | Prerequisite reading |
| FT-PD-020+ | Volume 2 — Business Architecture | Expands Articles 4–8 in operational detail |
| FT-PD-040+ | Volume 4 — Workflow Engine | Implements Articles 11–15 |

**Change authority:** Only Product Architecture may propose constitutional amendments. Approved amendments require version increment (MAJOR for invariant change, MINOR for clarification).

---

## 2. Purpose

This document defines the **permanent architectural laws of FT ERP**.

The Constitution is the highest **operational** authority in the Product Documentation set. It translates Volume 0 strategy into binding rules that every module, workflow, screen, integration, and customization must obey.

If a proposed feature, customer request, or implementation shortcut conflicts with an Article in this Constitution, the proposal is **out of order** until either:

1. The proposal is redesigned to comply, or  
2. A formal constitutional amendment is approved through versioning.

No engineering shortcut, customer urgency, or delivery deadline overrides the Constitution without an approved amendment.

---

## 3. Scope

### 3.1 In scope

- Immutable product principles for FT ERP as a **commercial workflow-driven manufacturing ERP**
- Rules governing business models, planning, execution, material accountability, ownership, UX surfaces, and product layering
- Governance for how the Constitution itself is maintained

### 3.2 Out of scope

- Step-by-step workflow specifications (Volume 4)
- Domain field-level behavior (Volume 3)
- Technical implementation patterns (Volume 7)
- Customer-specific configuration guides
- Financial accounting policy beyond manufacturing touchpoints

### 3.3 Hierarchy of authority

```
Volume 0 — Product Vision & Strategy     (why and long-term direction)
        ↓
Volume 1 — FT ERP Constitution         (permanent laws — this document)
        ↓
Volumes 2–10 — Architecture & domains  (how laws are applied)
        ↓
Release software & configuration       (product instance)
```

Where Volume 0 and this Constitution appear to conflict, **Volume 0 governs strategy**; **this Constitution governs product behavior and design decisions** pending formal reconciliation.

---

## 4. Constitutional Articles

The following Articles are **laws**, not guidelines. Each Article states the rule, the manufacturing rationale, and the product implication.

---

### Article 1 — Manufacturing Reality Before Software

**Law.** FT ERP shall be designed from **how discrete manufacturing factories actually operate**—BOM explosion, RM constraints, shop-floor batches, quality holds, and material handoffs—not from abstract ERP module templates.

**Rationale.** Software that ignores RM lead time, loss factors, or role boundaries creates screens that nobody trusts. Operators revert to spreadsheets; the ERP becomes a record-after-the-fact system.

**Product implication.**

- Domain models must reflect FG → SFG → RM structures, weight-based planning, and batch production.
- Features that cannot be explained on a shop floor in plain language do not belong in Core Product.
- Volume 10 (Manufacturing Knowledge) is a first-class dependency for domain design.

---

### Article 2 — Business First, Technology Second

**Law.** **Business process defines software behavior.** Technology choices serve workflow truth; technology must never redefine the factory’s process to suit implementation convenience.

**Rationale.** Inverting this order produces flexible software that forces every customer to invent their own process—a failure mode FT ERP explicitly rejects.

**Product implication.**

- Requirements begin with role, ownership, and document state—not with database tables or UI widgets.
- Volume 2 (Business Architecture) precedes detailed technical design for any workflow-touching change.
- “The database already works that way” is not a valid reason to violate a Business Rule.

---

### Article 3 — ERP Drives the Factory

**Law.** FT ERP shall **drive** factory operations by enforcing valid sequences, blocking invalid actions, and surfacing the next responsible step—not merely record transactions after they occur offline.

**Rationale.** A passive ledger does not reduce shortages, delays, or ownership disputes. The product’s value is operational orchestration.

**Product implication.**

- Invalid transitions are blocked with explicit reason codes (e.g. production without issued RM, dispatch without QA release).
- Every major stage has a defined owner and gate.
- Reporting supplements orchestration; it does not replace it.

---

### Article 4 — Business Model Selection at Enquiry

**Law.** The **Business Model** is selected during **Enquiry** as one of exactly two values:

| Value | Meaning |
|-------|---------|
| **REGULAR Order** | Fixed-quantity commercial order; quantities committed at order level |
| **NO_QTY Agreement** | Supply agreement without fixed order quantity; quantities emerge through planning cycles |

No downstream document may select or switch Business Model independently.

**Rationale.** Mixing fixed-order logic with agreement-based cycle planning in the same pipeline is the primary source of manufacturing ERP failure in mid-market deployments.

**Product implication.**

- Enquiry capture includes explicit Business Model selection with operator-facing explanation.
- Business Model is stored as inherited metadata on the commercial chain.
- UI routes, planning entry points, and procurement demand pools must branch from this single decision.

---

### Article 5 — Business Model Inheritance

**Law.** Business Model selected at Enquiry is **immutable** and **inherited** by all downstream controlled documents, including:

- Feasibility  
- Quotation  
- Internal Sales Order  
- Planning artifacts (order planning, Requirement Sheets, monthly production plans)  
- Manufacturing (work orders and execution)  
- Dispatch  
- Billing  

**Rationale.** A document chain with inconsistent business model semantics cannot enforce correct planning or execution gates.

**Product implication.**

- Internal Sales Order carries Business Model from Quotation; it does not re-derive it.
- **Customer Purchase Order** is a **reference field** on Internal Sales Order only—it is **not** an ERP workflow document and does not participate in Business Model selection or workflow state.
- Cross-model navigation (opening a NO_QTY Agreement on a REGULAR work-order path) is a product defect, not user error.

---

### Article 6 — Two Planning Pipelines

**Law.** REGULAR Order and NO_QTY Agreement shall maintain **separate planning pipelines**. Planning logic, entry screens, demand pools, and shortcuts must not be shared in ways that allow cross-contamination.

**Rationale.** REGULAR planning is order-quantity-driven. NO_QTY planning is cycle- and period-driven (Requirement Sheets, rolling schedules, monthly production planning, MPRS procurement release). These are different planning disciplines.

**Product implication.**

| Business Model | Planning pipeline (summary) |
|----------------|----------------------------|
| **REGULAR Order** | Order-driven RM readiness → work order preparation → procurement as required |
| **NO_QTY Agreement** | Requirement Sheet → cycle planning → monthly production plan → RM release to procurement (MPRS) |

- Procurement demand pools segregate sources (e.g. order-driven vs. monthly plan vs. replenishment).
- Firewall rules prevent NO_QTY demand from entering incompatible procurement paths.
- Volume 2 documents each pipeline stage; Volume 4 defines gates.

---

### Article 7 — Planning and Execution Are Separate

**Law.** **Planning** (deciding what to make and what material is required) and **Execution** (issuing material, producing, inspecting, dispatching) are **separate responsibilities** with **separate ownership**. Planning never automatically starts execution.

**Rationale.** When planning silently triggers execution, material shortages, duplicate work orders, and accountability gaps follow. Store must issue; Production must not self-serve RM.

**Product implication.**

- Planning outputs **freeze intent** (approved monthly plan, RM Snapshot, PMR requirement, released procurement demand).
- Execution consumes **frozen artifacts**; it does not re-explode planning with a different basis.
- Approval of a plan, snapshot, or PMR does not create stock movements, work orders in active production, or dispatch by itself.
- Explicit human or gated workflow action bridges planning → execution.

---

### Article 8 — One Common Manufacturing Execution Pipeline

**Law.** After **Work Order creation**, all Business Models converge to **one common manufacturing execution pipeline**:

```
Work Order
  → Production Material Request (PMR)
  → Material Issue
  → Production Entry
  → Quality Assurance (QA)
  → Dispatch
```

**Rationale.** The shop floor executes work orders the same way regardless of how demand was planned. Diverging execution paths duplicate material logic, QA rules, and production readiness checks.

**Product implication.**

- PMR, issue, production RM readiness, QA gates, and dispatch validation are shared Core behavior.
- Post–work-order screens do not branch by Business Model except where display context requires (trace labels, source references).
- NO_QTY-specific behavior resumes **after** dispatch for next-cycle planning—not inside production execution.

---

### Article 9 — Material Accountability

**Law.** Every unit of RM moved into production must be **accountable** through a traceable chain: requirement → request → issue → consumption (or return). Production may proceed only against **issued and available** material aligned to frozen PMR requirements.

**Rationale.** Factories lose money when production consumes RM that was never issued, issued to the wrong work order, or calculated on a different BOM basis than the material request.

**Product implication.**

- PMR is the **frozen material requirement** for a work order.
- Material Issue posts stock to production locations; Production validates against issued quantity, not a fresh independent BOM recalculation.
- Full PMR issue permits full work-order production within remaining balance; partial issue limits production proportionally.
- Returns and consumption variance are auditable events, not silent adjustments.

---

### Article 10 — Document Ownership

**Law.** Every controlled ERP document and workflow stage has a **default owning role**. Ownership means accountability for the next valid action—not merely visibility.

**Rationale.** Ambiguous ownership is the primary cause of material sitting in “approved but not procured” or “issued but not produced” states.

**Product implication.**

- Ownership is assigned at workflow design time and exposed in Pending Actions and Control Tower.
- Standard ownership matrix (current FT ERP design):

| Domain stage | Default owner |
|--------------|---------------|
| Commercial (enquiry, quotation) | Admin / commercial |
| REGULAR order planning & RM readiness | Store |
| NO_QTY requirement & cycle planning | Store |
| Monthly plan review (post-submit) | Purchase |
| Monthly plan release to procurement | Store |
| RM procurement (PR, PO) | Purchase |
| GRN / receipt posting | Store |
| Work order creation | **Store** (standard default) |
| PMR submission & material issue | Store |
| Production entry | Production |
| QA inspection | QA |
| Dispatch | Store |
| Billing (commercial) | Admin |

- **Configurable responsibility** (Article 20) may adjust ownership where product supports it; defaults above remain the standard out-of-box model.

---

### Article 11 — Workflow Before Screens

**Law.** Workflow state, ownership, and gates are defined **before** screens are designed. Screens are projections of workflow—not containers of ad hoc business logic.

**Rationale.** Screen-first design produces inconsistent buttons, duplicate CTAs, dead-end navigation, and role leakage.

**Product implication.**

- New modules require a workflow sketch (Volume 4 template) before UI specification (Volume 6).
- Screens may not introduce transitions that bypass the Workflow Engine.
- “Quick action” buttons must map to engine-supported actions for the active role.

---

### Article 12 — Pending Actions Are Workflow Outputs

**Law.** **Pending Actions** are generated exclusively by the **Workflow Engine** from normalized workflow state. Individual screens, dashboards, or reports must not maintain parallel pending-queue logic.

**Rationale.** Duplicate queue sources produce different counts on Dashboard vs. Control Tower vs. email alerts—destroying trust.

**Product implication.**

- Pending Actions API is the single source for “what needs doing.”
- Dashboard task cards consume Pending Actions; they do not compute independent task lists.
- Screen-level badges may reflect engine state but may not create standalone actionable queues.
- Each pending item carries: document reference, owner role, action label, priority, and deep link.

---

### Article 13 — Dashboard = My Work

**Law.** The **Dashboard** surface answers: *What do I need to do today?* It shows **role-owned work only** for the logged-in user’s role.

**Rationale.** Dashboards that mix personal tasks, factory-wide exceptions, and analytics force every user to filter noise before acting.

**Product implication.**

- Dashboard content is filtered by `ownerRole` (or equivalent) matching the user’s role.
- Dashboard shows Pending Actions, role KPIs, and primary CTAs into Workspaces.
- Dashboard does not show other roles’ actionable buttons (e.g. Purchase PR creation on Store Dashboard).
- Monitor-style factory views belong on Control Tower, not Dashboard.

**Companion rule (Workspace).** **Workspace = Do Work** — task execution in document context (Procurement Workspace, monthly Planning Workspace, production entry). Dashboard routes to Workspace; Workspace performs the work.

---

### Article 14 — Control Tower = Factory Work

**Law.** The **Control Tower** answers: *What is the status of factory work across roles and documents?* It is for **monitoring and escalation only**—not for role-owned task execution.

**Rationale.** Managers need cross-role visibility without turning the control view into a second dashboard with conflicting actions.

**Product implication.**

- Control Tower displays normalized rows: document, stage, owner, risk, age, recommended action.
- Control Tower deep-links to Workspace or read-only trace; it does not replace Workspace write operations.
- Control Tower is not filtered to “my work only”; it is factory-wide (subject to permission).
- Execution buttons on Control Tower are prohibited unless explicitly defined as escalation-only and engine-backed.

---

### Article 15 — ERP-Controlled Documents Drive Workflow

**Law.** Only **ERP-controlled documents** advance workflow state. External references (customer PO number, vendor email, paper gate pass) do not create or advance workflow.

**Rationale.** If external artifacts drive state, the ERP loses authority and audit trail.

**Product implication.**

- Customer PO is stored on Internal Sales Order for reference and matching; it does not create a workflow object.
- State transitions require valid ERP document status changes recorded by the Workflow Engine.
- Attachments and external IDs are metadata—they are not substitutes for PMR, GRN, production entry, or QA release documents.

---

### Article 16 — Core Product Protection

**Law.** **Core Product** shall not be modified, forked, or broken to satisfy a single customer. Customer-specific behavior belongs in Configuration, Optional Modules, or Custom Extensions.

**Rationale.** One broken core becomes unmaintainable across all customers—the product ceases to be a product.

**Product implication.**

- No customer-specific branches in Core code or schema.
- Business model isolation, execution pipeline unity, and material accountability rules are regression-protected (Volume 8).
- Escalation path for “customer must have core change”: classify → Optional module proposal → roadmap, not hotfix.

---

### Article 17 — Modular Product Architecture

**Law.** FT ERP consists of four layers. Every requirement is classified into exactly one layer before design:

| Layer | Definition |
|-------|------------|
| **Core Product** | Standard capabilities every customer receives |
| **Optional Modules** | Licensed add-ons that extend without altering Core semantics |
| **Configuration** | Parameterization without code change |
| **Custom Extensions** | Partner- or customer-specific code via published extension points |

**Rationale.** Unclassified requirements inevitably land in Core and fragment the product.

**Product implication.**

- **Subcontract Manufacturing** is an **Optional Module**—a standard productized capability—not a client-specific customization.
- Optional Modules integrate through documented contracts (Volume 7); they do not patch Core tables or workflow states ad hoc.
- Core remains installable and coherent with zero optional modules enabled.

---

### Article 18 — Configuration Before Customization

**Law.** When customer-specific behavior is required, **Configuration** must be exhausted before Optional Module design, and Optional Modules before **Custom Extensions**.

**Rationale.** Configuration upgrades cleanly; custom code does not.

**Product implication.**

- Thresholds, feature flags, role assignments, location structure, buffer percentages, and document sequences are Configuration-first.
- Partners document configuration packages per release.
- Custom Extensions require architecture review when touching workflow or ownership.

---

### Article 19 — Customization Last

**Law.** **Custom Extensions** are the last resort. They must not alter Core semantics, Workflow Engine rules, or constitutional Articles.

**Rationale.** Custom code is the highest long-term cost for customer and vendor.

**Product implication.**

- Extensions use APIs, events, and UI slots—never Core overrides.
- Custom Extensions are upgrade-tested per release by the implementer.
- Custom work that reveals a universal need feeds Optional Module roadmap—it is not merged into Core without product classification.

---

### Article 20 — Configurable Responsibility

**Law.** Default document ownership (Article 10) is the **standard out-of-box model**. FT ERP may allow **configuration of responsibility** where product design explicitly supports it—without breaking Workflow Engine integrity.

**Rationale.** Factories differ on whether Production or Store creates work orders; the product must eventually absorb valid variants without forking pipelines.

**Product implication.**

- Current standard: **Store owns Work Order creation** in the default configuration.
- Future configuration may reassign specific document creation rights where Volume 4 defines safe reassignment boundaries.
- Ownership configuration changes **who** acts—not **what** the workflow states mean.
- Pending Actions and Control Tower must reflect configured ownership from a single engine configuration source.

---

### Article 21 — Architecture Before Development

**Law.** No workflow-touching feature shall enter development until affected volumes (Business Architecture, Domain Specification, or Workflow Engine) are updated and linked to the change request.

**Rationale.** Code-first manufacturing features are expensive to reverse and usually violate Articles 6–9.

**Product implication.**

- Change requests include: constitutional classification, affected Articles, and doc update PR reference.
- Engineering estimates assume spec exists; absent spec triggers architecture spike—not sprint commitment.
- Volume 8 tests encode constitutional invariants where machine-verifiable.

---

### Article 22 — Auditability

**Law.** FT ERP shall maintain **auditable evidence** for material and manufacturing disputes: who acted, when, on which document, against which frozen requirement.

**Rationale.** QA rejections, shortage claims, and invoice disputes require traceability beyond user memory.

**Product implication.**

- Approvals, releases, issues, production postings, and reversals write audit events.
- Frozen snapshots (monthly RM plan, PMR lines, planning revision) are point-in-time records—not overwritten silently.
- Reversal operations are explicit document types, not deletes.

---

### Article 23 — Continuous Product Evolution

**Law.** FT ERP evolves through **documented, versioned, classified** change—never through undocumented drift between customers.

**Rationale.** A living factory tool that cannot evolve becomes obsolete; uncontrolled evolution becomes unmaintainable.

**Product implication.**

- Roadmap items map to documentation versions and release notes.
- Deprecation is announced in documentation before removal.
- Constitutional amendments use MAJOR version increment on this document.
- Customer configuration and extensions are revalidated on each major release.

---

## 5. Governance Rules

### 5.1 Amendment process

1. **Proposal** — Written rationale citing affected Articles and customer/market evidence.  
2. **Classification** — Core / Optional / Configuration / Custom impact assessment.  
3. **Review** — Product Architecture + Engineering Lead + Implementation representative.  
4. **Documentation** — Update Constitution (and downstream volumes) before code merge.  
5. **Approval** — Signatures recorded in Approval Block.  
6. **Communication** — Release notes and partner bulletin for MAJOR/MINOR constitutional changes.

### 5.2 Conflict resolution

| Situation | Resolution |
|-----------|------------|
| Feature vs. Constitution | Constitution wins; redesign feature |
| Constitution vs. Volume 0 strategy | Escalate to Product Owner; amend Volume 0 or Constitution |
| Customer deadline vs. Article 16 | Article 16 wins; use Configuration/Custom |
| Two Articles appear to conflict | Product Architecture issues binding interpretation memo |

### 5.3 Enforcement

- **Design review** — Checklist (Section 6) required for workflow-touching PRs.  
- **CI guardrails** — Automated tests for business model isolation and execution invariants (Volume 8).  
- **Partner certification** — Implementers acknowledge Constitution compliance in SOW templates.

### 5.4 Waivers

**Waivers are not permitted** for Articles 4, 5, 6, 7, 8, 9, 12, 13, 14, and 16.  
Temporary waivers for other Articles require written Product Architecture approval with expiry date and remediation plan. Waivers are not retroactive justification for Core forks.

---

## 6. Review Checklist

Use this checklist in architecture and pull-request review for any workflow-touching change.

### Business model & planning

- [ ] Business Model selected only at Enquiry; inherited downstream  
- [ ] Customer PO treated as reference only—not workflow document  
- [ ] REGULAR and NO_QTY planning paths remain isolated  
- [ ] Planning action does not auto-start execution  
- [ ] Post–work-order execution uses common pipeline (Article 8)

### Material & manufacturing

- [ ] PMR freezes requirement; production respects issued material  
- [ ] No independent BOM recalculation bypassing frozen PMR for production gates  
- [ ] Material issue and return remain traceable

### Workflow & UX

- [ ] Workflow defined before screen behavior  
- [ ] Pending Actions sourced from Workflow Engine only  
- [ ] Dashboard shows role-owned work only (Article 13)  
- [ ] Control Tower is monitor-only; no unauthorized execution (Article 14)  
- [ ] Only ERP-controlled documents advance state (Article 15)

### Product architecture

- [ ] Requirement classified: Core / Optional / Configuration / Custom  
- [ ] Core Product not modified for single customer (Article 16)  
- [ ] Configuration explored before Custom (Articles 18–19)  
- [ ] Subcontract Manufacturing treated as Optional Module if applicable  
- [ ] Domain documentation updated before development (Article 21)  
- [ ] Audit events defined for new state transitions (Article 22)

### Constitutional compliance

- [ ] Affected Articles cited in change request  
- [ ] No waiver required—or waiver documented with expiry  
- [ ] Volume 8 regression tests updated if invariant is machine-testable

---

## 7. Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial Constitution — 23 Articles, governance, review checklist |

---

## 8. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture | | | |
| Engineering Lead | | | |
| Implementation Lead | | | |
| QA / Regression Lead | | | |

**Status after approval:** Change document status from *Draft — Architecture Review* to *Approved* and increment only via controlled versioning.

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [Introduction](./Chapter_01_Introduction.md) (FT-PD-011) |
| **Next** | [FT ERP Glossary & Standard Terminology](./Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) (FT-PD-013) |
| **Volume** | [Product Foundation](./README.md) |
| **Product** | [Product Documentation Index](../README.md) |

