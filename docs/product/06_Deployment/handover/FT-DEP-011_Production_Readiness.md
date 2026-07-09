# FT-DEP-011 — Production Readiness Checklist

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-011 |
| **Version** | 1.0.0 |
| **Parent** | FT-DEP-001 v1.10.0 §36 |
| **Site / Customer** | |
| **Target product version** | |
| **Date** | |

Use as the **master gate** before declaring production ready. Complete linked checklists; mark N/A only with reason.

## A. Environment & prerequisites

- [ ] Windows LAN server prepared (disk, IP, firewall for app port)
- [ ] Node.js installed (see `check-prereqs` / Batch 9)
- [ ] MySQL installed and reachable (installer does **not** install MySQL)
- [ ] `mysqldump` available for Path A / backups (Batch 4)
- [ ] `FT_ERP_HOME` chosen (e.g. `C:\FT-ERP`)

## B. Package & identity

- [ ] Certified release package / installer for intended version (DEP-01)
- [ ] `VERSION.txt` / build identity recorded (DEP-02)
- [ ] Compatibility matrix filled ([FT-DEP-013](./FT-DEP-013_Version_Compatibility_Matrix.md))

## C. Install / setup

- [ ] Installation verification complete ([02](./checklists/02_Installation_Verification.md))
- [ ] `shared\.env` present and validated (secrets **not** copied into this form)
- [ ] Optional Windows Service verified if used ([07](./checklists/07_Windows_Service_Verification.md))
- [ ] `verify-install` run (optional) — result: Pass / Fail / Skipped

## D. Data protection

- [ ] Backup verification complete ([04](./checklists/04_Backup_Verification.md))
- [ ] Rollback path understood ([06](./checklists/06_Rollback_Verification.md)); Mode B DB restore is **manual** if needed
- [ ] Prior release / pre-update archive retention understood (Batch 6/7)

## E. Acceptance

- [ ] Post-install smoke complete ([03](./checklists/03_Post_Install_Smoke.md))
- [ ] Client acceptance complete ([08](./checklists/08_Client_Acceptance.md))
- [ ] Release sign-off signed ([templates/Release_Signoff.md](./templates/Release_Signoff.md))
- [ ] Deployment report filed ([templates/Deployment_Report.md](./templates/Deployment_Report.md))

## F. Handover

- [ ] Client handover complete ([09](./checklists/09_Client_Handover.md))
- [ ] Administrator runbook left with Admin ([FT-DEP-012](./FT-DEP-012_Administrator_Runbook.md))
- [ ] Support escalation path agreed ([templates/Support_Escalation.md](./templates/Support_Escalation.md))

## Gate decision

| Result | Criteria |
|--------|----------|
| **READY** | All applicable items Pass; Business Owner Accept |
| **NOT READY** | Any critical Fail; do not go live |

**Decision:** READY / NOT READY  

**Admin:** _______________ **Business Owner:** _______________ **Date:** _______________
