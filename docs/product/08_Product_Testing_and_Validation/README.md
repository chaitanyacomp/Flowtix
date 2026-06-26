# Volume 8 — Product Testing & Validation

**Verification and certification architecture** for FT ERP — how the complete product architecture (Volumes 0–7) is validated, regressed, certified, and governed across releases.

**Parent:** [Product Documentation Index](../README.md)  
**Previous volume:** [Volume 7 — Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)  
**Next volume:** [Volume 9 — Deployment & Operations Architecture](../09_Deployment_and_Operations_Architecture/README.md)  
**Foundation:** [Volume 1 — Product Foundation](../01_Product_Foundation/README.md)  
**Governance:** [Volume 7 — Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)  
**Architecture:** [Volumes 2–6](../README.md#volume-index)

---

## Purpose

Volume 8 defines **how FT ERP is verified and certified** at the product architecture level.

Volumes 0–7 define **what the product is** and **how it behaves**. Volume 8 defines **how conformance is proven**, **what must not regress**, **what scenarios must pass**, **how releases are certified**, and **how evidence is retained** — without redefining Business Rules.

This volume is **technology-neutral**. It specifies validation and certification governance — not test scripts, CI/CD pipelines, or document management implementation.

Volume 9+ addresses deployment, operations, and environment mechanics.

---

## Chapters

| Ch. | Document ID | Title | Version | Status |
|-----|-------------|-------|---------|--------|
| 1 | [FT-PD-080](./Chapter_01_Product_Testing_Validation_and_Compliance_Framework.md) | [Product Testing, Validation & Compliance Framework](./Chapter_01_Product_Testing_Validation_and_Compliance_Framework.md) | 1.0.0 | **Draft — Architecture Review** |
| 2 | [FT-PD-081](./Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md) | [Workflow Regression Guardrails & Protected Behavior Catalog](./Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md) | 1.0.0 | **Draft — Architecture Review** |
| 3 | [FT-PD-082](./Chapter_03_Canonical_Test_Data_Factory_Simulation_and_Acceptance_Scenarios.md) | [Canonical Test Data, Factory Simulation & Acceptance Scenarios](./Chapter_03_Canonical_Test_Data_Factory_Simulation_and_Acceptance_Scenarios.md) | 1.0.0 | **Draft — Architecture Review** |
| 4 | [FT-PD-083](./Chapter_04_User_Acceptance_Certification_and_Release_Readiness.md) | [User Acceptance, Certification & Release Readiness](./Chapter_04_User_Acceptance_Certification_and_Release_Readiness.md) | 1.0.0 | **Draft — Architecture Review** |
| 5 | [FT-PD-084](./Chapter_05_Validation_Evidence_Audit_Trails_and_Continuous_Compliance.md) | [Validation Evidence, Audit Trails & Continuous Compliance](./Chapter_05_Validation_Evidence_Audit_Trails_and_Continuous_Compliance.md) | 1.0.0 | **Draft — Architecture Review** |

**Volume 8 core set — Ch. 1–5 Draft — Complete.**

---

## Reading order

1. [Chapter 1 — Product Testing, Validation & Compliance Framework](./Chapter_01_Product_Testing_Validation_and_Compliance_Framework.md) *(start here — after Volume 7)*
2. [Chapter 2 — Workflow Regression Guardrails & Protected Behavior Catalog](./Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md)
3. [Chapter 3 — Canonical Test Data, Factory Simulation & Acceptance Scenarios](./Chapter_03_Canonical_Test_Data_Factory_Simulation_and_Acceptance_Scenarios.md)
4. [Chapter 4 — User Acceptance, Certification & Release Readiness](./Chapter_04_User_Acceptance_Certification_and_Release_Readiness.md)
5. [Chapter 5 — Validation Evidence, Audit Trails & Continuous Compliance](./Chapter_05_Validation_Evidence_Audit_Trails_and_Continuous_Compliance.md)

---

## Authority

This volume **verifies** Volumes 0–7. It does **not** override workflow semantics (Volume 4), domain behavior (Volume 3), data immutability (Volume 5), or governance rules (Volume 7).

A validation failure indicates **implementation or documentation drift** — resolution is conformance fix or formal architecture amendment.

---

## Core principle

**Validation proves architecture. It never redefines it.**

- **Verification** — implementation matches specification.
- **Validation** — product meets intended business and architecture goals.
- **Regression** — protected behaviors remain enforced after change.
- **Acceptance** — evidence-based sign-off for pilot and go-live.
- **Certification** — formal attestation that release criteria are met.
- **Evidence retention** — certified releases remain explainable for the product lifecycle.

---

## Cross-volume validation references

| Volume | Primary validation focus | Volume 8 chapter |
|--------|-------------------------|------------------|
| **0 — Vision** | Strategic scope alignment | Ch. 1 §13A |
| **1 — Constitution** | Articles 1–23 non-negotiable laws | Ch. 2 §12D; Ch. 5 §12B |
| **2 — Business** | REGULAR/NO_QTY pipelines, ownership | Ch. 3 §7–8 |
| **3 — Domains** | Per-document behavior | Ch. 3 §7, §13A |
| **4 — Workflow** | WFE-*, GRD-*, orchestration | Ch. 2 §7; Ch. 3 journeys |
| **5 — Data** | WES-*, ledger, snapshots | Ch. 2 §8; Ch. 5 evidence |
| **6 — UI** | Dashboard / Workspace / Control Tower | Ch. 2 §9; Ch. 3 UAT packs |
| **7 — Governance** | SEC, GOV, CFG, INT, IDN rules | Ch. 1 §11; Ch. 4 gates; Ch. 5 §4 |

### Rule prefix index (Volume 8)

| Prefix | Chapter | Domain |
|--------|---------|--------|
| **VAL-** | FT-PD-080 | Validation framework rules |
| **PBL-** | FT-PD-081 | Protected behavior / regression rules |
| **CAN-** | FT-PD-082 | Canonical scenario rules |
| **REL-** | FT-PD-083 | Release / certification rules |
| **EVD-** | FT-PD-084 | Evidence / compliance retention rules |

---

## Relationship with Volume 7 audit

| Layer | Volume | Purpose |
|-------|--------|---------|
| **Operational audit** | Vol. 7 Ch. 3 | Live ERP actions — append-only |
| **Validation evidence** | Vol. 8 Ch. 1–3 | Conformance proof during test |
| **Certification records** | Vol. 8 Ch. 4–5 | Release attestation and retention |

Operational audit and validation evidence are **linked by reference** — not merged ([EVD-07](./Chapter_05_Validation_Evidence_Audit_Trails_and_Continuous_Compliance.md)).

---

## Prerequisites

Read **Volume 7** (Security & Governance) before Volume 8. Validation of SEC-, GOV-, CFG-, and INT- rules is mandatory for production readiness and certification.

---

## Volume navigation

| | Link |
|--|------|
| **Previous volume** | [Volume 7 — Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md) |
| **Next volume** | [Volume 9 — Deployment & Operations Architecture](../09_Deployment_and_Operations_Architecture/README.md) |
| **Product index** | [Product Documentation Index](../README.md) |

---

## Status

**Draft — Architecture Review** — Ch. 1–5 at v1.0.0 (baseline corpus; not Approved).
