# Volume 5 — Data Architecture

Logical and canonical data models for FT ERP: workflow persistence, master data, transactional documents, snapshots, inventory ledger, and Read Models—technology-neutral product architecture.

**Parent:** [Product Documentation Index](../README.md)  
**Previous volume:** [Volume 4 — Workflow Engine](../04_Workflow_Engine/README.md)  
**Next volume:** [Volume 6 — UI & Experience Architecture](../06_UI_and_Experience_Architecture/README.md)  
**Foundation:** [Volume 1 — Product Foundation](../01_Product_Foundation/README.md)  
**Architecture:** [Volume 2 — Business Architecture](../02_Business_Architecture/README.md)  
**Domains:** [Volume 3 — Domain Specifications](../03_Domain_Specifications/README.md)  
**Workflow:** [Volume 4 — Workflow Engine](../04_Workflow_Engine/README.md)

---

## Purpose

Volume 5 defines **what is persisted** and **how data relates** across the FT ERP product.

Volume 4 specifies **runtime workflow behavior** (transitions, events, correlation, Pending Actions). Volume 5 specifies **logical persistence** of those contracts—without binding to a specific database, ORM, or storage technology.

Volume 7 ([Security & Governance Architecture](../07_Security_and_Governance_Architecture/README.md)) overlays governance on persisted data without redefining workflow or domain semantics.

---

## Chapters

| Ch. | Document ID | Title | Version | Status |
|-----|-------------|-------|---------|--------|
| 1 | [FT-PD-050](./Chapter_01_Workflow_Event_Store_and_Correlation_Persistence.md) | [Workflow Event Store & Correlation Persistence](./Chapter_01_Workflow_Event_Store_and_Correlation_Persistence.md) | 1.0.0 | **Draft — Architecture Review** |
| 2 | [FT-PD-051](./Chapter_02_Transactional_Document_Model.md) | [Transactional Document Model](./Chapter_02_Transactional_Document_Model.md) | 1.0.0 | **Draft — Architecture Review** |
| 3 | [FT-PD-052](./Chapter_03_Master_Data_and_Reference_Architecture.md) | [Master Data & Reference Architecture](./Chapter_03_Master_Data_and_Reference_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 4 | [FT-PD-053](./Chapter_04_Planning_and_Procurement_Snapshot_Architecture.md) | [Planning & Procurement Snapshot Architecture](./Chapter_04_Planning_and_Procurement_Snapshot_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 5 | [FT-PD-054](./Chapter_05_Inventory_Ledger_and_Stock_Persistence_Architecture.md) | [Inventory Ledger & Stock Persistence Architecture](./Chapter_05_Inventory_Ledger_and_Stock_Persistence_Architecture.md) | 1.0.0 | **Draft — Architecture Review** |
| 6 | [FT-PD-055](./Chapter_06_Read_Models_Reporting_and_Analytical_Persistence.md) | [Read Models, Reporting & Analytical Persistence](./Chapter_06_Read_Models_Reporting_and_Analytical_Persistence.md) | 1.0.0 | **Draft — Architecture Review** |

*Chapter numbering may extend (e.g. Commercial & Billing Snapshots, cross-cutting topics).*

---

## Reading order

1. [Chapter 1 — Workflow Event Store & Correlation Persistence](./Chapter_01_Workflow_Event_Store_and_Correlation_Persistence.md) *(start here — implements Volume 4)*
2. [Chapter 2 — Transactional Document Model](./Chapter_02_Transactional_Document_Model.md)
3. [Chapter 3 — Master Data & Reference Architecture](./Chapter_03_Master_Data_and_Reference_Architecture.md)
4. [Chapter 4 — Planning & Procurement Snapshot Architecture](./Chapter_04_Planning_and_Procurement_Snapshot_Architecture.md)
5. [Chapter 5 — Inventory Ledger & Stock Persistence Architecture](./Chapter_05_Inventory_Ledger_and_Stock_Persistence_Architecture.md)
6. [Chapter 6 — Read Models, Reporting & Analytical Persistence](./Chapter_06_Read_Models_Reporting_and_Analytical_Persistence.md)

---

## Authority

This volume **persists** contracts from Volumes 2–4. It does not override domain behavior (Volume 3) or engine rules (Volume 4). Logical models here are authoritative for **data shape and immutability**; physical storage is Volume 7.

---

## Volume navigation

| | Link |
|--|------|
| **Previous volume** | [Volume 4 — Workflow Engine](../04_Workflow_Engine/README.md) |
| **Next volume** | [Volume 6 — UI & Experience Architecture](../06_UI_and_Experience_Architecture/README.md) |
| **Product index** | [Product Documentation Index](../README.md) |

---

## Status

**Draft — Architecture Review** — Ch. 1–6 at v1.0.0 (baseline corpus; not Approved).
