# FT ERP Product Documentation — Release Notes v1.0.0

| Field | Value |
|-------|-------|
| **Release** | Product Documentation Baseline v1.0.0 |
| **Release date** | 2026-05-29 |
| **Status** | Baseline frozen — Draft — Architecture Review corpus |
| **Owner** | FT ERP Product Architecture |

**Related:** [Baseline Manifest](./BASELINE_MANIFEST_v1.0.0.md) · [Baseline Freeze](./BASELINE_FREEZE.md) · [Change Policy](./CHANGE_POLICY.md) · [Product Documentation Index](../README.md)

---

## Purpose

This release establishes the **official Version 1.0 baseline** of the FT ERP Product Documentation — the permanent, versioned blueprint for product vision, business architecture, domain behavior, workflows, data design, UX, security, validation, deployment, and lifecycle governance.

Version 1.0.0 is a **documentation baseline**, not a software release. It freezes the architectural corpus produced across Volumes 0–10 for implementation alignment, partner onboarding, validation, and long-term product stewardship.

---

## Scope

### In scope

- Volumes **0–10** (58 chapter/volume documents)
- Master index **[Architecture Map & Navigation Guide](../Architecture_Map_and_Navigation_Guide.md)** (FT-PD-999)
- Product **[Documentation Index](../README.md)** and **11 Volume READMEs**
- Constitutional foundation (FT-PD-012), Glossary (FT-PD-013), Design Principles (FT-PD-014)
- Complete Workflow Engine contract set (FT-PD-040 – 048) including Guard Registry
- Release governance artifacts (this package)

### Out of scope

- **Volume 11** — Manufacturing Knowledge Reference Architecture (planned)
- Implementation code, database schema, API specifications
- Customer-specific configuration or training materials
- Formal **Approved** sign-off (corpus remains **Draft — Architecture Review** pending governance board approval)

---

## Highlights

| Area | v1.0.0 deliverable |
|------|-------------------|
| **Strategic foundation** | Volume 0 vision; Volume 1 Constitution (23 Articles), Glossary, Design Principles |
| **Business architecture** | REGULAR and NO_QTY pipelines, execution pipeline, ownership matrix, commercial chain |
| **Domain specifications** | Six domains — commercial, planning, procurement, manufacturing, QA, dispatch & billing |
| **Workflow Engine** | Engine contract, **87 Guards** (`GRD_*`), six domain State Machines, cross-domain orchestration |
| **Data architecture** | Event store, transactional documents, master data, snapshots, inventory ledger, Read Models |
| **UX architecture** | Dashboard, Workspace, Control Tower, registers, reports |
| **Security & governance** | Authorization, identity, audit, configuration, integration trust boundaries |
| **Validation** | Framework, regression guardrails, canonical scenarios, certification, evidence governance |
| **Operations** | Deployment, migration, monitoring, resilience, operational governance |
| **Lifecycle** | Evolution roadmap, change control, quality strategy, documentation governance, stewardship |
| **Navigation** | FT-PD-999 master map with role-based reading paths and traceability chain |

---

## Volumes included

| Volume | ID range | Chapters |
|--------|----------|----------|
| 0 — Product Vision & Strategy | FT-PD-000 | 1 |
| 1 — Product Foundation | FT-PD-011 – 014 | 4 |
| 2 — Business Architecture | FT-PD-020 – 025 | 6 |
| 3 — Domain Specifications | FT-PD-030 – 035 | 6 |
| 4 — Workflow Engine | FT-PD-040 – 048 | 9 |
| 5 — Data Architecture | FT-PD-050 – 055 | 6 |
| 6 — UI & Experience Architecture | FT-PD-060 – 065 | 6 |
| 7 — Security & Governance | FT-PD-070 – 074 | 5 |
| 8 — Product Testing & Validation | FT-PD-080 – 084 | 5 |
| 9 — Deployment & Operations | FT-PD-090 – 094 | 5 |
| 10 — Product Lifecycle | FT-PD-100 – 104 | 5 |
| **Index** | FT-PD-999 | 1 |

---

## Major architectural decisions (documented)

These decisions are **recorded** in the baseline corpus — not introduced by this release:

1. **Workflow-driven manufacturing ERP** — Pending Actions from the Workflow Engine; screens consume engine output ([Constitution Art. 12](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)).
2. **Dual Business Models** — REGULAR Order and NO_QTY Agreement with immutable inheritance from Enquiry ([FT-PD-020](../02_Business_Architecture/Chapter_01_Business_Models_and_Document_Inheritance.md)).
3. **Single Guard Registry** — Authoritative `GRD_*` definitions in FT-PD-041; domain chapters define guard order only.
4. **Material accountability chain** — Requirement → PMR → Material Issue → consumption ([Constitution Art. 9](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)).
5. **Dashboard / Workspace / Control Tower triad** — Role work, document execution, factory monitoring ([FT-PD-014](../01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md)).
6. **Planning freeze semantics** — Approved monthly plan and RM Snapshot immutability for execution ([FT-PD-053](../05_Data_Architecture/Chapter_04_Planning_and_Procurement_Snapshot_Architecture.md)).
7. **Constitution-first governance** — All volumes implement; none override ([FT-PD-012](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)).

---

## Documentation quality work completed (P15-01 – P15-08)

| Task | Summary |
|------|---------|
| **P15-01** | Initial link and cross-reference audit |
| **P15-02** | Broken internal link and cross-reference cleanup (14 files; zero broken links at completion) |
| **P15-03** | Rule reference correction — 13 fixes; 684 defined rules; zero undefined references |
| **P15-04** | Guard registry cleanup — 87 unique Guards; duplicate partial definition removed |
| **P15-05** | README and metadata normalization — headers, Approval Blocks, navigation footers across 70 files |
| **P15-06** | Terminology normalization — Glossary-aligned naming across 64 files |
| **P15-07** | Approval Block standardization — identical table format across 58 documents |
| **P15-08** | Master Architecture Map & Navigation Guide (FT-PD-999) |
| **P16** | Version 1.0 baseline freeze, release manifest, cross-volume navigation link correction (18 files) |

---

## Known deferred items

| Item | Target | Notes |
|------|--------|-------|
| Formal **Approved** status | Post sign-off | All documents remain **Draft — Architecture Review**; Approval Blocks unsigned |
| **Volume 11** — Manufacturing Knowledge | v1.1+ | BOM depth, weight planning, shop-floor patterns |
| **Optional Module** specifications | v1.1+ | e.g. Subcontract Manufacturing |
| Customer training derivatives | Implementation phase | Must derive from corpus ([KNW-08](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md)) |

---

## Future roadmap (v1.1)

Planned documentation evolution (see [Volume 10, Ch. 1](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_01_Product_Lifecycle_Roadmap_and_Continuous_Evolution.md)):

- **Volume 11** — Manufacturing Knowledge Reference Architecture
- **Approved baseline promotion** — Constitution and core volumes to Approved status after architecture board sign-off
- **Optional Module packs** — licensed extension documentation with defined integration contracts
- **Implementation alignment notes** — non-normative mapping guides (separate from product architecture)
- **Patch releases (v1.0.x)** — editorial corrections, link maintenance, glossary additions without semantic change per [Change Policy](./CHANGE_POLICY.md)

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [Product Documentation Index](../README.md) |
| **Next** | [Baseline Manifest v1.0.0](./BASELINE_MANIFEST_v1.0.0.md) |
| **Product** | [Product Documentation Index](../README.md) |
