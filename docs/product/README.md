# FT ERP — Product Documentation

Permanent blueprint for **FT ERP**, a commercial workflow-driven manufacturing ERP.

**Start here:** [Architecture Map & Navigation Guide](./Architecture_Map_and_Navigation_Guide.md) (FT-PD-999) — master orientation, reading paths, volume map, and traceability.

**Baseline v1.0.0:** [Release Notes](./release/RELEASE_NOTES_v1.0.0.md) · [Baseline Manifest](./release/BASELINE_MANIFEST_v1.0.0.md) · [Change Policy](./release/CHANGE_POLICY.md) · [Baseline Freeze](./release/BASELINE_FREEZE.md)

This documentation is the authoritative reference for product vision, business architecture, domain behavior, workflows, data design, UX standards, and technical architecture. Every future feature, module, configuration, and customization must align with these volumes.

## Documentation principles

- **Product architecture first** — not implementation notes or client project history.
- **Manufacturing-native** — grounded in discrete manufacturing, BOM-driven production, and shop-floor reality.
- **Long-term** — written for a 5–10 year product horizon.
- **Versioned** — approved chapters evolve through controlled versioning; superseded content is archived, not deleted silently.

## Volume index

| Volume | Folder | Purpose | Status |
|--------|--------|---------|--------|
| **—** | [release/](./release/) | **v1.0.0 baseline** — release notes, manifest, change policy, freeze declaration | **Baseline frozen 2026-05-29** |
| **—** | [Architecture_Map_and_Navigation_Guide.md](./Architecture_Map_and_Navigation_Guide.md) | Master navigation, reading paths, volume map, traceability (FT-PD-999) | **Draft — Architecture Review** |
| **0** | [00_Product_Vision_and_Strategy](./00_Product_Vision_and_Strategy/) | Why FT ERP exists; vision, mission, positioning, roadmap, and product governance | **Draft — Architecture Review** |
| **1** | [01_Product_Foundation](./01_Product_Foundation/) | Introduction, constitution, glossary, design principles | **Ch. 1–4 Draft — Architecture Review** |
| **2** | [02_Business_Architecture](./02_Business_Architecture/) | Business models, planning pipelines, execution pipeline, ownership | **Ch. 1–6 Draft** |
| **3** | [03_Domain_Specifications](./03_Domain_Specifications/) | Module and domain behavior (commercial, planning, procurement, production, QA, dispatch) | **Ch. 1–6 Draft — Complete** |
| **4** | [04_Workflow_Engine](./04_Workflow_Engine/) | Workflow states, gates, handoffs, cross-domain orchestration, Pending Actions | **Ch. 1–9 Draft — Complete** |
| **5** | [05_Data_Architecture](./05_Data_Architecture/) | Master data, transactional model, snapshots, ledger, Read Models | **Ch. 1–6 Draft — Complete** |
| **6** | [06_UI_and_Experience_Architecture](./06_UI_and_Experience_Architecture/) | Dashboard, Workspace, Control Tower, registers, reports, UX principles | **Ch. 1–6 Draft — Complete** |
| **7** | [07_Security_and_Governance_Architecture](./07_Security_and_Governance_Architecture/) | Security, authorization, identity, audit, governance, configuration, integration | **Ch. 1–5 Draft — Complete** |
| **8** | [08_Product_Testing_and_Validation](./08_Product_Testing_and_Validation/) | Product validation, regression, certification, evidence governance | **Ch. 1–5 Draft — Complete** |
| **9** | [09_Deployment_and_Operations_Architecture](./09_Deployment_and_Operations_Architecture/) | Deployment, operations, resilience, lifecycle stewardship | **Ch. 1–5 Draft — Complete** |
| **10** | [10_Product_Lifecycle_and_Continuous_Evolution](./10_Product_Lifecycle_and_Continuous_Evolution/) | Product lifecycle, evolution, stewardship — **corpus conclusion** | **Ch. 1–5 Draft — Complete** |
| **11** | *Manufacturing Knowledge* *(planned)* | BOM, RM, FG weight planning, loss models, shop-floor patterns | Planned |

## Reading order for new stakeholders

1. **Volume 0** — [Product Vision & Strategy](./00_Product_Vision_and_Strategy/Volume_0_Product_Vision_and_Strategy.md)
2. **Volume 1, Chapter 1** — [Introduction](./01_Product_Foundation/Chapter_01_Introduction.md)
3. **Volume 1, Chapter 2** — [FT ERP Constitution](./01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md)
4. **Volume 1, Chapter 3** — [Glossary & Standard Terminology](./01_Product_Foundation/Chapter_03_FT_ERP_Glossary_and_Standard_Terminology.md)
5. **Volume 1, Chapter 4** — [Product Design Principles](./01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md)
6. **Volume 2, Chapter 1** — [Business Models & Document Inheritance](./02_Business_Architecture/Chapter_01_Business_Models_and_Document_Inheritance.md)
7. **Volume 2, Chapter 2** — [REGULAR Order Planning Pipeline](./02_Business_Architecture/Chapter_02_REGULAR_Order_Planning_Pipeline.md)
8. **Volume 2, Chapter 3** — [NO_QTY Agreement Planning Pipeline](./02_Business_Architecture/Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md)
9. **Volume 2, Chapter 4** — [Manufacturing Execution Pipeline](./02_Business_Architecture/Chapter_04_Manufacturing_Execution_Pipeline.md)
10. **Volume 2, Chapter 5** — [Document Ownership & Responsibility Matrix](./02_Business_Architecture/Chapter_05_Document_Ownership_and_Responsibility_Matrix.md)
11. **Volume 2, Chapter 6** — [Commercial Document Chain](./02_Business_Architecture/Chapter_06_Commercial_Document_Chain.md)
12. **Volume 3, Chapter 1** — [Commercial Domain Specification](./03_Domain_Specifications/Chapter_01_Commercial_Domain_Specification.md)
13. **Volume 3, Chapter 2** — [Planning Domain Specification](./03_Domain_Specifications/Chapter_02_Planning_Domain_Specification.md)
14. **Volume 3, Chapter 3** — [Procurement Domain Specification](./03_Domain_Specifications/Chapter_03_Procurement_Domain_Specification.md)
15. **Volume 3, Chapter 4** — [Manufacturing Domain Specification](./03_Domain_Specifications/Chapter_04_Manufacturing_Domain_Specification.md)
16. **Volume 3, Chapter 5** — [Quality Assurance Domain Specification](./03_Domain_Specifications/Chapter_05_Quality_Assurance_Domain_Specification.md)
17. **Volume 3, Chapter 6** — [Dispatch & Billing Domain Specification](./03_Domain_Specifications/Chapter_06_Dispatch_and_Billing_Domain_Specification.md)
18. **Volume 4, Chapter 1** — [Workflow Engine Overview & Pending Actions Contract](./04_Workflow_Engine/Chapter_01_Workflow_Engine_Overview_and_Pending_Actions_Contract.md)
19. **Volume 4, Chapter 2** — [Transition Guards & Cross-Domain Dependency Catalog](./04_Workflow_Engine/Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md)
20. **Volume 4, Chapter 3** — [Commercial Workflow State Machine](./04_Workflow_Engine/Chapter_03_Commercial_Workflow_State_Machine.md)
21. **Volume 4, Chapter 4** — [Planning Workflow State Machine](./04_Workflow_Engine/Chapter_04_Planning_Workflow_State_Machine.md)
22. **Volume 4, Chapter 5** — [Procurement Workflow State Machine](./04_Workflow_Engine/Chapter_05_Procurement_Workflow_State_Machine.md)
23. **Volume 4, Chapter 6** — [Manufacturing Workflow State Machine](./04_Workflow_Engine/Chapter_06_Manufacturing_Workflow_State_Machine.md)
24. **Volume 4, Chapter 7** — [Quality Assurance Workflow State Machine](./04_Workflow_Engine/Chapter_07_Quality_Assurance_Workflow_State_Machine.md)
25. **Volume 4, Chapter 8** — [Dispatch & Billing Workflow State Machine](./04_Workflow_Engine/Chapter_08_Dispatch_and_Billing_Workflow_State_Machine.md)
26. **Volume 4, Chapter 9** — [Cross-Domain Workflow Orchestration & Event Coordination](./04_Workflow_Engine/Chapter_09_Cross_Domain_Workflow_Orchestration_and_Event_Coordination.md)
27. **Volume 5, Chapter 1** — [Workflow Event Store & Correlation Persistence](./05_Data_Architecture/Chapter_01_Workflow_Event_Store_and_Correlation_Persistence.md)
28. **Volume 5, Chapter 2** — [Transactional Document Model](./05_Data_Architecture/Chapter_02_Transactional_Document_Model.md)
29. **Volume 5, Chapter 3** — [Master Data & Reference Architecture](./05_Data_Architecture/Chapter_03_Master_Data_and_Reference_Architecture.md)
30. **Volume 5, Chapter 4** — [Planning & Procurement Snapshot Architecture](./05_Data_Architecture/Chapter_04_Planning_and_Procurement_Snapshot_Architecture.md)
31. **Volume 5, Chapter 5** — [Inventory Ledger & Stock Persistence Architecture](./05_Data_Architecture/Chapter_05_Inventory_Ledger_and_Stock_Persistence_Architecture.md)
32. **Volume 5, Chapter 6** — [Read Models, Reporting & Analytical Persistence](./05_Data_Architecture/Chapter_06_Read_Models_Reporting_and_Analytical_Persistence.md)
33. **Volume 6, Chapter 1** — [UI Architecture, Navigation & Experience Principles](./06_UI_and_Experience_Architecture/Chapter_01_UI_Architecture_Navigation_and_Experience_Principles.md)
34. **Volume 6, Chapter 2** — [Dashboard Architecture & Widget Standards](./06_UI_and_Experience_Architecture/Chapter_02_Dashboard_Architecture_and_Widget_Standards.md)
35. **Volume 6, Chapter 3** — [Control Tower Architecture & Factory Monitoring](./06_UI_and_Experience_Architecture/Chapter_03_Control_Tower_Architecture_and_Factory_Monitoring.md)
36. **Volume 6, Chapter 4** — [Workspace Architecture & Document Execution Surfaces](./06_UI_and_Experience_Architecture/Chapter_04_Workspace_Architecture_and_Document_Execution_Surfaces.md)
37. **Volume 6, Chapter 5** — [Registers, Masters & Browse Surfaces](./06_UI_and_Experience_Architecture/Chapter_05_Registers_Masters_and_Browse_Surfaces.md)
38. **Volume 6, Chapter 6** — [Reports & Analytical Surfaces](./06_UI_and_Experience_Architecture/Chapter_06_Reports_and_Analytical_Surfaces.md)
39. **Volume 7, Chapter 1** — [Security, Authorization & Governance Architecture](./07_Security_and_Governance_Architecture/Chapter_01_Security_Authorization_and_Governance_Architecture.md)
40. **Volume 7, Chapter 2** — [Identity, User, Organization & Delegation Architecture](./07_Security_and_Governance_Architecture/Chapter_02_Identity_User_Organization_and_Delegation_Architecture.md)
41. **Volume 7, Chapter 3** — [Audit, Compliance & Data Retention Governance](./07_Security_and_Governance_Architecture/Chapter_03_Audit_Compliance_and_Data_Retention_Governance.md)
42. **Volume 7, Chapter 4** — [Configuration, Business Policies & Feature Flag Architecture](./07_Security_and_Governance_Architecture/Chapter_04_Configuration_Business_Policies_and_Feature_Flag_Architecture.md)
43. **Volume 7, Chapter 5** — [Platform Integration & External Trust Boundaries](./07_Security_and_Governance_Architecture/Chapter_05_Platform_Integration_and_External_Trust_Boundaries.md)
44. **Volume 8, Chapter 1** — [Product Testing, Validation & Compliance Framework](./08_Product_Testing_and_Validation/Chapter_01_Product_Testing_Validation_and_Compliance_Framework.md)
45. **Volume 8, Chapter 2** — [Workflow Regression Guardrails & Protected Behavior Catalog](./08_Product_Testing_and_Validation/Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md)
46. **Volume 8, Chapter 3** — [Canonical Test Data, Factory Simulation & Acceptance Scenarios](./08_Product_Testing_and_Validation/Chapter_03_Canonical_Test_Data_Factory_Simulation_and_Acceptance_Scenarios.md)
47. **Volume 8, Chapter 4** — [User Acceptance, Certification & Release Readiness](./08_Product_Testing_and_Validation/Chapter_04_User_Acceptance_Certification_and_Release_Readiness.md)
48. **Volume 8, Chapter 5** — [Validation Evidence, Audit Trails & Continuous Compliance](./08_Product_Testing_and_Validation/Chapter_05_Validation_Evidence_Audit_Trails_and_Continuous_Compliance.md)
49. **Volume 9, Chapter 1** — [Deployment & Release Architecture](./09_Deployment_and_Operations_Architecture/Chapter_01_Deployment_and_Release_Architecture.md)
50. **Volume 9, Chapter 2** — [Installation, Upgrade & Migration Architecture](./09_Deployment_and_Operations_Architecture/Chapter_02_Installation_Upgrade_and_Migration_Architecture.md)
51. **Volume 9, Chapter 3** — [Operational Monitoring, Support & Maintenance Architecture](./09_Deployment_and_Operations_Architecture/Chapter_03_Operational_Monitoring_Support_and_Maintenance_Architecture.md)
52. **Volume 9, Chapter 4** — [Backup, Recovery, Business Continuity & Disaster Recovery Architecture](./09_Deployment_and_Operations_Architecture/Chapter_04_Backup_Recovery_Business_Continuity_and_Disaster_Recovery_Architecture.md)
53. **Volume 9, Chapter 5** — [Operational Governance, Capacity Planning & Lifecycle Management](./09_Deployment_and_Operations_Architecture/Chapter_05_Operational_Governance_Capacity_Planning_and_Lifecycle_Management.md)
54. **Volume 10, Chapter 1** — [Product Lifecycle, Roadmap & Continuous Evolution](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_01_Product_Lifecycle_Roadmap_and_Continuous_Evolution.md)
55. **Volume 10, Chapter 2** — [Feature Governance, Change Control & Architectural Decision Records](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md)
56. **Volume 10, Chapter 3** — [Product Quality Strategy, Technical Debt & Architectural Sustainability](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_03_Product_Quality_Strategy_Technical_Debt_and_Architectural_Sustainability.md)
57. **Volume 10, Chapter 4** — [Product Knowledge Management, Documentation Governance & Organizational Learning](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md)
58. **Volume 10, Chapter 5** — [Product Stewardship, Long-Term Vision & Future Architecture](./10_Product_Lifecycle_and_Continuous_Evolution/Chapter_05_Product_Stewardship_Long_Term_Vision_and_Future_Architecture.md)

## Document control

All product documents use a standard header:

- **Document ID** — e.g. `FT-PD-000`
- **Version** — semantic product-doc version (e.g. `1.0.0`)
- **Status** — Draft — Architecture Review | In Review | Approved | Superseded
- **Effective date**
- **Owner** — Product Architecture

Changes to **Approved** documents require a version increment and change log entry.
