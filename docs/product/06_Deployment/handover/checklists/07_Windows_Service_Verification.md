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
- [ ] Logs under `logs\service\` writable / rolling (roll-by-size)
- [ ] XML has Automatic (delayed) start, onfailure restart, starttimeout/stoptimeout (Milestone 3)
- [ ] `FT_ERP_HOME` / working directory points at active `app\`
- [ ] Secrets **not** stored in service XML (app loads `shared\.env`)
- [ ] After start: `GET /health` ok (setup verifies when service installed)
- [ ] `service-stop` / `service-start` / `service-restart` exercised once in lab or controlled window
- [ ] Update/rollback stop→start behavior understood

## Failure

- [ ] If start fails after update: app/web may already be replaced — investigate; do not auto DB restore

**Result:** Pass / Fail / N/A
