# Volume 7 — Security & Governance Architecture

Cross-cutting **security, authorization, audit, and governance** architecture for FT ERP — overlays every domain, workflow, and UI surface without changing business semantics.

**Parent:** [Product Documentation Index](../README.md)  
**Previous volume:** [Volume 6 — UI & Experience Architecture](../06_UI_and_Experience_Architecture/README.md)  
**Next volume:** [Volume 8 — Product Testing & Validation](../08_Product_Testing_and_Validation/README.md)  
**Foundation:** [Volume 1 — Product Foundation](../01_Product_Foundation/README.md)  
**Domains:** [Volume 3 — Domain Specifications](../03_Domain_Specifications/README.md)  
**Workflow:** [Volume 4 — Workflow Engine](../04_Workflow_Engine/README.md)  
**Data:** [Volume 5 — Data Architecture](../05_Data_Architecture/README.md)  
**Experience:** [Volume 6 — UI & Experience Architecture](../06_UI_and_Experience_Architecture/README.md)

---

## Purpose

Volume 7 defines **how FT ERP is secured and governed** at the product architecture level.

Volumes 0–6 define **what the product does** and **how users interact**. Volume 7 defines **who may do what**, **under which constraints**, and **how actions are audited** — consistently across Commercial, Planning, Procurement, Manufacturing, QA, Dispatch, Billing, and Inventory.

This volume is **technology-neutral**. It extends product architecture without prescribing JWT, OAuth, encryption algorithms, or database schema.

Volume 8+ may address platform implementation, deployment, and integration detail where distinct from this governance layer.

---

## Chapters

| Ch. | Document ID | Title | Version | Status |
|-----|-------------|-------|---------|--------|
| 1 | [FT-PD-070](./Chapter_01_Security_Authorization_and_Governance_Architecture.md) | [Security, Authorization & Governance Architecture](./Chapter_01_Security_Authorization_and_Governance_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 2 | [FT-PD-071](./Chapter_02_Identity_User_Organization_and_Delegation_Architecture.md) | [Identity, User, Organization & Delegation Architecture](./Chapter_02_Identity_User_Organization_and_Delegation_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 3 | [FT-PD-072](./Chapter_03_Audit_Compliance_and_Data_Retention_Governance.md) | [Audit, Compliance & Data Retention Governance](./Chapter_03_Audit_Compliance_and_Data_Retention_Governance.md) | 1.0.0 | **Draft — Architecture Review** |
| 4 | [FT-PD-073](./Chapter_04_Configuration_Business_Policies_and_Feature_Flag_Architecture.md) | [Configuration, Business Policies & Feature Flag Architecture](./Chapter_04_Configuration_Business_Policies_and_Feature_Flag_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 5 | [FT-PD-074](./Chapter_05_Platform_Integration_and_External_Trust_Boundaries.md) | [Platform Integration & External Trust Boundaries](./Chapter_05_Platform_Integration_and_External_Trust_Boundaries.md) | 1.0.0 | **Draft — Architecture Review** |

*Volume 7 core governance set — Ch. 1–5 Draft — Complete.*

---

## Reading order

1. [Chapter 1 — Security, Authorization & Governance Architecture](./Chapter_01_Security_Authorization_and_Governance_Architecture.md) *(start here)*
2. [Chapter 2 — Identity, User, Organization & Delegation Architecture](./Chapter_02_Identity_User_Organization_and_Delegation_Architecture.md)
3. [Chapter 3 — Audit, Compliance & Data Retention Governance](./Chapter_03_Audit_Compliance_and_Data_Retention_Governance.md)
4. [Chapter 4 — Configuration, Business Policies & Feature Flag Architecture](./Chapter_04_Configuration_Business_Policies_and_Feature_Flag_Architecture.md)
5. [Chapter 5 — Platform Integration & External Trust Boundaries](./Chapter_05_Platform_Integration_and_External_Trust_Boundaries.md)

---

## Authority

This volume **overlays** Volumes 2–6. It does **not** override workflow semantics (Volume 4), domain behavior (Volume 3), or data immutability rules (Volume 5). Security **constrains access**; the Workflow Engine **constrains valid transitions**.

---

## Core principle

**Security overlays the product architecture. It never changes workflow semantics.**

- **Authentication** establishes identity.
- **Authorization** grants capability.
- **Workflow ownership** determines **business accountability** for the next valid action ([Volume 2, Ch. 5](../02_Business_Architecture/Chapter_05_Document_Ownership_and_Responsibility_Matrix.md)).
- **Audit** records what occurred — append-only, immutable.

---

## Volume navigation

| | Link |
|--|------|
| **Previous volume** | [Volume 6 — UI & Experience Architecture](../06_UI_and_Experience_Architecture/README.md) |
| **Next volume** | [Volume 8 — Product Testing & Validation](../08_Product_Testing_and_Validation/README.md) |
| **Product index** | [Product Documentation Index](../README.md) |

---

## Status

**Draft — Architecture Review** — Ch. 1–5 at v1.0.0 (baseline corpus; not Approved).
