# FT-DEP-011 — Production Readiness Checklist

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-011 |
| **Version** | 1.1.0 |
| **Parent** | FT-DEP-001 v1.12.0 §36–§37 |
| **Site / Customer** | |
| **Target product version** | |
| **Date** | |

Use as the **master gate** before declaring production ready. Complete linked checklists; mark N/A only with reason.

## A. Environment & prerequisites

- [ ] Windows LAN server prepared (disk, static IP recommended)
- [ ] Firewall: `firewall-flowtix` rule **or** manual inbound TCP for `PORT` (default 4000)
- [ ] Node.js installed (see `check-prereqs` / Batch 9)
- [ ] MySQL installed and reachable (Flowtix installer does **not** install MySQL)
- [ ] `mysqldump` available for Path A / backups (Batch 4)
- [ ] `FT_ERP_HOME` chosen (e.g. `C:\FT-ERP`)
- [ ] `tools\install-validate.bat --home <FT_ERP_HOME>` report PASS (or FAIL items corrected before setup)
- [ ] `tools\configure-env.bat` completed; Configuration Summary reviewed (secrets masked)
- [ ] `tools\db-safety.bat` PASS before Path A migrate (or covered by setup Path A)

## B. Package & identity

- [ ] Certified release package / installer for intended version (DEP-01)
- [ ] `VERSION.txt` / build identity recorded (DEP-02)
- [ ] Offline WinSW binary present in package (`tools\vendor\winsw\`) if service will be used
- [ ] Compatibility matrix filled ([FT-DEP-013](./FT-DEP-013_Version_Compatibility_Matrix.md))

## C. Install / setup

- [ ] Installation verification complete ([02](./checklists/02_Installation_Verification.md))
- [ ] `shared\.env` present and validated (secrets **not** copied into this form); **PORT** recorded
- [ ] Root URL returns Flowtix HTML shell (backend static hosting); LAN URL documented
- [ ] Optional Windows Service verified if used ([07](./checklists/07_Windows_Service_Verification.md)) — restart policy / health after start
- [ ] `verify-install` run — result: Pass / Fail / Skipped (exit 0 = API + UI OK)
- [ ] Diagnostics folder present under `logs\diagnostics\` (or intentionally skipped with `--skip-diagnostics`)
- [ ] Install recovery understood: file rollback only; **never** automatic DB rollback (FT-DEP-001 §37)
- [ ] Uninstall policy understood: preserve customer data by default; MySQL never deleted by installer

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
