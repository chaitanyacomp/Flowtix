# Flowtix ERP — Deployment Validation & Client Handover Pack

| Field | Value |
|-------|-------|
| **Pack ID** | FT-DEP-011 … FT-DEP-013 + checklists |
| **Governing standard** | [FT-DEP-001](../FT-DEP-001_Deployment_Release_Management.md) v1.10.0 §36 |
| **Audience** | System administrators, implementation partners, Business Owners |
| **Scope** | Production readiness, acceptance, handover — **not** product source |

## How to use

1. Before go-live: complete **FT-DEP-011 Production Readiness**.
2. During install/update: use the numbered **checklists** in order relevant to the activity.
3. At cutover: complete **Release Sign-off** and **Deployment Report**.
4. At handover: complete **Client Handover** and leave **Administrator Runbook** with the customer Admin.
5. Optional: run `tools\verify-install.bat --home <FT_ERP_HOME>` (read-only).

## Index

| Document | Purpose |
|----------|---------|
| [FT-DEP-011_Production_Readiness.md](./FT-DEP-011_Production_Readiness.md) | Master production-ready gate |
| [checklists/01_Production_Deployment.md](./checklists/01_Production_Deployment.md) | End-to-end production deploy |
| [checklists/02_Installation_Verification.md](./checklists/02_Installation_Verification.md) | Post-install technical verify |
| [checklists/03_Post_Install_Smoke.md](./checklists/03_Post_Install_Smoke.md) | Minimum functional smoke (FT-PD-066) |
| [checklists/04_Backup_Verification.md](./checklists/04_Backup_Verification.md) | Backup / manifest checks |
| [checklists/05_Update_Verification.md](./checklists/05_Update_Verification.md) | Batch 6 update verify |
| [checklists/06_Rollback_Verification.md](./checklists/06_Rollback_Verification.md) | Batch 7 rollback verify |
| [checklists/07_Windows_Service_Verification.md](./checklists/07_Windows_Service_Verification.md) | Batch 8 service verify |
| [checklists/08_Client_Acceptance.md](./checklists/08_Client_Acceptance.md) | Business acceptance |
| [checklists/09_Client_Handover.md](./checklists/09_Client_Handover.md) | Partner → customer handover |
| [templates/Release_Signoff.md](./templates/Release_Signoff.md) | Formal sign-off |
| [templates/Deployment_Report.md](./templates/Deployment_Report.md) | Deploy record |
| [templates/Support_Escalation.md](./templates/Support_Escalation.md) | Support pack (no secrets) |
| [FT-DEP-012_Administrator_Runbook.md](./FT-DEP-012_Administrator_Runbook.md) | Day-2 admin operations |
| [FT-DEP-013_Version_Compatibility_Matrix.md](./FT-DEP-013_Version_Compatibility_Matrix.md) | Fill per release |

## Rules

- **SHALL NOT** paste `shared\.env` passwords into tickets or reports ([FT-DEP-001 §17.3](../FT-DEP-001_Deployment_Release_Management.md)).
- Smoke tests **SHALL NOT** invent alternate UX ([FT-PD-066](../../06_UI_and_Experience_Architecture/Chapter_07_FT_ERP_UI_UX_Design_System.md)).
- Deployment engines remain Batches 1–10; this pack only validates and records.

## Related

- Volume 9: FT-PD-090 … FT-PD-094  
- FT-PD-103 Documentation Governance  
- FT-PD-091 INS-06 (business sign-off), FT-PD-090 DEP-12 (post-upgrade validation)
