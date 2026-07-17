# Backup & Restore Guide — Flowtix ERP v1.0.0

## Backup (supported)

```bat
tools\backup-db.bat
```

- Output: `backups\db\` + `BACKUP_MANIFEST.json`
- Confirm file size &gt; 0 and manifest status success
- Retain per site policy (daily recommended before updates)

Checklist: handover `checklists/04_Backup_Verification.md` (also covered in acceptance).

## Restore (manual — Mode B)

Automated CLI restore is **not** shipped in v1.0.0.

1. Stop the Windows Service / Node process.
2. Restore the `.sql` dump with MySQL tools into the target database.
3. Confirm `DATABASE_URL` still points at the restored database.
4. Start service; run `verify-install` and smoke tests.

App/web file rollback (not database): `tools\rollback-flowtix.bat` — see Upgrade Guide.

**Never** use `prisma migrate reset` or `db push` on production.
