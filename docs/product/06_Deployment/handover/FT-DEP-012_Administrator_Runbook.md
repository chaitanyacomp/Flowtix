# FT-DEP-012 — Administrator Runbook

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-012 |
| **Version** | 1.0.0 |
| **Parent** | FT-DEP-001 v1.10.0 |
| **Audience** | Customer System Administrator |

Day-2 operations for LAN Flowtix ERP. Tools live under `{FT_ERP_HOME}\tools\` or `releases\Flowtix-v*\tools\`.

## 1. Paths

| Item | Typical path |
|------|----------------|
| Install home | `C:\FT-ERP` (`FT_ERP_HOME`) |
| Secrets | `shared\.env` (never commit / never email) |
| Backups | `backups\db\` |
| Logs | `logs\` |
| Active app | `app\server.js` |
| UI | `http://<server-ip>:<PORT>/` (default PORT 4000) |

## 2. Start / stop

### Windows Service (if installed)

```bat
tools\service-status.bat --home C:\FT-ERP
tools\service-start.bat --home C:\FT-ERP
tools\service-stop.bat --home C:\FT-ERP
tools\service-restart.bat --home C:\FT-ERP
```

### Console (no service)

```bat
set FT_ERP_HOME=C:\FT-ERP
cd /d %FT_ERP_HOME%
node app\server.js
```

## 3. Health check

- Browser: open LAN URL; login as Admin  
- API: `GET http://127.0.0.1:<PORT>/health`  
- Read-only helper: `tools\verify-install.bat --home C:\FT-ERP`

## 4. Backup

```bat
tools\backup-db.bat
```

Confirm file size > 0 and `BACKUP_MANIFEST.json` success. Retain per site policy.

## 5. Update (Batch 6)

1. Place new package under `releases\Flowtix-vX.Y.Z\` (keep old folders).  
2. Run `tools\update-flowtix.bat` from the **new** package (or `--source`).  
3. Confirm backup → migrate → app/web replace.  
4. Smoke ([checklist 03](./checklists/03_Post_Install_Smoke.md)).  
5. Do **not** re-run installer as a wipe of a live site.

## 6. Rollback (Batch 7)

```bat
tools\rollback-flowtix.bat --home C:\FT-ERP
```

Restores prior `app\`/`web\` from `*-pre-update-*`. **Does not** restore MySQL automatically. If schema mismatch, restore SQL dump manually (Mode B).

## 7. First-time setup (reference)

Prefer Batch 10 installer or:

```bat
tools\setup-flowtix.bat --home C:\FT-ERP --source <package> --yes
```

Requires existing `shared\.env`. Path B: add `--skip-migrate`.

## 8. Escalation

Use [Support Escalation template](./templates/Support_Escalation.md). Never paste passwords.

## 9. Forbidden

- `prisma migrate reset` / `db push` on production  
- Deleting `shared\`, `backups\`, or DB to “fix” deploy  
- Running uncertified builds (DEP-08)
