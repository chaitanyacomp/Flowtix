# Document Ownership & Responsibility Matrix

| Field | Value |
|-------|-------|
| **Document ID** | FT-PD-024 |
| **Volume** | 2 — Business Architecture |
| **Chapter** | 5 — Document Ownership & Responsibility Matrix |
| **Title** | Document Ownership & Responsibility Matrix |
| **Version** | 1.0.0 |
| **Status** | Draft — Architecture Review |
| **Effective date** | 2026-05-29 |
| **Author** | FT ERP Product Team |
| **Owner** | FT ERP Product Architecture |
| **Audience** | Product, workflow architects, implementation leads, all process owners |
| **Classification** | Product — Business Architecture |

**Parent documents:**

- [Chapter 1 — Business Models & Document Inheritance](./Chapter_01_Business_Models_and_Document_Inheritance.md)
- [Chapter 2 — REGULAR Order Planning Pipeline](./Chapter_02_REGULAR_Order_Planning_Pipeline.md)
- [Chapter 3 — NO_QTY Agreement Planning Pipeline](./Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md)
- [Chapter 4 — Manufacturing Execution Pipeline](./Chapter_04_Manufacturing_Execution_Pipeline.md)
- [Chapter 2 — FT ERP Constitution](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) (Articles 10–14)
- [Chapter 4 — Product Design Principles](../01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md) (§9–10)

---

## 1. Document Control

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial ownership and responsibility matrix for all major documents and stages |

**Supersedes:** None.

**Change authority:** Product Architecture. Ownership changes require Constitution Art. 10 review and Volume 4 Workflow Engine alignment.

**Out of scope for this chapter:** Workflow state tables, permission matrices, screen layouts (Volumes 4 and 6).

---

## 2. Purpose

This chapter defines the **official ownership** of every major business document, workflow stage, approval, and responsibility within FT ERP.

It is the **authoritative reference** for role accountability across the product—how Pending Actions are routed, which role completes the next valid action, and how Dashboard, Workspace, and Control Tower relate to ownership.

Workflow **behavior** is defined in Chapters 2–4; this chapter defines **who is accountable** without redefining pipeline stages.

---

## 3. Scope

### 3.1 In scope

- Ownership philosophy (Constitution Art. 10)
- Document-level ownership tables: commercial, planning, procurement, manufacturing, fulfillment
- Dashboard, Workspace, and Control Tower responsibility mapping
- Consolidated RACI matrix
- Ownership Business Rules

### 3.2 Out of scope

- REGULAR and NO_QTY pipeline stage definitions (Chapters 2–3)
- Execution gate logic (Chapter 4)
- Configurable responsibility implementation (Volume 4; Constitution Art. 20)
- UI components, APIs, database schemas
- Per-field edit permissions

### 3.3 Terminology

Uses [Glossary](../01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md) terms only. **Primary Owner** means accountability for the **next valid workflow action** on that document or stage—not exclusive read access.

### 3.4 Standard roles

| Role | Scope |
|------|-------|
| **Admin** | Commercial, feasibility, quotation, Internal Sales Order, Sales Bill, billing export |
| **Store** | Planning (both models), GRN, Work Order, PMR, Material Issue, Dispatch |
| **Purchase** | Monthly plan review (NO_QTY), PR, PO, supplier follow-up |
| **Production** | Production Entry |
| **QA** | QA Inspection, rework disposition, scrap disposition (quality gate) |
| **System** | Read Models, computed availability, engine routing (no human Pending Action) |

---

## 4. Ownership Philosophy

### 4.1 One primary owner per workflow document

Every **ERP-controlled document** and every **workflow stage awaiting human action** has exactly **one primary owning role** at a time. Shared visibility does not create shared ownership.

### 4.2 Ownership means responsibility, not exclusive visibility

Other roles may **view** documents on Control Tower, trace panels, or read-only Workspace access. **Write authority** and **Pending Actions** belong to the primary owner (Constitution Art. 10; Design Principles §9.4).

### 4.3 Standard product defaults

The matrix below is the **standard out-of-box** FT ERP model (Constitution Art. 10). **Configurable responsibility** (Art. 20) may reassign ownership in future deployments; defaults remain the product reference.

### 4.4 Workflow Engine routes Pending Actions to owners

**Pending Actions** are generated only for the **primary owner** of the current workflow state (Constitution Art. 12). Dashboard shows role-filtered Pending Actions; Control Tower shows factory-wide ownership for monitoring—not a second task queue.

### 4.5 Ownership handoff is workflow-driven

Ownership transfers when the Workflow Engine advances state (e.g. Store submits monthly plan → Purchase owns Purchase review). Manual reassignment outside workflow is prohibited in standard product.

---

## 5. Commercial Document Ownership

| Document / artifact | Creator | Reviewer | Approver | Primary Owner | Notes |
|---------------------|---------|----------|----------|---------------|-------|
| **Enquiry** | Admin | Admin / commercial lead | — | **Admin** | Business Model selected here ([Ch. 1](./Chapter_01_Business_Models_and_Document_Inheritance.md)) |
| **Feasibility** | Admin | Admin / technical | Admin (decision) | **Admin** | Gates Quotation; inherits Business Model |
| **Quotation** | Admin | Admin / commercial lead | Admin (optional) | **Admin** | Commercial offer; precedes Internal Sales Order |
| **Internal Sales Order** | Admin | Admin / commercial lead | Admin (commitment) | **Admin** | Order qty (REGULAR) or agreement frame (NO_QTY) |
| **Customer PO (reference)** | Admin (capture) | — | — | **None (reference)** | Metadata on Internal Sales Order; **does not** own workflow ([Constitution Art. 15](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)) |
| **Sales Bill** | Admin | Admin / finance | Admin (posting) | **Admin** | After dispatch; commercial completion ([Ch. 4](./Chapter_04_Manufacturing_Execution_Pipeline.md) §12) |

**Cross-reference:** Commercial chain through Internal Sales Order — [Chapter 1](./Chapter_01_Business_Models_and_Document_Inheritance.md); billing — [Chapter 4](./Chapter_04_Manufacturing_Execution_Pipeline.md) §12.

---

## 6. Planning Ownership

| Document / stage | Creator | Reviewer | Approver | Primary Owner | Notes |
|------------------|---------|----------|----------|---------------|-------|
| **Requirement Sheet (RS)** | Store | Store lead | Store (lock) | **Store** | NO_QTY only ([Ch. 3](./Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md) §7) |
| **Planning Cycle** | Store (lock RS) | — | Store | **Store** | Bounded execution window per RS version |
| **Monthly Production Planning Sheet (MPRS)** — draft | Store | — | — | **Store** | FG plan composition; Initial / Additional |
| **MPRS — Purchase review** | Store (submit) | **Purchase** | **Purchase** | **Purchase** | `AWAITING_PURCHASE_REVIEW`; NO_QTY only |
| **MPRS — approval / planning freeze** | — | Purchase | **Purchase** | **Purchase** | RM Snapshot created on approval |
| **RM release** | Store (action) | — | Store (confirm) | **Store** | Publishes MPRS pool demand; not WO creation ([Ch. 3](./Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md) §9.3) |
| **Material Requirement (MR)** — REGULAR | Store | Store lead | Store | **Store** | From order shortage; REGULAR_SO pool ([Ch. 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md) §8) |
| **Material Requirement (MR)** — MPRS | System (from release) | Store (release context) | — | **Store** (origin) → **Purchase** (PR stage) | After release, PR ownership transfers to Purchase |
| **REGULAR order RM readiness** | Store | — | — | **Store** | RM Control Center case ownership ([Ch. 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md) §7) |
| **Work Order preparation / placement** | Store | — | Store | **Store** | Planning terminus both models |

---

## 7. Procurement Ownership

| Document / stage | Creator | Reviewer | Approver | Primary Owner | Notes |
|------------------|---------|----------|----------|---------------|-------|
| **Purchase Requisition (PR)** — REGULAR_SO | **Store** | Purchase (readiness) | — | **Store** (create) → **Purchase** (PO prep) | Store creates; Purchase executes PO ([Ch. 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md) §8.2) |
| **Purchase Requisition (PR)** — MPRS | **Purchase** | — | — | **Purchase** | MPRS MR standard ([Ch. 3](./Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md) §9.2) |
| **Purchase Requisition (PR)** — STOCK_REPLENISHMENT | Store or Purchase | — | — | **Store** (default) | Replenishment / ARR context |
| **Purchase Order (PO)** | Purchase | Purchase lead | Purchase (authorize) | **Purchase** | Supplier commercial execution |
| **Supplier follow-up** | — | — | — | **Purchase** | Delivery chase, expedite—not a separate ERP document |
| **Goods Receipt Note (GRN)** | Store | Store lead | Store (post) | **Store** | Inbound stock posting ([Constitution Art. 10](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)) |
| **RM availability (Read Model)** | System | — | — | **System** | Store consumes for WO placement; Purchase for queue monitor |

**REGULAR Purchase review** = PR/PO execution queue ([Ch. 2](./Chapter_02_REGULAR_Order_Planning_Pipeline.md)). **NO_QTY Purchase review** = monthly plan approval ([Ch. 3](./Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md))—same role, different stage semantics.

---

## 8. Manufacturing Ownership

| Document / stage | Creator | Reviewer | Approver | Primary Owner | Notes |
|------------------|---------|----------|----------|---------------|-------|
| **Work Order** | Store | Store lead | Store | **Store** | Created in planning; active through execution ([Ch. 4](./Chapter_04_Manufacturing_Execution_Pipeline.md) §6) |
| **PMR (Production Material Request)** | System / Store (generate) | Store | Store (submit) | **Store** | Frozen RM requirement; immutable after submit |
| **ARR (Additional RM Requisition)** | Store / Production (initiate) | Store | Store | **Store** (initiate) → **Purchase** (supply) | Supplementary RM; not PMR replacement ([Ch. 4](./Chapter_04_Manufacturing_Execution_Pipeline.md) §7.3) |
| **Material Issue** | Store | Store lead | Store (confirm) | **Store** | RM to production location |
| **Production Entry** | Production | Production lead | Production (approve) | **Production** | Batch recording; triggers consumption on approval |
| **QA Inspection** | QA | QA lead | QA (release) | **QA** | Accept / reject disposition |
| **Rework** | QA (disposition) | Production (execute) | QA (re-inspect) | **QA** (gate) / **Production** (execute) | QA owns disposition gate; Production executes rework |
| **Scrap** | QA / Production (report) | QA | QA (authorize) | **QA** | Audit disposition; reduces good output |

**Cross-reference:** Execution pipeline ownership — [Chapter 4](./Chapter_04_Manufacturing_Execution_Pipeline.md) §6, §13.

---

## 9. Fulfillment Ownership

| Document / stage | Creator | Reviewer | Approver | Primary Owner | Notes |
|------------------|---------|----------|----------|---------------|-------|
| **Dispatch** | Store | Store lead | Store (confirm) | **Store** | Shipment execution |
| **Dispatch Note** | Store | Store lead | Store (post) | **Store** | ERP-controlled shipment document |
| **Sales Billing (Sales Bill)** | Admin | Admin / finance | Admin | **Admin** | Post-dispatch; standard product ([Ch. 4](./Chapter_04_Manufacturing_Execution_Pipeline.md) §12) |
| **Billing export** | Admin | — | Admin | **Admin** | Integration output; not manufacturing stage |
| **Commercial completion** | Admin (milestone) | Admin | Admin | **Admin** | Order/agreement lifecycle milestone |

---

## 10. Dashboard Responsibility

**Dashboard = My Work** (Constitution Art. 13). Each role sees **Pending Actions** where that role is **primary owner**.

| Role | Representative Pending Actions (planning + execution) |
|------|------------------------------------------------------|
| **Admin** | Complete Enquiry / Feasibility / Quotation; commit Internal Sales Order; create Sales Bill; billing export; commercial completion review |
| **Store** | Lock RS; complete/submit MPRS; release RM; raise REGULAR MR; create REGULAR PR; post GRN; WO prepare/placement; submit PMR; Material Issue; Dispatch; Material Return |
| **Purchase** | Review/approve Monthly Production Plan (NO_QTY); create MPRS PR; prepare PO; supplier follow-up; monitor awaiting GRN (read-only alert, GRN action remains Store) |
| **Production** | Record Production Entry; approve batch; report floor blocker |
| **QA** | Inspect batch; disposition reject/rework/scrap; re-inspection after rework |

**Rule:** Dashboard does **not** show other roles’ actionable buttons. Cross-role work appears on **Control Tower** for visibility, not for execution on Dashboard.

---

## 11. Workspace Responsibility

**Workspace = Do Work** (Design Principles §9). Write authority follows **primary owner**.

| Workspace | Primary owner role | Primary work | Cross-reference |
|-----------|-------------------|--------------|-----------------|
| **Commercial documents** (Enquiry → Internal Sales Order) | Admin | Commercial chain progression | Ch. 1 |
| **RM Control Center** | Store | REGULAR order RM case diagnosis and handoff | Ch. 2 §7 |
| **Requirement & Cycle Planning** | Store | RS, cycle lock, WO placement context | Ch. 3 §7 |
| **Monthly Production Planning Sheet (MPRS)** | Store (draft/release); Purchase (review) | FG plan, submit, approve, release | Ch. 3 §8 |
| **Procurement Workspace** | Store (REGULAR PR); Purchase (MPRS PR, PO) | Demand pool queues, PR, PO context | Ch. 2 §8; Ch. 3 §9 |
| **Work Order context** | Store | WO header, placement trace | Ch. 2–4 |
| **PMR / Material Issue** | Store | PMR submit, issue against PMR | Ch. 4 §7–8 |
| **Production entry** | Production | Record and approve output | Ch. 4 §9 |
| **QA Inspection** | QA | Inspect, accept, reject, rework, scrap | Ch. 4 §10 |
| **Dispatch** | Store | Dispatch Note, shipment confirmation | Ch. 4 §11 |
| **Sales Bill** | Admin | Invoice and commercial posting | Ch. 4 §12 |

Non-owners may open read-only Workspace from Control Tower deep-links; write CTAs are suppressed (Design Principles §9.4).

---

## 12. Control Tower Responsibility

### 12.1 Factory monitoring

Control Tower answers: *What is the status of factory work across roles?* It displays document, **workflow stage**, **primary owner**, risk, age, and recommended action factory-wide (Constitution Art. 14).

### 12.2 No ownership transfer

Viewing a row on Control Tower **does not** transfer ownership. Only workflow state advancement reassigns primary owner.

### 12.3 Read-first analytics

Control Tower is **read/monitor primary**. KPIs, aging, bottleneck themes (planning backlog, procurement stall, QA backlog, dispatch backlog) support escalation—not daily task execution.

### 12.4 Escalation visibility

Control Tower may deep-link to owning role’s **Workspace** or show read-only trace. **Execution buttons** on Control Tower are prohibited except engine-defined escalation-only actions (Constitution Art. 14).

| Control Tower theme | Typical owner column | Escalation target |
|--------------------|----------------------|-------------------|
| Planning backlog | Store / Purchase | MPRS or RS Workspace |
| Procurement bottleneck | Purchase / Store | Procurement Workspace |
| RM shortage | Store | RM Control Center or Requirement planning |
| WO awaiting RM | Store | PMR / Issue Workspace |
| Production delay | Production | Production entry |
| QA backlog | QA | QA Inspection |
| Dispatch backlog | Store | Dispatch Workspace |

---

## 13. Responsibility Matrix (RACI)

**Legend:** **R** = Responsible (does the work) · **A** = Accountable (primary owner) · **C** = Consulted · **I** = Informed

### 13.1 Commercial & fulfillment

| Document / stage | Admin | Store | Purchase | Production | QA | System |
|------------------|:-----:|:-----:|:--------:|:----------:|:--:|:------:|
| Enquiry | **RA** | I | I | — | — | I |
| Feasibility | **RA** | C | I | — | — | — |
| Quotation | **RA** | I | I | — | — | — |
| Internal Sales Order | **RA** | I | I | — | — | I |
| Customer PO (reference) | R | I | I | — | — | I |
| Sales Bill | **RA** | I | — | — | — | I |
| Billing export | **RA** | — | — | — | — | R |
| Dispatch Note | I | **RA** | — | — | I | I |

### 13.2 Planning

| Document / stage | Admin | Store | Purchase | Production | QA | System |
|------------------|:-----:|:-----:|:--------:|:----------:|:--:|:------:|
| Requirement Sheet | I | **RA** | I | — | — | I |
| Planning Cycle (lock) | — | **RA** | I | — | — | I |
| MPRS draft | — | **RA** | I | — | — | R |
| MPRS Purchase review / approval | — | I | **RA** | — | — | R |
| RM release | — | **RA** | I | — | — | R |
| REGULAR MR | — | **RA** | I | — | — | R |
| MPRS MR (post-release) | — | C | **A** (PR→PO) | — | — | R |
| REGULAR RM Control Center | — | **RA** | C | — | — | R |
| Work Order creation | — | **RA** | I | I | — | R |

### 13.3 Procurement

| Document / stage | Admin | Store | Purchase | Production | QA | System |
|------------------|:-----:|:-----:|:--------:|:----------:|:--:|:------:|
| PR (REGULAR_SO) | — | **RA** (create) | **A** (PO) | — | — | I |
| PR (MPRS) | — | I | **RA** | — | — | I |
| Purchase Order | — | I | **RA** | — | — | I |
| Supplier follow-up | — | I | **RA** | — | — | — |
| GRN | — | **RA** | I | — | — | R |
| RM availability | — | C | C | C | — | **RA** (compute) |

### 13.4 Manufacturing execution

| Document / stage | Admin | Store | Purchase | Production | QA | System |
|------------------|:-----:|:-----:|:--------:|:----------:|:--:|:------:|
| PMR | — | **RA** | — | I | — | R |
| ARR | — | **A** (initiate) | R (supply) | C | — | I |
| Material Issue | — | **RA** | — | I | — | R |
| Production Entry | — | I | — | **RA** | I | R |
| QA Inspection | — | I | — | C | **RA** | R |
| Rework | — | I | — | R | **A** | I |
| Scrap disposition | — | I | — | C | **A** | R |

---

## 14. Business Rules

| ID | Rule |
|----|------|
| **OWN-01** | Every ERP-controlled document has **one primary owner** at each workflow state. |
| **OWN-02** | **Pending Actions** are generated **only** for the primary owner of the current state. |
| **OWN-03** | Ownership changes **only through workflow** state advancement—not manual override in standard product. |
| **OWN-04** | **Visibility ≠ ownership**; read access does not confer write authority or Pending Actions. |
| **OWN-05** | **Billing ownership remains Admin** in the standard product (Sales Bill, export, commercial completion). |
| **OWN-06** | **Customer PO (reference)** has no primary owner for workflow advancement. |
| **OWN-07** | **GRN posting** is Store-owned; Purchase is informed, not accountable for receipt. |
| **OWN-08** | **Purchase Order** creation is Purchase-owned; Store does not authorize supplier commercial terms. |
| **OWN-09** | **MPRS Purchase review** is Purchase-owned; Store cannot self-approve monthly plan. |
| **OWN-10** | **RM release** is Store-owned; Purchase cannot release MPRS demand to procurement pool. |
| **OWN-11** | **PR creation** follows source pool: Store (REGULAR_SO standard), Purchase (MPRS standard). |
| **OWN-12** | **Work Order creation** is Store-owned in standard product (Constitution Art. 10; configurable per Art. 20). |
| **OWN-13** | **PMR and Material Issue** are Store-owned; Production cannot self-issue RM. |
| **OWN-14** | **Production Entry** is Production-owned; Store cannot approve shop-floor output. |
| **OWN-15** | **QA Inspection** is QA-owned; Production cannot self-release dispatch-eligible FG. |
| **OWN-16** | **Dispatch** is Store-owned; Admin does not post physical shipment. |
| **OWN-17** | **Control Tower** does not reassign ownership or execute primary-owner actions by default. |
| **OWN-18** | **Dashboard** shows only the logged-in role’s owned Pending Actions (Art. 13). |

---

## 15. Review Checklist

- [ ] All major documents from Chapters 1–4 covered
- [ ] Constitution Arts. 10–14 reflected
- [ ] Glossary terminology only
- [ ] REGULAR vs NO_QTY ownership differences (PR, Purchase review, MR) explicit
- [ ] Customer PO as reference without owner
- [ ] Dashboard, Workspace, Control Tower mapped
- [ ] Consolidated RACI complete
- [ ] Business Rules OWN-01–OWN-18
- [ ] No UI, API, database, implementation
- [ ] Cross-references to Chapters 2–4 instead of redefining workflows

---

## 16. Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0.0 | 2026-05-29 | FT ERP Product Team | Initial Document Ownership & Responsibility Matrix |

---

## 17. Approval Block

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Product Architecture | | | |
| Admin / Commercial Process Owner | | | |
| Store Process Owner | | | |
| Purchase Process Owner | | | |
| Production Process Owner | | | |
| QA Process Owner | | | |

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [Manufacturing Execution Pipeline](./Chapter_04_Manufacturing_Execution_Pipeline.md) (FT-PD-023) |
| **Next** | [Commercial Document Chain](./Chapter_06_Commercial_Document_Chain.md) (FT-PD-025) |
| **Volume** | [Business Architecture](./README.md) |
| **Product** | [Product Documentation Index](../README.md) |

