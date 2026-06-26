# FT ERP — Volume 0: Product Vision & Strategy

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-000 |
| **Volume** | 0 — Product Vision & Strategy |
| **Version** | 1.0.0 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Owner** | FT ERP Product Architecture |
| **Audience** | Founders, product leadership, implementation partners, senior consultants |
| **Classification** | Product — Strategic |

---

## Document purpose

This volume defines **why FT ERP exists**, what it will become, and how it will be built, sold, evolved, and protected as a **commercial manufacturing ERP product**.

It is the strategic anchor for all other Product Documentation. Volume 1 (Product Foundation) and subsequent volumes must not contradict this document. Where tension arises, Volume 0 governs until formally revised through versioning.

This document contains **no implementation detail**, **no code references**, and **no customer-specific history**. It describes product intent and governance only.

---

## 1. Why FT ERP exists

### 1.1 The problem we solve

Most mid-market manufacturers operate with a painful gap between **how the factory actually runs** and **what their software records**.

Traditional ERP systems excel at posting transactions—purchase orders, stock movements, invoices—but often fail to **orchestrate** the factory. Operators work from spreadsheets, WhatsApp groups, and tribal knowledge while the ERP becomes a rear-view mirror. Planning lives in one place, procurement in another, production on the shop floor, and quality in a separate register. Ownership handoffs are implicit. Shortages are discovered too late. Nobody can answer, with confidence: *Who owns this work right now?*

FT ERP exists to close that gap for **discrete, BOM-driven manufacturers** who need the ERP to **drive** daily operations—not merely archive them.

### 1.2 What we learned from manufacturing reality

Our product thinking is shaped by real factory experience, including:

- **RM is the constraint** — Finished goods ship only when raw material, planning, and shop-floor execution align. Procurement visibility must connect to production readiness.
- **Not every customer order is a fixed quantity** — Long-term supply agreements (rolling schedules, call-offs, cycle-based planning) require a different commercial and planning model than fixed-quantity sales orders.
- **Planning and execution are different jobs** — Store plans; Purchase procures; Production makes; QA releases; Store dispatches. Software must respect these boundaries while making handoffs explicit.
- **BOM is the manufacturing truth** — Weight-based FG planning, process loss, QC allowance, and multi-level BOM (FG → SFG → RM) are not optional academic concepts; they determine whether production is allowed and whether RM is sufficient.
- **Dashboards must show work, not reports** — Operators need *my next action*, not a chart of last month.

FT ERP is built from these realities—not from a generic ERP feature checklist.

### 1.3 Why now

Mid-market manufacturers are underserved. Enterprise ERP (SAP, Oracle) is powerful but heavy. Lightweight tools lack manufacturing depth. Horizontal SaaS ERPs often treat manufacturing as an add-on module.

FT ERP targets the **manufacturing-native middle**: companies that need serious BOM, RM, work order, production, and QA discipline without enterprise complexity—provided the product is **workflow-driven** and **opinionated** about how a factory should run.

---

## 2. Product vision

**FT ERP will be the operating system for the mid-market discrete manufacturing factory—where every role knows what to do next, every handoff is visible, and planning always connects to execution.**

In ten years, a plant manager using FT ERP should experience:

- One system that spans enquiry to dispatch, with **no dead-end screens**.
- **Two clear commercial models** (fixed-quantity order vs. agreement-based planning) that never contaminate each other.
- **Planning pipelines** that freeze intent before execution begins.
- A **single execution pipeline** after work order creation—PMR, issue, production, QA, dispatch—regardless of how demand was planned.
- A **Control Tower** that shows factory-wide risk and ownership, not just historical KPIs.
- A product **ecosystem** (core + optional modules + configuration + controlled custom extensions) that scales across customers without fragmenting the standard product.

---

## 3. Product mission

**To embed manufacturing discipline into daily software use—so that planning decisions, material movements, and production approvals follow the factory’s real process, automatically.**

We fulfill this mission by:

1. **Driving behavior through workflows** — Status, ownership, and gates are first-class—not afterthoughts on top of forms.
2. **Separating planning from execution** — Planners freeze requirements; executors act on frozen intent.
3. **Making ownership explicit** — Every pending state has a role owner and a next action.
4. **Protecting the standard product** — Customer needs are met through configuration and extensions before the core is compromised.
5. **Documenting everything** — This documentation set is the contract between product, implementation, and engineering.

---

## 4. Target industries

FT ERP is designed for **discrete manufacturing** operations with the following characteristics:

| Characteristic | Relevance to FT ERP |
|----------------|---------------------|
| Multi-level BOM (FG, SFG, RM, consumables) | Core explosion, weight planning, RM procurement |
| Batch / job-shop production | Work orders, production entry, QC per batch |
| RM-heavy cost structure | Procurement planning, GRN, material issue, consumption variance |
| In-house production + dispatch | Production → QA → dispatch pipeline |
| Mix of fixed orders and rolling agreements | REGULAR Order vs. NO_QTY Agreement models |
| Store-centric material control | PMR, allocation, issue, return |
| Purchase-led RM procurement | PR → PO → GRN with role ownership |
| Quality gating before dispatch | QA hold, rework, release |

### Primary industry segments

- **Plastic molding & conversion** — weight-based FG, process loss, compound RM.
- **Electrical / electronics assembly** — multi-component BOM, SFG sub-assemblies.
- **Engineered components & fabrication** — job orders, RM shortages, rework.
- **Packaging & formed products** — high-volume FG with RM weight planning.

### Who FT ERP is not optimized for (initially)

- Process / formula manufacturing (recipes, tanks, continuous flow).
- Pure trading / distribution without production.
- Project manufacturing with EVM as the primary planning metaphor.
- Multi-plant global enterprises requiring full financial consolidation on day one.

These may become **optional modules** or **future product lines**—not dilutions of the core discrete manufacturing model.

---

## 5. Product positioning

### 5.1 Positioning statement

**FT ERP is a workflow-driven manufacturing ERP for mid-market discrete manufacturers who need planning and shop-floor execution in one opinionated system—not a generic accounting package with a BOM screen.**

### 5.2 Competitive frame

| Dimension | FT ERP position |
|-----------|-----------------|
| vs. Enterprise ERP (SAP, Oracle) | Faster time-to-value; manufacturing workflows built-in; lower TCO for mid-market |
| vs. Horizontal SMB ERP (Odoo, Zoho) | Manufacturing-native; two commercial models; planning/execution separation |
| vs. MES / shop-floor only tools | Full commercial-to-dispatch scope; ERP as system of record |
| vs. Spreadsheets + partial ERP | Single source of truth with enforced handoffs |

### 5.3 Differentiators (product-level)

1. **Workflow-driven factory** — Pending Actions, role ownership, and Control Tower—not passive forms.
2. **Dual commercial model** — REGULAR Order and NO_QTY Agreement as first-class, isolated pipelines.
3. **Dual planning pipeline** — Order-driven planning vs. period-driven monthly planning (MPRS)—converging at work order execution.
4. **Three UX surfaces** — Dashboard (My Work), Workspace (Do Work), Control Tower (Factory Work).
5. **Frozen planning artifacts** — PMR, RM snapshots, and procurement releases as contractual handoffs between roles.
6. **Product layering** — Core protected; customer variance absorbed in configuration and extensions.

### 5.4 Value proposition by stakeholder

| Stakeholder | Value |
|-------------|-------|
| **Plant owner / GM** | Factory visibility; fewer surprises; scalable process discipline |
| **Store / materials** | Clear issue queues; planning-to-procurement traceability |
| **Purchase** | Demand pools by source; PR/PO ownership without planning noise |
| **Production** | Production allowed only when material is truly ready |
| **QA** | Inspection gates before dispatch |
| **Commercial / admin** | Enquiry-to-order with inherited business model |

---

## 6. Product philosophy (finalized)

The following principles are **non-negotiable** for FT ERP product design. They are expanded in Volume 1 (Product Foundation).

### 6.1 Workflow-driven manufacturing ERP

Business process defines software behavior. Transactions exist to advance workflow state—not the reverse. If a screen does not answer *what should I do next?*, it is incomplete.

### 6.2 ERP drives the factory

FT ERP is not a passive ledger. It blocks invalid actions (production without issue, dispatch without QA, procurement without approved demand) and surfaces the next responsible role.

### 6.3 Planning and execution are separate responsibilities

| Planning | Execution |
|----------|-----------|
| Deciding what to make and what RM is needed | Making it with issued material |
| Freezing requirements (snapshots, PMR, approved plans) | Consuming material and posting production |
| Owned by commercial / store / purchase planning roles | Owned by store issue, production, QA, dispatch |

Execution must trust frozen planning artifacts. Execution must not silently re-plan with a stricter or different BOM basis.

### 6.4 Two business models

Selected at **Enquiry** and inherited by all downstream documents:

| Model | Commercial meaning | Planning character |
|-------|-------------------|-------------------|
| **REGULAR Order** | Fixed-quantity customer order | Order-driven RM and work order preparation |
| **NO_QTY Agreement** | Long-term supply agreement; quantities in cycles | Requirement sheets, cycles, monthly planning (MPRS) |

The two models **must never share planning paths**. Cross-contamination is a product defect.

### 6.5 Two planning pipelines, one execution pipeline

**Planning pipelines (diverge):**

- **REGULAR** — Sales order → RM readiness → work order preparation → procurement as needed.
- **NO_QTY** — Requirement Sheet → cycle planning → monthly production plan → RM release to procurement (MPRS).

**Execution pipeline (converge after Work Order):**

Work Order → Production Material Request (PMR) → Material Issue → Production → QA → Dispatch → (next planning cycle for NO_QTY).

### 6.6 Three UX surfaces

| Surface | Purpose | User question answered |
|---------|---------|------------------------|
| **Dashboard** | My Work | What do I need to do today? |
| **Workspace** | Do Work | How do I complete this task in context? |
| **Control Tower** | Factory Work | What is blocked, at risk, or waiting across the factory? |

Reports and analytics support decisions; they do not replace these three surfaces.

---

## 7. Product architecture layers

FT ERP is structured in **four layers**. Every requirement—internal or customer—must be classified into exactly one layer before design or development begins.

```
┌─────────────────────────────────────────────┐
│           Custom Extensions                 │  Partner / customer-specific
├─────────────────────────────────────────────┤
│           Configuration                       │  Parameters, roles, flags
├─────────────────────────────────────────────┤
│           Optional Modules                    │  Licensed add-ons
├─────────────────────────────────────────────┤
│           Core Product                      │  Standard FT ERP — never broken
└─────────────────────────────────────────────┘
```

### 7.1 Core Product

**Definition:** Capabilities every FT ERP customer receives. Required for the product to be *FT ERP*.

**Includes (illustrative, not exhaustive):**

- Enquiry → Quotation → Sales Order with business model inheritance
- REGULAR and NO_QTY commercial and planning separation
- BOM master with weight planning and approved revision control
- Work order lifecycle
- PMR → Material Issue → Production → QA → Dispatch execution chain
- RM Procurement Workspace (demand pools: order, monthly plan, replenishment)
- Role-based dashboards and Control Tower
- Stock, locations, and movement ledger foundations

**Rule:** Core Product **must never be broken or forked** for a single customer. If a customer need conflicts with core behavior, the need is reclassified or delivered via a lower layer.

### 7.2 Optional Modules

**Definition:** Licensed capabilities that extend Core without altering Core semantics.

**Examples (future):**

- Advanced costing / variance analytics
- Multi-plant inventory transfer
- Customer portal / vendor portal
- Tally / external finance deep integration packs
- Maintenance (PM) module

Optional modules **plug into** Core workflows via defined integration contracts documented in Volume 7.

### 7.3 Configuration

**Definition:** Customer-specific behavior within Core and Optional boundaries—no code change.

**Examples:**

- Feature flags and planning thresholds
- Role assignments and approval limits
- Document numbering sequences
- Location and warehouse structure
- Green-level / buffer parameters for monthly planning
- Commercial terms on quotations

Configuration is **upgrade-safe** and **versioned** with the product.

### 7.4 Custom Extensions

**Definition:** Customer- or partner-specific code, integrations, or UI outside the standard release artifact.

**Rules:**

- Custom extensions **must not modify Core** source or schema in ways that block upgrades.
- Extensions integrate through published APIs, events, and extension points (Volume 7).
- FT ERP Product Architecture reviews all extension designs that touch workflow or data ownership.

---

## 8. Requirement classification policy

Before any feature is designed or built, it must be classified:

| Classification | Question | Outcome if misclassified |
|----------------|----------|--------------------------|
| **Core** | Should every FT ERP customer have this? | Fragmented product; upgrade risk |
| **Optional** | Valuable segment-specific capability? | Core bloat |
| **Configuration** | Same behavior, different parameters? | Unnecessary code forks |
| **Custom** | Single-customer or partner-only? | Core contamination |

**Escalation:** If classification is disputed, Product Architecture decides and records the decision in the change log.

---

## 9. Standard product protection policy

The standard product is FT ERP’s most valuable asset. Protection rules:

1. **No customer-specific Core changes** — Ever. Customer urgency does not override this rule.
2. **Configuration first** — Before Optional or Custom, exhaust configuration.
3. **Optional before Custom** — If multiple customers need a capability, productize as Optional Module.
4. **Regression guardrails** — Business model isolation (REGULAR vs. NO_QTY), workflow ownership, and planning/execution separation are protected by automated tests (Volume 8).
5. **Documentation before code** — Material workflow or ownership changes require domain specification update (Volume 3+) before implementation.
6. **Single codebase** — One product line; no permanent customer branches in Core.
7. **Partner accountability** — Implementation partners deliver configuration and Custom Extensions under FT ERP architecture standards.

**Violation consequence:** Changes that break Core require rollback and architectural review—not patchwork in production.

---

## 10. Product roadmap philosophy

### 10.1 Horizon model

| Horizon | Focus | Planning cadence |
|---------|-------|------------------|
| **Now (0–6 months)** | Core workflow completeness, UX handoffs, regression stability | Sprint / release train |
| **Next (6–18 months)** | Optional modules, integration packs, analytics depth | Quarterly themes |
| **Later (18–36 months)** | Adjacent segments, multi-plant, ecosystem | Annual strategy review |
| **Vision (3–10 years)** | Platform, partner ecosystem, industry packs | Volume 0 revision |

### 10.2 Roadmap principles

1. **Execution before analytics** — A factory that cannot issue material correctly does not need a prettier dashboard.
2. **Depth before breadth** — Complete REGULAR and NO_QTY pipelines before adding unrelated domains.
3. **Workflow before feature** — Ship end-to-end ownership handoffs, not isolated screens.
4. **Document before build** — Domain specs precede development for any workflow-touching change.
5. **One convergence point** — Post–work-order execution stays unified; planning may diverge, execution must not.
6. **Measurable outcomes** — Roadmap items tie to factory metrics: shortage lead time, Pending Action age, production block rate—not vanity feature counts.

### 10.3 What the roadmap is not

- A list of customer tickets without classification.
- A commitment to replicate enterprise ERP module parity.
- A substitute for Volume 3 domain specifications.

---

## 11. Long-term product strategy

### 11.1 Strategic pillars (5–10 years)

**Pillar 1 — Manufacturing workflow authority**  
FT ERP becomes the reference model for how mid-market discrete factories orchestrate planning and execution.

**Pillar 2 — Dual-model mastery**  
REGULAR and NO_QTY remain strictly isolated yet equally mature—no second-class agreement flow.

**Pillar 3 — Extensible core**  
Optional modules and partner extensions grow an ecosystem without forking Core.

**Pillar 4 — Operational intelligence**  
Control Tower evolves from visibility to predictive signals (shortage risk, cycle slippage, procurement lag)—still workflow-grounded, not generic BI.

**Pillar 5 — Implementation repeatability**  
Documentation, configuration templates, and industry packs reduce time-to-live for new customers.

### 11.2 Geographic and go-to-market strategy (product implications)

Initial product depth assumes **Indian mid-market manufacturing** conventions (GST commercial flows, RM weight in kg, Tally-adjacent finance export patterns)—without binding the product to a single geography. Core workflows remain globally intelligible; **localization** is Configuration and Optional—not Core forks.

### 11.3 Technology strategy (product-level only)

- **Single logical product** with API-first integration boundaries.
- **Upgradeable releases** with schema migration discipline.
- **Auditability** for manufacturing disputes (who approved, what snapshot, what issued).
- Technical detail resides in Volume 7; this volume states intent only.

---

## 12. Product evolution policy

### 12.1 How FT ERP evolves

Evolution is **incremental and documented**, not reactive:

1. **Identify** — Factory pain or customer need.
2. **Classify** — Core / Optional / Configuration / Custom.
3. **Specify** — Update domain or workflow documentation.
4. **Design** — UX standards and data impact (Volumes 5–6).
5. **Build** — With regression tests for workflow invariants.
6. **Release** — Versioned, with release notes mapped to documentation versions.
7. **Measure** — Operational metrics post-release.

### 12.2 Workflow invariant changes

Changes to the following require **Volume 2 or Volume 4 revision** and explicit approval:

- Business model selection and inheritance rules
- Planning pipeline boundaries
- Post–work-order execution sequence
- Role ownership matrix
- Frozen artifact definitions (snapshots, PMR, released RM plans)

### 12.3 Deprecation

Features are deprecated in documentation **before** removal. Deprecated behavior remains supported for at least one major release unless security-critical.

---

## 13. Versioning philosophy

### 13.1 Product documentation versioning

- Documentation uses **semantic versioning** at document level: `MAJOR.MINOR.PATCH`.
  - **MAJOR** — Breaking change to product principles or workflow invariants.
  - **MINOR** — New sections, expanded domain coverage, backward-compatible clarifications.
  - **PATCH** — Typos, formatting, non-semantic corrections.
- **Approved** documents are immutable except through a new version.
- Superseded versions remain in Git history with status `Superseded` and pointer to replacement.

### 13.2 Product software versioning

- Customer-facing releases follow **release train** semantics (e.g. `2026.05`) aligned to documentation MINOR updates.
- Database migrations are **forward-only** in production; rollbacks are application-level.
- Configuration export/import is version-tagged for upgrade compatibility.

### 13.3 Relationship between docs and code

| Documentation status | Software expectation |
|---------------------|----------------------|
| Draft | Exploratory; may not reflect production |
| Approved | Must be reflected in shipped behavior or tracked as gap |
| Superseded | Historical reference only |

Volume 0 governs **intent**; Volume 3+ govern **behavior**. Gaps between approved docs and product are **defects**, not documentation errors—unless the doc is still Draft.

---

## 14. Customer customization philosophy

### 14.1 Default stance

**FT ERP is configured, not rewritten.**

Customers buy a standard manufacturing operating model. Individual factories differ in parameters, organizational roles, and integrations—not in fundamental truths such as “production requires issued material.”

### 14.2 Customization hierarchy

When a customer requests change, apply this order:

1. **Training / process alignment** — Use the product as designed.
2. **Configuration** — Thresholds, roles, locations, sequences.
3. **Optional module** — If the need is segment-wide.
4. **Custom extension** — Isolated, upgrade-safe code.
5. **Product feedback** — If the need reveals a Core gap, feed the roadmap—do not patch Core locally.

### 14.3 Partner and SI role

Implementation partners:

- Deliver configuration and extensions within FT ERP architecture.
- Do not promise Core modifications.
- Reference this documentation set in statements of work.

### 14.4 Upgrade contract with customers

Customers on Custom Extensions accept:

- Core and Optional upgrades apply on FT ERP’s schedule.
- Extensions are retested per release by the partner or customer.
- Configuration migrations are provided by FT ERP for standard parameters.

---

## 15. Relationship to other volumes

| Volume | Relationship to Volume 0 |
|--------|--------------------------|
| **Volume 1 — Product Foundation** | Expands philosophy into principles, constitution, and glossary |
| **Volume 2 — Business Architecture** | Formalizes REGULAR / NO_QTY, planning pipelines, execution pipeline |
| **Volume 3 — Domain Specifications** | Defines module behavior referenced by strategy |
| **Volume 4 — Workflow Engine** | Implements workflow-driven mandate |
| **Volume 6 — UX Standards** | Implements Dashboard / Workspace / Control Tower |
| **Volume 8 — Testing** | Enforces standard product protection |
| **Volume 10 — Manufacturing Knowledge** | Captures BOM, loss, and RM domain expertise |

Volume 0 is revised rarely—typically annually or upon strategic pivot. Operational detail never belongs here.

---

## 16. Success measures

FT ERP Product Vision & Strategy is successful when:

- New features are classified before build—**100%** for workflow-touching changes.
- No customer-specific Core forks exist in the codebase.
- REGULAR and NO_QTY isolation regressions are caught in CI.
- Implementation teams cite documentation as the authority in design reviews.
- Operators describe FT ERP as *“telling me what to do next”*—not *“where I record what I already did.”*

---

## 17. Glossary (strategic terms)

| Term | Definition |
|------|------------|
| **REGULAR Order** | Fixed-quantity commercial order; order-driven planning |
| **NO_QTY Agreement** | Agreement without fixed order quantity; cycle and monthly planning |
| **MPRS** | Monthly Planning RM Snapshot — period-based RM demand released to procurement |
| **PMR** | Production Material Request — frozen RM requirement for a work order |
| **Control Tower** | Factory-wide monitoring and risk surface |
| **Frozen artifact** | Planning output that execution must not reinterpret (snapshot, PMR, released plan) |
| **Core Product** | Non-negotiable standard FT ERP capability |

Full glossary: Volume 1.

---

## 18. Change log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | Product Architecture | Initial Volume 0 — Phase 1 draft |

---

## 19. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture | | | |
| Engineering Lead | | | |

---

## Document navigation

| | Link |
|--|------|
| **Previous** | — |
| **Next** | [Introduction](../01_Product_Foundation/Chapter_01_Introduction.md) (FT-PD-001) |
| **Volume** | [Product Vision and Strategy](./README.md) |
| **Product** | [Product Documentation Index](../README.md) |

