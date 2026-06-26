# Volume 6 — UI & Experience Architecture

User interface architecture, navigation, and experience principles for FT ERP — how operators, planners, and managers interact with the Workflow Engine and Read Models.

**Parent:** [Product Documentation Index](../README.md)  
**Previous volume:** [Volume 5 — Data Architecture](../05_Data_Architecture/README.md)  
**Next volume:** [Volume 7 — Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)  
**Foundation:** [Volume 1 — Product Foundation](../01_Product_Foundation/README.md)  
**Domains:** [Volume 3 — Domain Specifications](../03_Domain_Specifications/README.md)  
**Workflow:** [Volume 4 — Workflow Engine](../04_Workflow_Engine/README.md)  
**Data:** [Volume 5 — Data Architecture](../05_Data_Architecture/README.md)

---

## Purpose

Volume 6 defines **how users interact** with FT ERP.

Volumes 0–5 define **what the product is** and **what is persisted**. Volume 6 defines **how surfaces expose** that architecture — Dashboard, Workspace, Control Tower, navigation, registers, masters, and reports — without duplicating business logic.

Volume 7 ([Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)) overlays authorization, audit, and configuration on these UX contracts without redefining surface responsibilities.

---

## Architectural principle

| Surface | Tagline | Primary question |
|---------|---------|------------------|
| **Dashboard** | **My Work** | What must I do today? |
| **Workspace** | **Do Work** | How do I complete this step? |
| **Control Tower** | **Monitor Factory** | What is blocked across the factory? |

These three concepts **must never overlap** ([Design Principles §5.5](../01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md)).

---

## Chapters

| Ch. | Document ID | Title | Version | Status |
|-----|-------------|-------|---------|--------|
| 1 | [FT-PD-060](./Chapter_01_UI_Architecture_Navigation_and_Experience_Principles.md) | [UI Architecture, Navigation & Experience Principles](./Chapter_01_UI_Architecture_Navigation_and_Experience_Principles.md) | 1.0.0 | **Draft — Architecture Review** |
| 2 | [FT-PD-061](./Chapter_02_Dashboard_Architecture_and_Widget_Standards.md) | [Dashboard Architecture & Widget Standards](./Chapter_02_Dashboard_Architecture_and_Widget_Standards.md) | 1.0.0 | **Draft — Architecture Review** |
| 3 | [FT-PD-062](./Chapter_03_Control_Tower_Architecture_and_Factory_Monitoring.md) | [Control Tower Architecture & Factory Monitoring](./Chapter_03_Control_Tower_Architecture_and_Factory_Monitoring.md) | 1.0.0 | **Draft — Architecture Review** |
| 4 | [FT-PD-063](./Chapter_04_Workspace_Architecture_and_Document_Execution_Surfaces.md) | [Workspace Architecture & Document Execution Surfaces](./Chapter_04_Workspace_Architecture_and_Document_Execution_Surfaces.md) | 1.0.0 | **Draft — Architecture Review** |
| 5 | [FT-PD-064](./Chapter_05_Registers_Masters_and_Browse_Surfaces.md) | [Registers, Masters & Browse Surfaces](./Chapter_05_Registers_Masters_and_Browse_Surfaces.md) | 1.0.0 | **Draft — Architecture Review** |
| 6 | [FT-PD-065](./Chapter_06_Reports_and_Analytical_Surfaces.md) | [Reports & Analytical Surfaces](./Chapter_06_Reports_and_Analytical_Surfaces.md) | 1.0.0 | **Draft — Architecture Review** |

*Volume 6 core surface architecture complete (6 chapters). Extensions may follow (notifications, accessibility).*

---

## Reading order

1. [Chapter 1 — UI Architecture, Navigation & Experience Principles](./Chapter_01_UI_Architecture_Navigation_and_Experience_Principles.md) *(start here)*
2. [Chapter 2 — Dashboard Architecture & Widget Standards](./Chapter_02_Dashboard_Architecture_and_Widget_Standards.md)
3. [Chapter 3 — Control Tower Architecture & Factory Monitoring](./Chapter_03_Control_Tower_Architecture_and_Factory_Monitoring.md)
4. [Chapter 4 — Workspace Architecture & Document Execution Surfaces](./Chapter_04_Workspace_Architecture_and_Document_Execution_Surfaces.md)
5. [Chapter 5 — Registers, Masters & Browse Surfaces](./Chapter_05_Registers_Masters_and_Browse_Surfaces.md)
6. [Chapter 6 — Reports & Analytical Surfaces](./Chapter_06_Reports_and_Analytical_Surfaces.md)

---

## Authority

This volume **implements** UX contracts from Volume 4 Ch. 1 and Design Principles. It does not override domain behavior (Volume 3), engine rules (Volume 4), or read-model authority (Volume 5 Ch. 6). Screen-level field specs belong in subsequent Volume 6 chapters.

---

## Volume navigation

| | Link |
|--|------|
| **Previous volume** | [Volume 5 — Data Architecture](../05_Data_Architecture/README.md) |
| **Next volume** | [Volume 7 — Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md) |
| **Product index** | [Product Documentation Index](../README.md) |

---

## Status

**Draft — Architecture Review** — Ch. 1–6 at v1.0.0 (baseline corpus; not Approved).
