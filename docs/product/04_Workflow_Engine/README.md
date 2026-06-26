# Volume 4 — Workflow Engine

Workflow State Machines, transition guards, Pending Actions generation, and the implementation contract between domain specifications and runtime behavior.

**Parent:** [Product Documentation Index](../README.md)  
**Previous volume:** [Volume 3 — Domain Specifications](../03_Domain_Specifications/README.md)  
**Next volume:** [Volume 5 — Data Architecture](../05_Data_Architecture/README.md)  
**Foundation:** [Volume 1 — Product Foundation](../01_Product_Foundation/README.md)  
**Architecture:** [Volume 2 — Business Architecture](../02_Business_Architecture/README.md)  
**Domains:** [Volume 3 — Domain Specifications](../03_Domain_Specifications/README.md)

---

## Purpose

Volume 4 defines **how** FT ERP workflow runs: the Workflow Engine as single source of truth, Guard catalog, per-document State Machines, cross-domain orchestration, and Pending Actions contract.

Volume 3 specifies **what** each domain document must do. Volume 4 specifies **how the engine enforces it**.

Volume 6 ([UI & Experience Architecture](../06_UI_and_Experience_Architecture/README.md)) implements surfaces; Volume 7 ([Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)) overlays access, audit, configuration, and integration trust boundaries against this volume.

---

## Chapters

| Ch. | Document ID | Title | Version | Status |
|-----|-------------|-------|---------|--------|
| 1 | [FT-PD-040](./Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md) | [Workflow Engine Overview & Pending Actions Contract](./Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md) | 1.0.0 | **Draft — Architecture Review** |
| 2 | [FT-PD-041](./Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md) | [Transition Guards & Cross-Domain Dependency Catalog](./Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md) | 1.0.0 | **Draft — Architecture Review** |
| 3 | [FT-PD-042](./Chapter_03_Commercial_Workflow_State_Machine.md) | [Commercial Workflow State Machine](./Chapter_03_Commercial_Workflow_State_Machine.md) | 1.0.0 | **Draft — Architecture Review** |
| 4 | [FT-PD-043](./Chapter_04_Planning_Workflow_State_Machine.md) | [Planning Workflow State Machine](./Chapter_04_Planning_Workflow_State_Machine.md) | 1.0.0 | **Draft — Architecture Review** |
| 5 | [FT-PD-044](./Chapter_05_Procurement_Workflow_State_Machine.md) | [Procurement Workflow State Machine](./Chapter_05_Procurement_Workflow_State_Machine.md) | 1.0.0 | **Draft — Architecture Review** |
| 6 | [FT-PD-045](./Chapter_06_Manufacturing_Workflow_State_Machine.md) | [Manufacturing Workflow State Machine](./Chapter_06_Manufacturing_Workflow_State_Machine.md) | 1.0.0 | **Draft — Architecture Review** |
| 7 | [FT-PD-046](./Chapter_07_Quality_Assurance_Workflow_State_Machine.md) | [Quality Assurance Workflow State Machine](./Chapter_07_Quality_Assurance_Workflow_State_Machine.md) | 1.0.0 | **Draft — Architecture Review** |
| 8 | [FT-PD-047](./Chapter_08_Dispatch_and_Billing_Workflow_State_Machine.md) | [Dispatch & Billing Workflow State Machine](./Chapter_08_Dispatch_and_Billing_Workflow_State_Machine.md) | 1.0.0 | **Draft — Architecture Review** |
| 9 | [FT-PD-048](./Chapter_09_Cross_Domain_Workflow_Orchestration_and_Event_Coordination.md) | [Cross-Domain Workflow Orchestration & Event Coordination](./Chapter_09_Cross_Domain_Workflow_Orchestration_and_Event_Coordination.md) | 1.0.0 | **Draft — Architecture Review** |

*Volume 4 is complete at nine chapters. Future workflow supplements (e.g. reversal workflows, Control Tower KPI catalog) may extend as annexes.*

---

## Reading order

1. [Chapter 1 — Workflow Engine Overview & Pending Actions Contract](./Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md) *(start here)*
2. Chapter 2 — Guard catalog (cross-domain)
3. Chapters 3–8 — per-domain State Machines (align with Volume 3 chapters)
4. [Chapter 9 — Cross-Domain Workflow Orchestration & Event Coordination](./Chapter_09_Cross_Domain_Workflow_Orchestration_and_Event_Coordination.md) *(integration layer)*

---

## Authority

This volume **implements** Volume 3 domain specifications and must comply with the Constitution (especially Articles 11–14). It does not override Volume 1–3. Where code conflicts with this volume, this volume prevails until formally amended.

---

## Volume navigation

| | Link |
|--|------|
| **Previous volume** | [Volume 3 — Domain Specifications](../03_Domain_Specifications/README.md) |
| **Next volume** | [Volume 5 — Data Architecture](../05_Data_Architecture/README.md) |
| **Product index** | [Product Documentation Index](../README.md) |

---

## Status

**Draft — Architecture Review** — Ch. 1–9 at v1.0.0 (baseline corpus; not Approved).
