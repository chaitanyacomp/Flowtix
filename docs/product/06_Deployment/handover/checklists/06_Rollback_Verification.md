# Checklist 06 — Rollback Verification

| Site | From version | To version | Date |
|------|--------------|------------|------|
| | | | |

Uses Batch 7 `rollback-flowtix` (Mode A — app/web). DB restore remains **manual** (Mode B).

## Preconditions

- [ ] `releases\*-pre-update-*` archive exists with `app\` + `web\`
- [ ] Related backup filename noted (from update log / BACKUP_MANIFEST): _______________
- [ ] Authority to rollback confirmed (Admin + Business Owner)

## Execution (Mode A)

- [ ] `rollback-flowtix.bat --home <FT_ERP_HOME> [--yes]`
- [ ] Service stopped if present; restored; started if present
- [ ] Active `app\` / `web\` match archive
- [ ] `VERSION.txt` restored to prior version
- [ ] `shared\.env` unchanged
- [ ] `backups\` unchanged (no auto DB restore)
- [ ] Archive folder **not** deleted
- [ ] `logs\rollback.log` and `ROLLBACK_MANIFEST.json` updated

## Mode B (if schema/data mismatch)

- [ ] Manual SQL restore of related dump planned/executed (out of Batch 7 automation)
- [ ] Re-smoke after restore

## Post-rollback

- [ ] [03 Smoke](./03_Post_Install_Smoke.md) Pass or Fail recorded
- [ ] Business Owner informed

**Result:** Pass / Fail  

**Mode used:** A / B / Forward-fix
