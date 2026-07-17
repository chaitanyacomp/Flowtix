# Administrator Guide — Flowtix ERP v1.0.0

This guide points administrators to the authoritative day-2 runbook.

**Primary reference:** FT-DEP-012 Administrator Runbook (`reference/FT-DEP-012_Administrator_Runbook.md`)

## Responsibilities

| Area | Tools / path |
|------|----------------|
| Start / stop | `tools\service-*.bat` or `node app\server.js` |
| Health | `GET /health`, `tools\verify-install.bat` |
| Firewall | `tools\firewall-flowtix.bat` |
| Backup | `tools\backup-db.bat` — see Backup Guide |
| Update | `tools\update-flowtix.bat` — see Upgrade Guide |
| Rollback (app/web) | `tools\rollback-flowtix.bat` |
| Diagnostics | `tools\collect-diagnostics.bat` |
| Users & roles | Settings → Users (ADMIN) |
| Company profile | Settings → Company Profile |

## Configuration

- Secrets live only in `shared\.env` — never email them.
- Guided editor: `tools\configure-env.bat` (masks passwords in summaries).

## Recovery

Install-file recovery: `tools\install-recovery.bat` (does **not** roll back MySQL).  
Database restore remains a manual SQL restore from `backups\db\` (Mode B).

Full procedures: FT-DEP-012 §§2–7.
