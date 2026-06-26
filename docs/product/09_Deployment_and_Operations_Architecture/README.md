# Volume 9 — Deployment & Operations Architecture

How **certified FT ERP releases** are packaged, deployed, upgraded, operated, and maintained throughout the operational lifecycle — from first install through long-term stewardship.

**Parent:** [Product Documentation Index](../README.md)  
**Previous volume:** [Volume 8 — Product Testing & Validation](../08_Product_Testing_and_Validation/README.md)  
**Next volume:** [Volume 10 — Product Lifecycle & Continuous Evolution](../10_Product_Lifecycle_and_Continuous_Evolution/README.md)  
**Foundation:** [Volume 1 — Product Foundation](../01_Product_Foundation/README.md)  
**Validation:** [Volume 8 — Product Testing & Validation](../08_Product_Testing_and_Validation/README.md)  
**Governance:** [Volume 7 — Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)

---

## Purpose

Volume 9 defines **how FT ERP operates in customer environments** after product architecture (Volumes 0–7) is defined and validated (Volume 8).

Volume 8 certifies **what may be released**. Volume 9 defines **how certified releases are deployed, upgraded, run, recovered, and sustained** — predictably, traceably, and recoverably.

This volume is **technology-neutral**. It specifies deployment and operations **architecture**, not infrastructure scripts, cloud templates, or CI/CD implementation.

Volume 10+ addresses product roadmap evolution and manufacturing domain knowledge.

---

## Chapters

| Ch. | Document ID | Title | Version | Status |
|-----|-------------|-------|---------|--------|
| 1 | [FT-PD-090](./Chapter_01_Deployment_and_Release_Architecture.md) | [Deployment & Release Architecture](./Chapter_01_Deployment_and_Release_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 2 | [FT-PD-091](./Chapter_02_Installation_Upgrade_and_Migration_Architecture.md) | [Installation, Upgrade & Migration Architecture](./Chapter_02_Installation_Upgrade_and_Migration_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 3 | [FT-PD-092](./Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md) | [Operational Monitoring, Support & Maintenance Architecture](./Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 4 | [FT-PD-093](./Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md) | [Backup, Recovery, Business Continuity & Disaster Recovery Architecture](./Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 5 | [FT-PD-094](./Chapter_05_Operational_Governance_Capacity_Planning_and_Lifecycle_Management.md) | [Operational Governance, Capacity Planning & Lifecycle Management](./Chapter_05_Operational_Governance_Capacity_Planning_and_Lifecycle_Management.md) | 1.0.0 | **Draft — Architecture Review** |

**Volume 9 core set — Ch. 1–5 Draft — Complete.**

---

## Reading order

1. [Chapter 1 — Deployment & Release Architecture](./Chapter_01_Deployment_and_Release_Architecture.md) *(start here — after Volume 8)*
2. [Chapter 2 — Installation, Upgrade & Migration Architecture](./Chapter_02_Installation_Upgrade_and_Migration_Architecture.md)
3. [Chapter 3 — Operational Monitoring, Support & Maintenance Architecture](./Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md)
4. [Chapter 4 — Backup, Recovery, Business Continuity & Disaster Recovery Architecture](./Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)
5. [Chapter 5 — Operational Governance, Capacity Planning & Lifecycle Management](./Chapter_05_Operational_Governance_Capacity_Planning_and_Lifecycle_Management.md)

---

## Authority

This volume **implements operational placement and stewardship** of certified product. It does **not** override:

- Workflow semantics (Volume 4)
- Data immutability (Volume 5)
- Security and governance (Volume 7)
- Certification requirements (Volume 8)

---

## Core principles

**Deployment consumes certification. It never replaces it.**

**Operational growth preserves architecture.** Capacity and maturity increase; PBL and Constitution constraints do not weaken.

---

## Volume 9 lifecycle arc

| Chapter | Focus | Rule prefix |
|---------|-------|-------------|
| **1** | Certified deploy, environments, release gates | **DEP-** |
| **2** | Install, migrate, cutover | **INS-** |
| **3** | Monitor, support, incidents, maintenance | **OPS-** |
| **4** | Backup, BCP, DR, resilience | **RES-** |
| **5** | Capacity, lifecycle, continuous improvement | **LCM-** |

---

## Relationship with Volume 8

| Volume 8 | Volume 9 |
|----------|----------|
| REL-* certification gates | DEP-* deployment rules |
| EVD-* evidence retention | Deployment + lifecycle records |
| Go-live authorization | Cutover + long-term stewardship |
| Canonical scenarios | Post-upgrade and maturity validation |
| PBL protected behaviors | Preserved through LCM-01 |

---

## Prerequisites

Complete **Volume 8** (Ch. 1–5) before Volume 9. Production deployment requires valid certification for the target build.

---

## Volume navigation

| | Link |
|--|------|
| **Previous volume** | [Volume 8 — Product Testing & Validation](../08_Product_Testing_and_Validation/README.md) |
| **Next volume** | [Volume 10 — Product Lifecycle & Continuous Evolution](../10_Product_Lifecycle_and_Continuous_Evolution/README.md) |
| **Product index** | [Product Documentation Index](../README.md) |

---

## Status

**Draft — Architecture Review** — Ch. 1–5 at v1.0.0 (baseline corpus; not Approved).
