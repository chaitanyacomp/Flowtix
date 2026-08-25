# Acceptance — Backup Checklist

Use with [05_Backup_and_Restore_Guide.md](../05_Backup_and_Restore_Guide.md).

## Catalog & storage

- [ ] Admin **Backup & Restore** and CLI (`tools\backup-db.bat`) show the same successful backups
- [ ] Dump location recorded (typical `{FT_ERP_HOME}\backups\db\`) — no passwords on this form
- [ ] Dump file size &gt; 0; checksum present when expected
- [ ] Catalog / `BACKUP_MANIFEST.json` success; **no** password fields

## Automatic schedule & retention

- [ ] `tools\schedule-backup.bat verify --home "%FT_ERP_HOME%"` reports task **Flowtix-ERP-Daily-Backup** (default **02:00**)
- [ ] Understood retention for **AUTOMATIC** only: **14** daily / **8** weekly / **12** monthly
- [ ] Understood MANUAL / DEPLOYMENT / PRE_RESTORE_AUTO and latest success are **not** auto-purged

## Validation & warnings

- [ ] Admin warnings (e.g. zero users / zero active Admins) reviewed if shown
- [ ] At least one active Admin confirmed on the live system after backup

## Cleanup vs restore

- [ ] Understood: **cleanup / demo reset preserves users**; **full restore replaces users/data** and reverts passwords to the backup date

## Self-service restore awareness

- [ ] Safe restore phases / maintenance mode / forced re-login after success explained
- [ ] Automatic rollback and **emergency IT** condition (maintenance stays on) explained
- [ ] Legacy / unverified backups require **IT-assisted** restore (not Admin self-service)

## Optional drill

- [ ] Disposable-DB restore drill completed (or deferred with date): DB name ________ · Pass / Fail / N/A

**Result:** Pass / Fail · **Filename / backup id:** ________ · **Operator:** ________
