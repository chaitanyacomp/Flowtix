# FT ERP — Architecture Map & Navigation Guide

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-999 |
| **Volume** | — (Product Index) |
| **Title** | Architecture Map & Navigation Guide |
| **Version** | 1.0.0 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture |
| **Audience** | All stakeholders entering the Product Documentation corpus |
| **Classification** | Product — Navigation & Orientation |

**Parent documents:**

- [Product Documentation Index](./README.md)

**Recommended first reading:** [Volume 0 — Product Vision & Strategy](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) (FT-PD-000), then [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md) (FT-PD-011)

---

## 1. Purpose

This document is the **primary entry point** into the complete FT ERP Product Documentation (Volumes 0–10).

The Product Documentation corpus is the **Single Source of Truth** for FT ERP product architecture. It defines why the product exists, what it must do, how workflows execute, how data persists, how users interact with the system, and how the product is validated, deployed, and evolved.

This guide does **not** define architecture. It orients readers to:

- **What exists** — eleven volumes (0–10), 58 chapter documents, and reserved ID ranges
- **Where to start** — role-based reading paths in §2
- **How documentation is organized** — volume map in §3
- **How volumes relate** — dependency and traceability maps in §4–§6
- **How to navigate** — quick links in §7
- **How to extend the corpus** — maintenance rules in §8

For the full sequential chapter list, see the [Product Documentation Index](./README.md#reading-order-for-new-stakeholders).

---

## 2. Reading Paths

Each path lists **entry documents** and **follow-on volumes**. Read in order within a path; cross-link to other volumes when your question spans domains.

### Executive / Business Owner

| Step | Document | Why |
|------|----------|-----|
| 1 | [Volume 0 — Product Vision & Strategy](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) (FT-PD-000) | Strategic mandate and product positioning |
| 2 | [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md) (FT-PD-011) | Corpus orientation |
| 3 | [FT ERP Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) (FT-PD-012) | Non-negotiable product laws (Articles 1–23) |
| 4 | [Volume 2 — Business Architecture](./02_Business_Architecture/README.md) | Business models, pipelines, ownership |
| 5 | [Volume 10 — Product Lifecycle](./10_Product_Lifecycle_and_Continuous_Evolution/README.md) | Roadmap and evolution governance |

### Product Manager

| Step | Document | Why |
|------|----------|-----|
| 1 | [Volume 0](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) → [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md) → [Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) | Foundation |
| 2 | [Glossary](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) (FT-PD-013) | Official terminology |
| 3 | [Design Principles](./01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md) (FT-PD-014) | UX and product constraints |
| 4 | [Volume 2](./02_Business_Architecture/README.md) + [Volume 3 — Domain Specifications](./03_Domain_Specifications/README.md) | Business and domain behavior |
| 5 | [Volume 6 — UI & Experience](./06_UI_and_Experience_Architecture/README.md) | Dashboard, Workspace, Control Tower |
| 6 | [Volume 10, Ch. 2 — Feature Governance](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md) (FT-PD-101) | Change control |

### Solution Architect

| Step | Document | Why |
|------|----------|-----|
| 1 | [Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) + [Glossary](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) | Authority and vocabulary |
| 2 | [Volume 2](./02_Business_Architecture/README.md) | Business structure |
| 3 | [Volume 3](./03_Domain_Specifications/README.md) | Domain contracts |
| 4 | [Volume 4 — Workflow Engine](./04_Workflow_Engine/README.md) | State machines, Guards, orchestration |
| 5 | [Volume 5 — Data Architecture](./05_Data_Architecture/README.md) | Persistence and Read Models |
| 6 | [Volume 7 — Security & Governance](./07_Security_and_Governance_Architecture/README.md) | Authorization, audit, configuration |

### ERP Consultant

| Step | Document | Why |
|------|----------|-----|
| 1 | [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md) → [Glossary](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) | Terminology alignment |
| 2 | [Volume 2, Ch. 1 — Business Models](./02_Business_Architecture/Chapter_01_Business_Models_and_Document_Inheritance.md) (FT-PD-020) | REGULAR vs NO_QTY |
| 3 | [Volume 2, Ch. 5 — Ownership Matrix](./02_Business_Architecture/Chapter_05_Document_Ownership_and_Responsibility_Matrix.md) (FT-PD-024) | Role ownership |
| 4 | [Volume 3](./03_Domain_Specifications/README.md) (domain of engagement) | Field and behavior detail |
| 5 | [Volume 6](./06_UI_and_Experience_Architecture/README.md) | Operational surfaces |
| 6 | [Volume 9 — Deployment & Operations](./09_Deployment_and_Operations_Architecture/README.md) | Implementation and cutover |

### Developer

| Step | Document | Why |
|------|----------|-----|
| 1 | [Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) (Arts. 11–14) | Workflow and Pending Actions mandate |
| 2 | [Volume 4, Ch. 1 — Workflow Engine Overview](./04_Workflow_Engine/Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md) (FT-PD-040) | Engine contract |
| 3 | [Volume 4, Ch. 2 — Guard Registry](./04_Workflow_Engine/Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md) (FT-PD-041) | Authoritative `GRD_*` definitions |
| 4 | Relevant [Volume 4 State Machine](./04_Workflow_Engine/README.md) chapter | Domain transitions |
| 5 | [Volume 5](./05_Data_Architecture/README.md) | Document model, ledger, snapshots |
| 6 | [Volume 8, Ch. 2 — Regression Guardrails](./08_Product_Testing_and_Validation/Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md) (FT-PD-081) | Protected behaviors |

### QA / Test Engineer

| Step | Document | Why |
|------|----------|-----|
| 1 | [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md) → [Glossary](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) | Shared language |
| 2 | [Volume 8 — Product Testing & Validation](./08_Product_Testing_and_Validation/README.md) | Full validation framework |
| 3 | [Volume 4, Ch. 2 — Guard Registry](./04_Workflow_Engine/Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md) (FT-PD-041) | Guard semantics to test |
| 4 | [Volume 3](./03_Domain_Specifications/README.md) + matching Volume 4 state machine | Domain + transition coverage |
| 5 | [Volume 8, Ch. 3 — Canonical Scenarios](./08_Product_Testing_and_Validation/Chapter_03_Canonical_Test_Data_Factory_Simulation_and_Acceptance_Scenarios.md) (FT-PD-082) | Acceptance scenarios |

### Implementation Partner

| Step | Document | Why |
|------|----------|-----|
| 1 | [Volume 0](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) → [Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) | Product laws |
| 2 | [Volume 2](./02_Business_Architecture/README.md) + [Volume 3](./03_Domain_Specifications/README.md) | Business and domain scope |
| 3 | [Volume 7](./07_Security_and_Governance_Architecture/README.md) | Identity, configuration, integration boundaries |
| 4 | [Volume 9](./09_Deployment_and_Operations_Architecture/README.md) | Deployment, migration, operations |
| 5 | [Volume 8, Ch. 4 — Release Readiness](./08_Product_Testing_and_Validation/Chapter_04_User_Acceptance_Certification_and_Release_Readiness.md) (FT-PD-083) | Certification gates |

### Customer

| Step | Document | Why |
|------|----------|-----|
| 1 | [Volume 0 — Product Vision & Strategy](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) (FT-PD-000) | Product intent and value |
| 2 | [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md) (FT-PD-011) | How documentation is structured |
| 3 | [Volume 2, Ch. 1 — Business Models](./02_Business_Architecture/Chapter_01_Business_Models_and_Document_Inheritance.md) (FT-PD-020) | Order types and document flow |
| 4 | [Volume 2, Ch. 5 — Ownership Matrix](./02_Business_Architecture/Chapter_05_Document_Ownership_and_Responsibility_Matrix.md) (FT-PD-024) | Who owns each process step |
| 5 | [Volume 6, Ch. 1 — UI Principles](./06_UI_and_Experience_Architecture/Chapter_01_UI_Architecture_Navigation_and_Experience_Principles.md) (FT-PD-060) | How operators work in the product |

*Customer-facing training and guides must derive from this corpus — they must not override it ([Volume 10, Ch. 4 — KNW-08](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md)).*

---

## 3. Volume Map

Volumes are listed in **dependency order** (read top-to-bottom for first-time corpus traversal).

| Vol | Folder | Document ID range | Purpose | Primary audience | Depends on | Used by |
|-----|--------|-------------------|---------|------------------|------------|---------|
| **0** | [00_Product_Vision_and_Strategy](./00_Product_Vision_and_Strategy/) | FT-PD-000 | Why FT ERP exists; vision, mission, roadmap, product governance | Executives, product leadership | — | All volumes |
| **1** | [01_Product_Foundation](./01_Product_Foundation/) | FT-PD-011 – 014 | Introduction, Constitution, Glossary, Design Principles | All stakeholders | Volume 0 | Volumes 2–10 |
| **2** | [02_Business_Architecture](./02_Business_Architecture/) | FT-PD-020 – 025 | Business models, planning pipelines, execution pipeline, ownership, commercial chain | Product, architects, consultants | Volume 1 | Volumes 3–4, 6, 8 |
| **3** | [03_Domain_Specifications](./03_Domain_Specifications/) | FT-PD-030 – 035 | Domain behavior: commercial, planning, procurement, manufacturing, QA, dispatch | Domain owners, developers, QA | Volumes 1–2 | Volumes 4–6, 8 |
| **4** | [04_Workflow_Engine](./04_Workflow_Engine/) | FT-PD-040 – 048 | Workflow Engine, Guard Registry, state machines, orchestration, Pending Actions | Workflow engineers, developers, QA | Volumes 1–3 | Volumes 5–6, 8 |
| **5** | [05_Data_Architecture](./05_Data_Architecture/) | FT-PD-050 – 055 | Event store, transactional documents, master data, snapshots, ledger, Read Models | Data architects, backend leads | Volumes 2–4 | Volumes 6–7, 8 |
| **6** | [06_UI_and_Experience_Architecture](./06_UI_and_Experience_Architecture/) | FT-PD-060 – 065 | Dashboard, Workspace, Control Tower, registers, reports, UX principles | UX, product, developers | Volumes 1, 3–5 | Volume 8 |
| **7** | [07_Security_and_Governance_Architecture](./07_Security_and_Governance_Architecture/) | FT-PD-070 – 074 | Security, identity, audit, configuration, integration trust boundaries | Security, governance, ops | Volumes 1, 4–5 | Volumes 8–9 |
| **8** | [08_Product_Testing_and_Validation](./08_Product_Testing_and_Validation/) | FT-PD-080 – 084 | Validation framework, regression guardrails, scenarios, certification, evidence | QA, validation, release governance | Volumes 1–7 | Volumes 9–10 |
| **9** | [09_Deployment_and_Operations_Architecture](./09_Deployment_and_Operations_Architecture/) | FT-PD-090 – 094 | Deployment, migration, monitoring, resilience, operational governance | Implementation, operations | Volumes 1, 7–8 | Volume 10 |
| **10** | [10_Product_Lifecycle_and_Continuous_Evolution](./10_Product_Lifecycle_and_Continuous_Evolution/) | FT-PD-100 – 104 | Lifecycle, change control, quality, knowledge management, stewardship | Product leadership, architecture board | Volumes 0–9 | Future volumes |

**Index document:** FT-PD-999 (this guide).

**Planned:** Volume 11 — Manufacturing Knowledge Reference Architecture (reserved; not part of Volumes 0–10 baseline).

---

## 4. Architecture Dependency Map

Logical documentation flow from strategy to evolution. Each layer **implements or validates** the layer above; lower layers must not contradict higher authority.

```
Vision                          Volume 0  (FT-PD-000)
    ↓
Constitution                    Volume 1  (FT-PD-012)
    ↓
Business Architecture           Volume 2  (FT-PD-020 – 025)
    ↓
Domain Specifications           Volume 3  (FT-PD-030 – 035)
    ↓
Workflow Engine                 Volume 4  (FT-PD-040 – 048)
    ↓
Data Architecture               Volume 5  (FT-PD-050 – 055)
    ↓
UI Architecture                 Volume 6  (FT-PD-060 – 065)
    ↓
Security                        Volume 7  (FT-PD-070 – 074)
    ↓
Testing                         Volume 8  (FT-PD-080 – 084)
    ↓
Deployment                      Volume 9  (FT-PD-090 – 094)
    ↓
Product Lifecycle               Volume 10 (FT-PD-100 – 104)
```

**Cross-cutting foundations (Volume 1):** [Glossary](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) (FT-PD-013) and [Design Principles](./01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md) (FT-PD-014) apply across all layers below the Constitution.

---

## 5. Traceability

Use this chain to follow a requirement from strategy to validation. Each step links to the authoritative volume; do not infer behavior from implementation code when documentation exists.

```
Vision
    ↓  Volume 0 — strategic intent, business models at product level
Constitution
    ↓  Volume 1, Ch. 2 — Articles and constitutional Business Rules
Business Rule
    ↓  Volume 2–3 — BM-*, domain rules (COM-, PLN-, PRC-, MFG-, QAS-, DSP-)
Workflow
    ↓  Volume 4, Ch. 1 — engine contract; domain Business Workflows
State Machine
    ↓  Volume 4, Ch. 3–8 — per-document states and transitions
Guard
    ↓  Volume 4, Ch. 2 — Guard Registry (`GRD_*`); per-action guard order in Ch. 3–8
Data
    ↓  Volume 5 — documents, snapshots, ledger, Read Models
UI
    ↓  Volume 6 — Dashboard, Workspace, Control Tower projections
Testing
    ↓  Volume 8 — VAL-*, PBL-*, CAN-*, REL-*, EVD-* rules and scenarios
```

**Traceability practices:**

- Every `GRD_*` Guard ID is defined once in [FT-PD-041 §9](./04_Workflow_Engine/Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md).
- Domain validation matrices in Volume 3 map to Guards in Volume 4.
- Protected behaviors in [FT-PD-081](./08_Product_Testing_and_Validation/Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md) reference Constitution Articles and engine rules — they do not redefine them.
- `correlationId` threads cross-domain cases from Volume 4 orchestration through Volume 5 event store to Volume 6 Control Tower rows.

---

## 6. Document Relationships

| Layer | Role in the corpus |
|-------|------------------|
| **Constitution** | Governs all volumes. Highest operational authority ([FT-PD-012](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)). Volume 0 governs strategic tension until reconciled. |
| **Glossary** | Defines official terminology ([FT-PD-013](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md)). No volume may redefine listed terms. |
| **Design Principles** | Constrains UX and product behavior ([FT-PD-014](./01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md)). Dashboard / Workspace / Control Tower philosophy. |
| **Business Architecture** | Defines business structure, pipelines, and role ownership ([Volume 2](./02_Business_Architecture/README.md)). |
| **Domain Specifications** | Define **what** each domain document must do ([Volume 3](./03_Domain_Specifications/README.md)). |
| **Workflow Engine** | Defines **how** execution runs — states, Guards, Pending Actions ([Volume 4](./04_Workflow_Engine/README.md)). |
| **Data Architecture** | Defines **persistence** — documents, immutability, ledger, Read Models ([Volume 5](./05_Data_Architecture/README.md)). |
| **UI Architecture** | Defines **presentation** — surfaces that consume engine and Read Model output ([Volume 6](./06_UI_and_Experience_Architecture/README.md)). |
| **Security** | Defines **governance** — authorization, audit, configuration boundaries ([Volume 7](./07_Security_and_Governance_Architecture/README.md)). |
| **Testing** | **Validates** architecture conformance; does not redefine rules ([Volume 8](./08_Product_Testing_and_Validation/README.md)). |
| **Deployment** | **Operationalizes** architecture in customer environments ([Volume 9](./09_Deployment_and_Operations_Architecture/README.md)). |
| **Product Lifecycle** | **Governs evolution** — change control, documentation stewardship ([Volume 10](./10_Product_Lifecycle_and_Continuous_Evolution/README.md)). |

---

## 7. Navigation Quick Links

### Product index

| Document | Link |
|----------|------|
| **Product Documentation Index** | [README.md](./README.md) |
| **Baseline v1.0.0** | [Release Notes](./release/RELEASE_NOTES_v1.0.0.md) · [Baseline Manifest](./release/BASELINE_MANIFEST_v1.0.0.md) · [Change Policy](./release/CHANGE_POLICY.md) · [Baseline Freeze](./release/BASELINE_FREEZE.md) |
| **Architecture Map & Navigation Guide** (this document) | [Architecture_Map_and_Navigation_Guide.md](./Architecture_Map_and_Navigation_Guide.md) (FT-PD-999) |

### Volume READMEs

| Volume | README |
|--------|--------|
| 0 — Product Vision & Strategy | [00_Product_Vision_and_Strategy/README.md](./00_Product_Vision_and_Strategy/README.md) |
| 1 — Product Foundation | [01_Product_Foundation/README.md](./01_Product_Foundation/README.md) |
| 2 — Business Architecture | [02_Business_Architecture/README.md](./02_Business_Architecture/README.md) |
| 3 — Domain Specifications | [03_Domain_Specifications/README.md](./03_Domain_Specifications/README.md) |
| 4 — Workflow Engine | [04_Workflow_Engine/README.md](./04_Workflow_Engine/README.md) |
| 5 — Data Architecture | [05_Data_Architecture/README.md](./05_Data_Architecture/README.md) |
| 6 — UI & Experience Architecture | [06_UI_and_Experience_Architecture/README.md](./06_UI_and_Experience_Architecture/README.md) |
| 7 — Security & Governance Architecture | [07_Security_and_Governance_Architecture/README.md](./07_Security_and_Governance_Architecture/README.md) |
| 8 — Product Testing & Validation | [08_Product_Testing_and_Validation/README.md](./08_Product_Testing_and_Validation/README.md) |
| 9 — Deployment & Operations Architecture | [09_Deployment_and_Operations_Architecture/README.md](./09_Deployment_and_Operations_Architecture/README.md) |
| 10 — Product Lifecycle & Continuous Evolution | [10_Product_Lifecycle_and_Continuous_Evolution/README.md](./10_Product_Lifecycle_and_Continuous_Evolution/README.md) |

### Foundation documents

| Document | ID | Link |
|----------|-----|------|
| Product Vision & Strategy | FT-PD-000 | [Volume 0](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) |
| Introduction | FT-PD-011 | [Chapter 1](./01_Product_Foundation/Chapter_01_Introduction.md) |
| FT ERP Constitution | FT-PD-012 | [Chapter 2](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) |
| Glossary & Standard Terminology | FT-PD-013 | [Chapter 3](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) |
| Product Design Principles | FT-PD-014 | [Chapter 4](./01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md) |

### Architecture volumes (entry chapters)

| Volume | Entry chapter | ID |
|--------|---------------|-----|
| Business Architecture | [Business Models & Document Inheritance](./02_Business_Architecture/Chapter_01_Business_Models_and_Document_Inheritance.md) | FT-PD-020 |
| Domain Specifications | [Commercial Domain Specification](./03_Domain_Specifications/Chapter_01_Commercial_Domain_Specification.md) | FT-PD-030 |
| Workflow Engine | [Workflow Engine Overview & Pending Actions Contract](./04_Workflow_Engine/Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md) | FT-PD-040 |
| Data Architecture | [Workflow Event Store & Correlation Persistence](./05_Data_Architecture/Chapter_01_Workflow_Event_Store_and_Correlation_Persistence.md) | FT-PD-050 |
| UI Architecture | [UI Architecture, Navigation & Experience Principles](./06_UI_and_Experience_Architecture/Chapter_01_UI_Architecture_Navigation_and_Experience_Principles.md) | FT-PD-060 |
| Security | [Security, Authorization & Governance Architecture](./07_Security_and_Governance_Architecture/Chapter_01_Security_Authorization_and_Governance_Architecture.md) | FT-PD-070 |
| Testing | [Product Testing, Validation & Compliance Framework](./08_Product_Testing_and_Validation/Chapter_01_Product_Testing_Validation_and_Compliance_Framework.md) | FT-PD-080 |
| Deployment | [Deployment & Release Architecture](./09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md) | FT-PD-090 |
| Product Lifecycle | [Product Lifecycle, Roadmap & Continuous Evolution](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_01_Product_Lifecycle_Roadmap_and_Continuous_Evolution.md) | FT-PD-100 |

---

## 8. Maintenance Rules

Future contributors extending the Product Documentation must follow these principles. Full governance detail: [Volume 10, Ch. 4 — Documentation Governance](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md) (FT-PD-103).

| Principle | Requirement |
|-----------|-------------|
| **Constitution-first** | No document may contradict the [FT ERP Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md). Resolve tension through formal versioning, not silent override. |
| **Single Source of Truth** | Product Documentation is authoritative for product architecture. Training, customer, and implementation materials **derive from** — never override — the corpus. |
| **Cross-reference before duplication** | Link to existing chapters, Guard Registry entries, and Glossary terms. Do not restate authoritative definitions. |
| **Preserve IDs** | Assign new `FT-PD-xxx` IDs from the correct volume range. Never reuse or renumber published IDs. |
| **Maintain traceability** | New Business Rules, Guards, and domain behaviors must link upstream (Constitution / Volume 2–3) and downstream (Volume 4–8 as applicable). |
| **Document before implementation** | Material behavior changes require documentation update (or Architecture Review amendment) before code ships. |
| **Backward compatibility for references** | When renaming or restructuring, leave redirect notes and update cross-links. Archive superseded content — do not delete silently. |
| **Terminology** | Use official terms from the [Glossary](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md). |
| **Approval discipline** | Documents remain **Draft — Architecture Review** until the Approval Block is signed and status is formally advanced. |
| **Update this guide** | When adding Volume 11+ or new index documents, update §3 and §7 of FT-PD-999 in the same change set. |

---

## 9. Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial Architecture Map & Navigation Guide — P15-08 baseline |

---

## 10. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture Board Chair | | | |
| Documentation Steward | | | |

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [Product Documentation Index](./README.md) |
| **Next** | [Product Vision & Strategy](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md) (FT-PD-000) |
| **Volume** | [Product Documentation Index](./README.md) |
| **Product** | [Product Documentation Index](./README.md) |
