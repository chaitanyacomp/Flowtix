# Introduction

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-011 |
| **Volume** | 1 — Product Foundation |
| **Chapter** | 1 — Introduction |
| **Title** | Introduction |
| **Version** | 1.0.0 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture |
| **Audience** | New stakeholders, product owners, architects, implementation partners, QA leads, customer executives |
| **Classification** | Product — Orientation |

**Parent documents:**

- [Volume 0 — Product Vision & Strategy](../00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md)
- [Product Documentation Index](../README.md)
- [Architecture Map & Navigation Guide](../Architecture_Map_and_Navigation_Guide.md) (FT-PD-999)

**Next required reading:** [Chapter 2 — FT ERP Constitution](./Chapter_02_FT_ERP_Constitution.md)

---

## 1. Document Control

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial Introduction — orientation for Product Foundation and the Constitution |

**Supersedes:** None.

**Change authority:** Product Architecture. Orientation updates require version increment when material.

**Out of scope:** New product architecture, Business Rules, workflow semantics, domain behavior, or implementation detail.

---

## 2. Purpose

This chapter orients readers before they read the [FT ERP Constitution](./Chapter_02_FT_ERP_Constitution.md) and the rest of the Product Documentation corpus.

It explains:

- **Why the Constitution exists**
- **How volumes relate** to one another
- **How to navigate** the documentation set
- **Who each volume serves**
- **Which document governs** when questions arise

This is an **orientation document only**. It does not define new laws, workflows, or product behavior.

---

## 3. Scope

### 3.1 In scope

- Onboarding guidance for Volumes 0–10
- Authority hierarchy and reading order
- Document conventions used across the corpus
- Governance philosophy at documentation level

### 3.2 Out of scope

- Constitutional Articles (see [Chapter 2](./Chapter_02_FT_ERP_Constitution.md))
- Official terminology definitions (see [Chapter 3 — Glossary](./Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md))
- Design patterns and UX standards (see [Chapter 4 — Design Principles](./Chapter_04_FT_ERP_Product_Design_Principles.md))
- Domain, workflow, data, or operational specifications (Volumes 2–10)

---

## 4. Why the Constitution Exists

FT ERP is a **commercial workflow-driven manufacturing ERP**. Factory reality is complex: RM constraints, role ownership, planning cycles, material accountability, and cross-department handoffs must remain **predictable** across releases, partners, and customer deployments.

The [Constitution](./Chapter_02_FT_ERP_Constitution.md) exists to:

1. **Translate strategy into law** — Volume 0 explains *why* FT ERP exists; the Constitution defines *what must never be violated* in product behavior and design.
2. **Protect customer trust** — Operators, planners, and managers rely on consistent workflow ownership, Pending Actions, and material traceability.
3. **Prevent architectural drift** — Without permanent laws, urgent requests and shortcuts accumulate into an incoherent product.
4. **Enable governed evolution** — Volume 10 defines how FT ERP changes; the Constitution defines what change **cannot** erode.

If you read only one binding document after this introduction, read the **Constitution**.

---

## 5. Relationship with Volume 0

| Document | Role |
|----------|------|
| [Volume 0 — Product Vision & Strategy](../00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) | **Strategic anchor** — vision, mission, positioning, product layers, roadmap philosophy |
| **Volume 1 — Product Foundation** | **Operational foundation** — laws, vocabulary, design standards |
| [Constitution](./Chapter_02_FT_ERP_Constitution.md) | **Highest operational authority** — Articles 1–23 |

**Hierarchy on conflict:**

- **Volume 0 governs strategy** — long-term direction and product intent.
- **The Constitution governs product behavior and design decisions** — workflow rules, ownership, UX surfaces, material accountability, Core Product protection.
- Formal reconciliation is required when strategy and constitutional law appear to conflict; neither document is silently overridden.

Read **Volume 0 first**, then this introduction, then the **Constitution**.

---

## 6. Relationship with the Remaining Volumes

Volumes 2–10 **apply** the Constitution. They do not replace it.

| Volume | Folder | Question answered |
|--------|--------|-------------------|
| **0** | [00_Product_Vision_and_Strategy](../00_Product_Vision_and_Strategy/) | Why does FT ERP exist? |
| **1** | [01_Product_Foundation](./) | What laws, vocabulary, and design standards govern the product? |
| **2** | [02_Business_Architecture](../02_Business_Architecture/) | How do business models, pipelines, and ownership work? |
| **3** | [03_Domain_Specifications](../03_Domain_Specifications/) | What does each domain do? |
| **4** | [04_Workflow_Engine](../04_Workflow_Engine/) | How do states, guards, and Pending Actions work? |
| **5** | [05_Data_Architecture](../05_Data_Architecture/) | How is data persisted, snapshotted, and ledgered? |
| **6** | [06_UI_and_Experience_Architecture](../06_UI_and_Experience_Architecture/) | How do Dashboard, Workspace, and Control Tower surfaces behave? |
| **7** | [07_Security_and_Governance_Architecture](../07_Security_and_Governance_Architecture/) | How are security, audit, configuration, and integration governed? |
| **8** | [08_Product_Testing_and_Validation](../08_Product_Testing_and_Validation/) | How is conformance proven? |
| **9** | [09_Deployment_and_Operations_Architecture](../09_Deployment_and_Operations_Architecture/) | How is the product deployed, operated, and recovered? |
| **10** | [10_Product_Lifecycle_and_Continuous_Evolution](../10_Product_Lifecycle_and_Continuous_Evolution/) | How does the product evolve and endure? |

Volume 11 (Manufacturing Knowledge) is **planned** as optional domain-depth reference — not required to understand the core architecture arc.

---

## 7. Architecture Authority Hierarchy

```
Volume 0 — Product Vision & Strategy          (strategic direction)
        ↓
Volume 1 — FT ERP Constitution                (operational law — Articles 1–23)
        ↓
Volume 1 — Glossary & Design Principles       (vocabulary + design standards)
        ↓
Volumes 2–10 — Architecture & domains         (specified behavior and governance)
        ↓
Certified product release & tenant config     (running instance)
```

| Layer | Authority | When to consult |
|-------|-----------|-----------------|
| **Strategy** | Volume 0 | Positioning, roadmap philosophy, product layers |
| **Law** | Constitution | Any proposal that changes behavior, ownership, or surfaces |
| **Vocabulary** | Glossary | Naming, abbreviations, official document terms |
| **Design** | Design Principles | Module and surface design decisions |
| **Specification** | Volumes 2–7 | Domain, workflow, data, UX, security detail |
| **Proof** | Volume 8 | Validation, Protected Behaviors, certification |
| **Operations** | Volume 9 | Deployment, upgrade, recovery |
| **Evolution** | Volume 10 | Roadmap, ADRs, quality, knowledge, stewardship |

**Rule of thumb:** If a change touches **workflow semantics**, **Protected Behaviors**, or **Constitution Articles**, stop and follow Volume 10 change governance — do not implement from a single volume in isolation.

---

## 8. Scope of the Constitution

The [Constitution](./Chapter_02_FT_ERP_Constitution.md) defines **permanent architectural laws** including:

- Manufacturing and business-first principles
- REGULAR Order and NO_QTY Agreement business models
- Planning vs execution separation
- Material accountability
- Document ownership and Pending Actions
- Dashboard, Workspace, and Control Tower responsibilities
- Core Product, Configuration, and Custom layers
- Auditability and continuous evolution

The Constitution **does not** contain step-by-step workflow tables, field-level domain specs, guard catalogs, or deployment procedures — those live in Volumes 3–9 and are **subordinate** to the Articles.

For the full Article list and scope detail, see [Constitution §3](./Chapter_02_FT_ERP_Constitution.md).

---

## 9. Reading Order

### 9.1 Essential path (all stakeholders)

1. [Volume 0 — Product Vision & Strategy](../00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md)
2. **This chapter — Introduction** (FT-PD-011)
3. [Chapter 2 — FT ERP Constitution](./Chapter_02_FT_ERP_Constitution.md)
4. [Chapter 3 — Glossary & Standard Terminology](./Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md)
5. [Chapter 4 — Product Design Principles](./Chapter_04_FT_ERP_Product_Design_Principles.md)

### 9.2 Full corpus path

Continue with the numbered reading order in the [Product Documentation Index](../README.md) — entries 6 through 58 — which walks Volumes 2–10 in dependency order.

### 9.3 Role-based entry points

| Role | Start here | Then |
|------|------------|------|
| **Product / business owner** | Volume 0 → Constitution | Volume 2 Business Architecture |
| **Architect / lead engineer** | Constitution → Glossary | Volume 4 Workflow Engine, Volume 5 Data |
| **Domain owner** | Constitution Art. relevant to domain | Volume 3 domain chapter + Volume 4 State Machine |
| **UX / product design** | Design Principles | Volume 6 UI Architecture |
| **QA / validation** | Constitution | Volume 8, especially Protected Behavior Catalog |
| **DevOps / operations** | Constitution Art. 22 | Volume 9 |
| **Implementation partner** | This introduction → Constitution | Volume 2, Volume 9 install/upgrade chapters |
| **New hire (any role)** | This chapter → Index reading order | Role row above |

---

## 10. Intended Audience

| Audience | Use of this corpus |
|----------|-------------------|
| **FT ERP product team** | Authoritative blueprint for all product decisions |
| **Engineering and QA** | Conformance target for implementation and regression |
| **Implementation partners** | Boundary for Configuration and Custom work — not Core modification |
| **Customer executives and IT** | Architecture review and governance understanding |
| **Future contributors** | Onboarding and stewardship handoff (Volume 10) |

All audiences share one rule: **product documentation is the single source of truth** for product architecture. Customer guides and training materials derive from these volumes — they do not override them.

---

## 11. How to Use the Documentation

### 11.1 Navigation

- Start at the [Product Documentation Index](../README.md) for the volume list and full reading order.
- Each volume folder contains a **README** with chapter table, document IDs, and local reading order.
- Chapters cross-reference related volumes — follow links when assessing impact of a change.

### 11.2 When proposing a change

1. Identify affected **Constitution Articles**.
2. Check **Protected Behaviors** ([Volume 8, Ch. 2](../08_Product_Testing_and_Validation/Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md)).
3. Consult authoritative volume for the area (workflow → Volume 4; data → Volume 5; etc.).
4. Follow **Volume 10** change governance (ADRs, impact assessment, certification).

### 11.3 When resolving disputes

| Question type | Authoritative source |
|---------------|---------------------|
| Strategic intent | Volume 0 |
| Product law | Constitution |
| Official term | Glossary |
| Valid transition / guard | Volume 4 |
| Domain behavior | Volume 3 |
| UX surface responsibility | Volume 6 + Constitution Art. 13–14 |
| Release readiness | Volume 8 |
| Deploy / upgrade | Volume 9 |

### 11.4 Status and versioning

Chapters carry **Status** (Draft, In Review, Approved, Superseded) and **Version** in the document header. Treat **Draft — Architecture Review** chapters as the working baseline during Version 1.0 preparation. Approved chapters change only through controlled version increment and change log entry.

---

## 12. Document Conventions

| Convention | Rule |
|------------|------|
| **Document ID** | Format `FT-PD-NNN` — permanent registry identifier |
| **File naming** | `Chapter_XX_<Title>.md` within volume folders |
| **Volume numbering** | 0–10 core corpus; 11 planned optional |
| **Business Rules** | Prefix by chapter/volume (e.g. WFE-, GRD-, PBL-, EVO-, ADR-) — do not renumber |
| **Cross-references** | Link to authoritative chapter; downstream volumes reference upstream — do not redefine |
| **Technology neutrality** | Product architecture only — no source code, vendors, or tooling in normative chapters |
| **Diagrams** | Mermaid for logical flows; semantics remain in prose and tables |
| **Approval Block** | Standard sign-off table at chapter end — required before Approved status |

---

## 13. Governance Philosophy

Product documentation governance follows the same discipline as the product itself:

| Principle | Meaning |
|-----------|---------|
| **Constitution-first** | Laws before features |
| **Single source of truth** | Product docs govern architecture |
| **Traceability** | Decisions link proposal → ADR → release → evidence (Volume 10) |
| **Protected behaviors** | Cataloged invariants enforced through validation (Volume 8) |
| **Governed evolution** | Innovation and debt visible — not silent (Volume 10) |
| **Knowledge continuity** | Documentation survives personnel change (Volume 10, Ch. 4) |
| **Long-term stewardship** | Architecture endures across decades (Volume 10, Ch. 5) |

Version 1.0 baseline preparation aligns metadata, links, and terminology across the corpus **without changing** architectural meaning.

---

## 14. Review Checklist

- [ ] Reader can locate Volume 0, Constitution, and Index
- [ ] Authority hierarchy is clear — strategy vs law vs specification
- [ ] No new Articles, rules, guards, or domain behavior introduced
- [ ] Reading order points to Constitution as next step
- [ ] Role-based entry paths documented

---

## 15. Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial Introduction — P15 baseline preparation |

---

## 16. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture Board Chair | | | |
| Documentation Steward | | | |

---

## Document navigation

| | Link |
|--|------|
| **Previous** | — |
| **Next** | [FT ERP Constitution](./Chapter_02_FT_ERP_Constitution.md) (FT-PD-012) |
| **Volume** | [Product Foundation](./README.md) |
| **Product** | [Product Documentation Index](../README.md) |

