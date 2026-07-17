# Acceptance — Recovery Checklist

- [ ] Install-recovery / update rollback procedure understood (files only; DB never auto-rolled back)
- [ ] If archive under `releases\Flowtix-v*` was wiped by a failed place-release: rebuild/reinstall from fixed installer — do not re-run setup against empty archive (FT-DEP-001 §34.3.1)
- [ ] Manual DB restore procedure documented for the site
- [ ] Service restart after simulated stop succeeds
- [ ] `verify-install` after recovery path

**Result:** Pass / Fail · **Operator:** ________
