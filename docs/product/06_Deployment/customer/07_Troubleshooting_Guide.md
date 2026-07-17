# Troubleshooting Guide — Flowtix ERP v1.0.0

| Symptom | Checks | Action |
|---------|--------|--------|
| Browser cannot connect | Service/process, PORT, firewall | `service-status`, `firewall-flowtix verify`, check `shared\.env` PORT |
| Login page missing / JSON at `/` | Static hosting / `web\index.html` | Confirm `web\` present; rebuild/reinstall package; `verify-install` |
| `/health` not ok | Backend crash, DB down | `logs\`, MySQL running, `DATABASE_URL` |
| Migrate failed | db-safety, backup gate | Read migrate log; fix DB; restore from backup if needed; never `migrate reset` |
| Service won't start | Node path, XML, deps | `service-install` after fix; check `logs\service\` |
| LAN clients blocked | Firewall / IP | Add rule; confirm hostname vs IPv4 |
| “CHANGE_ME” / env errors | Incomplete `.env` | `configure-env.bat` |

## Collect evidence

```bat
tools\collect-diagnostics.bat --home C:\FT-ERP
```

Zip the diagnostics folder for support. Passwords are masked — still avoid attaching raw `.env`.

## Escalation

See Support Guide and `06 Support\templates\Support_Escalation.md`.
