# Checklist 05 — Update Verification

| Site | From version | To version | Date |
|------|--------------|------------|------|
| | | | |

Uses Batch 6 `update-flowtix`. Do **not** use installer as destructive re-bootstrap.

## Pre-update

- [ ] Users notified / freeze if needed
- [ ] New package path recorded
- [ ] Rollback owner named

## Execution

- [ ] `update-flowtix.bat --source <new> --home <FT_ERP_HOME>` (or tools from new package)
- [ ] Confirmation Current → Target reviewed
- [ ] Backup stage succeeded ([04](./04_Backup_Verification.md))
- [ ] Migrate stage succeeded (`MIGRATION_MANIFEST` / console)
- [ ] Only `app/` + `web/` replaced; `shared/` / `backups/` / `logs/` preserved
- [ ] Prior app/web archived under `releases\*-pre-update-*`
- [ ] Service stop/start skipped or succeeded (Batch 8 optional)

## Post-update

- [ ] `logs\update.log` RESULT=success
- [ ] `VERSION.txt` shows new version
- [ ] [03 Smoke](./03_Post_Install_Smoke.md) Pass
- [ ] Prior release folder still present

**Result:** Pass / Fail / Rolled back
