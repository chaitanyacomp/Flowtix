# Checklist 04 — Backup Verification

| Site | Date | Operator |
|------|------|----------|
| | | |

Uses Batch 4 `backup-db` / `BACKUP_MANIFEST.json`. Never delete backups automatically.

## Pre-change / baseline

- [ ] `tools\backup-db.bat` (or via setup/update) completed exit 0
- [ ] File under `backups\db\` named `flowtix-db-backup-v…-YYYYMMDD-HHMMSS.sql`
- [ ] File size &gt; 0 bytes (record size: _______________)
- [ ] `backups\db\BACKUP_MANIFEST.json` has matching `status: success`
- [ ] Manifest entry has **no** password fields
- [ ] Backup filename recorded in deploy log / report: _______________

## Gate rules

- [ ] Understood: no backup → no migrate (Batch 5) / no update continue (Batch 6)
- [ ] Freshness window for migrate gate known (default 60 min)

## Retention

- [ ] Pre-update backups retained per site policy
- [ ] Operator will **not** auto-purge via deploy scripts (Batch 4 safety)

**Result:** Pass / Fail
