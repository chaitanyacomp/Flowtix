# Checklist 07 — Windows Service Verification

| Site | Date | Operator |
|------|------|----------|
| | | |

Optional Batch 8 WinSW. Sites **MAY** run without a service.

## If service not used

- [ ] N/A — console / Task Scheduler start documented in runbook
- [ ] Stop here (Pass as N/A)

## If service used

- [ ] `service-status.bat --home <FT_ERP_HOME>` shows present
- [ ] State = Running (or Start Pending then Running)
- [ ] `service\` contains wrapper/XML under FT home (or documented path)
- [ ] Logs under `logs\service\` writable / rolling
- [ ] `FT_ERP_HOME` / working directory points at active `app\`
- [ ] Secrets **not** stored in service XML (app loads `shared\.env`)
- [ ] `service-stop` / `service-start` / `service-restart` exercised once in lab or controlled window
- [ ] Update/rollback stop→start behavior understood

## Failure

- [ ] If start fails after update: app/web may already be replaced — investigate; do not auto DB restore

**Result:** Pass / Fail / N/A
