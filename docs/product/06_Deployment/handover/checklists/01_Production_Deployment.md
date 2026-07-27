# Checklist 01 — Production Deployment

| Site | Version | Date | Operator |
|------|---------|------|----------|
| | | | |

Follow FT-DEP-001 §18 / §19. Prefer Batch 9 setup or Batch 10 installer for first install; Batch 6 for updates.

## Pre-deploy

- [ ] Maintenance window announced (if users online)
- [ ] Certified package / installer verified
- [ ] `FT_ERP_HOME` path agreed
- [ ] MySQL database + user ready (empty or known baseline)
- [ ] `shared\.env` prepared for first install (or already present for update)
- [ ] Rollback owner named (Admin + Business Owner)
- [ ] Confirm WO numbering migration `20260727180000_work_order_flow_doc_numbering` is in the package (extends `DocSequence` enum; does **not** renumber existing WOs — see `docs/DOCUMENT_NUMBERING_WORK_ORDERS.md`)

## First install (Batch 9 / 10)

- [ ] `check-prereqs.bat --home <FT_ERP_HOME>` Pass (or warnings accepted)
- [ ] Installer **or** `setup-flowtix.bat --home … --source …` executed
- [ ] Live `app\server.js` + `web\index.html` under `FT_ERP_HOME` (wizard OK alone is insufficient)
- [ ] Path A (backup→migrate→baseline) **or** Path B (`--skip-migrate`) recorded
- [ ] Optional service: installed / skipped (circle one)
- [ ] Continue with [02 Installation Verification](./02_Installation_Verification.md)

## Update (Batch 6) — if not first install

- [ ] Use `update-flowtix.bat` (not destructive re-setup)
- [ ] Continue with [05 Update Verification](./05_Update_Verification.md)

## Close

- [ ] [03 Smoke](./03_Post_Install_Smoke.md) Pass
- [ ] [Deployment Report](../templates/Deployment_Report.md) started
- [ ] Result: Success / Failed / Rolled back

**Notes:**
