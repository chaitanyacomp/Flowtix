# Checklist 02 — Installation Verification

| Site | FT_ERP_HOME | Version | Date |
|------|-------------|---------|------|
| | | | |

Technical checks after Batch 9 setup or Batch 10 installer. Do **not** print secrets.

## Folder layout (FT-DEP-001 §6)

- [ ] `shared\` exists
- [ ] `shared\.env` exists (do not open in tickets)
- [ ] `backups\db\` exists
- [ ] `logs\` writable (`app`, `deploy`, `service` as applicable)
- [ ] `releases\` contains package and/or pre-update archives
- [ ] Active `app\server.js` present
- [ ] Active `web\index.html` present
- [ ] `VERSION.txt` present; productVersion = _______________

## Tools

- [ ] `tools\backup-db.bat` present
- [ ] `tools\migrate-db.bat` present
- [ ] `tools\update-flowtix.bat` present
- [ ] `tools\rollback-flowtix.bat` present
- [ ] `tools\setup-flowtix.bat` present (or under `releases\…\tools\`)
- [ ] `tools\service-status.bat` present (if service used)
- [ ] `tools\firewall-flowtix.bat` present
- [ ] `tools\vendor\winsw\WinSW-x64.exe` present (offline service)
- [ ] `tools\install-validate.bat` present
- [ ] `tools\configure-env.bat` present
- [ ] `tools\db-safety.bat` present
- [ ] `tools\install-recovery.bat` present
- [ ] `tools\collect-diagnostics.bat` present

## Pre-install / config (Milestone 3)

- [ ] `install-validate` report PASS (or FAIL items fixed before place)
- [ ] `configure-env` Configuration Summary accepted (secrets masked)
- [ ] Path A: `db-safety` PASS (or setup Path A completed without db-safety FAIL)

## Runtime

- [ ] Process running **or** service Running **or** start command documented
- [ ] Server URL: `http://127.0.0.1:<port>/` returns **HTML** Flowtix shell (not API JSON)
- [ ] LAN URL reachable: `http://<hostname-or-LAN-IPv4>:<port>/` (same SPA)
- [ ] SPA refresh works (e.g. open `/dashboard` directly)
- [ ] `GET /health` returns ok JSON
- [ ] `/api/*` still JSON (not SPA HTML)
- [ ] `verify-install.bat --home <FT_ERP_HOME>` exit **0** (checks health + UI HTML)
- [ ] Firewall rule present **or** documented exception (`firewall-flowtix.bat verify`)
- [ ] If service used: Automatic (delayed) + restart-on-failure; health OK after start

## Logs / manifests

- [ ] `logs\setup.log` or installer log present (first install)
- [ ] `logs\SETUP_MANIFEST.json` entry if setup ran
- [ ] `logs\install\install-validation-report.txt` present if validate ran
- [ ] `logs\diagnostics\flowtix-diagnostics-*` present (or skip documented)
- [ ] No accidental `.env` pasted into logs/tickets

**Result:** Pass / Fail  

**Operator:** _______________
