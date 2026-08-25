# Checklist 04 — Backup Verification

| Site | Date | Operator |
|------|------|----------|
| | | |

Unified Admin UI + CLI catalog. See customer [05_Backup_and_Restore_Guide.md](../../customer/05_Backup_and_Restore_Guide.md).

## Pre-change / baseline

- [ ] `tools\backup-db.bat` (or via setup/update) completed exit 0 **or** Admin manual backup Created
- [ ] File under `{FT_ERP_HOME}\backups\db\` (record relative path / filename: _______________)
- [ ] File size &gt; 0 bytes (record size: _______________)
- [ ] Catalog entry and/or `BACKUP_MANIFEST.json` success; **no** password fields
- [ ] User count / active Admin count / warnings reviewed in Admin UI when available
- [ ] Backup filename or catalog id recorded in deploy log / report: _______________

## Automatic schedule

- [ ] `tools\schedule-backup.bat verify --home "%FT_ERP_HOME%"` — task **Flowtix-ERP-Daily-Backup** present (default **02:00**)
- [ ] Retention understood: AUTOMATIC **14** daily / **8** weekly / **12** monthly; MANUAL/DEPLOYMENT/PRE_RESTORE_AUTO protected

## Gate rules

- [ ] Understood: no verified backup → no migrate / no update continue
- [ ] Freshness window for migrate gate known (default 60 min)

## Restore readiness (awareness)

- [ ] Full restore replaces users/data; passwords revert to backup date
- [ ] Cleanup preserves users (not a substitute for restore testing)
- [ ] Safe restore + rollback + emergency IT condition briefed
- [ ] Legacy/unverified → IT-assisted only

## Retention / offsite

- [ ] Pre-update / MANUAL backups retained per site policy
- [ ] Operator will not manually purge protected types to “make space” without IT review

**Result:** Pass / Fail
