# Acceptance — Recovery Checklist

Use with [05_Backup_and_Restore_Guide.md](../05_Backup_and_Restore_Guide.md).

- [ ] Install-recovery / update **file** rollback understood (app/web); DB is not auto-rolled back by install-recovery
- [ ] If archive under `releases\Flowtix-v*` was wiped by a failed place-release: rebuild/reinstall from fixed installer — do not re-run setup against empty archive (FT-DEP-001 §34.3.1)
- [ ] **Safe Admin restore** procedure reviewed (maintenance mode, forced logout, API restart after success)
- [ ] Automatic **rollback** after failed target restore reviewed; **emergency** path (rollback fail → maintenance remains) escalates to IT
- [ ] IT-assisted / Mode B SQL restore documented for legacy or emergency cases
- [ ] Passwords revert to **backup-date** credentials after full restore — communicated to Admin
- [ ] Disposable-database restore drill Pass / Fail / Scheduled: ________
- [ ] Service restart after simulated stop succeeds
- [ ] `verify-install` after recovery path

**Result:** Pass / Fail · **Operator:** ________
