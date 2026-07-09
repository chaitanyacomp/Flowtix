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

## Runtime

- [ ] Process running **or** service Running **or** start command documented
- [ ] LAN URL reachable: `http://<host>:<port>/`
- [ ] `GET /health` returns ok (or file-layout verify documented)
- [ ] Optional: `verify-install.bat --home <FT_ERP_HOME>` exit 0

## Logs / manifests

- [ ] `logs\setup.log` or installer log present (first install)
- [ ] `logs\SETUP_MANIFEST.json` entry if setup ran
- [ ] No accidental `.env` pasted into logs/tickets

**Result:** Pass / Fail  

**Operator:** _______________
