# Troubleshooting Guide — Flowtix ERP v1.0.0

| Symptom | Checks | Action |
|---------|--------|--------|
| Browser cannot connect | Service/process, PORT, firewall | `service-status`, `firewall-flowtix verify`, check `shared\.env` PORT |
| Login page missing / JSON at `/` | Static hosting / `web\index.html` | Confirm **live** `web\` under `FT_ERP_HOME` (not only under `releases\`); `verify-install` |
| Wizard finished but no `C:\FT-ERP\app` or `web` | Place-release / post-install | See **Installer runtime missing** below |
| `/health` or `/api/health` not ok | Backend crash, DB down | `logs\`, MySQL running, `DATABASE_URL` |
| Migrate failed | db-safety, backup gate | Read migrate log; fix DB; restore from backup if needed; never `migrate reset` |
| Service won't start / `sc query` 1060 | Runtime missing, Node path, XML | Confirm live `app\server.js` first; then `service-install`; check `logs\service\` |
| LAN clients blocked | Firewall / IP | Add rule; confirm hostname vs IPv4 |
| “CHANGE_ME” / env errors | Incomplete `.env` | `configure-env.bat` |
| `Existing install detected — skipping setup` | Complete install already present | Use `update-flowtix` for upgrades (Batch 6), not re-bootstrap |

## Installer runtime missing (archive self-wipe / bootstrap failure)

**Symptoms (fixed in FT-DEP-001 v1.14+ installer builds):**

- `C:\FT-ERP\releases\Flowtix-v1.0.0\` may look complete **or** may have empty `app`/`web` after a wipe
- Live `C:\FT-ERP\app` and `C:\FT-ERP\web` missing
- `sc query FlowtixERP` → FAILED 1060
- Wizard still said “installed”
- Manual setup may log `app\server.js missing after place`

**Root cause (pre-fix):** Inno → `post-install` → `setup-flowtix` with `--source` = `{home}\releases\Flowtix-vX`. `placeRelease` refreshed that archive onto itself (`replaceTree` cleared destination = source), destroying the payload before promotion. Fresh-install recovery then removed any partial live runtime. Service install never ran. Inno still reported success because extraction succeeded.

**Immediate recovery on a broken machine:**

1. Check whether the archive is still intact:

```bat
dir C:\FT-ERP\releases\Flowtix-v1.0.0\app\server.js
dir C:\FT-ERP\logs\installer-post.log
dir C:\FT-ERP\logs\setup.log
```

2. If the archive **is wiped** (missing `app\server.js` under `releases\`): uninstall / remove the broken home, keep MySQL + a copy of `shared\.env`, then install a **rebuilt** `Flowtix-Setup-v1.0.0.exe` (do not rely on hand-copying one script for certification).
3. If the archive is **intact** but live runtime is missing, with a fixed `setup-flowtix.js` already in tools:

```bat
set FT_ERP_HOME=C:\FT-ERP
set PACKAGE=%FT_ERP_HOME%\releases\Flowtix-v1.0.0
"%PACKAGE%\tools\setup-flowtix.bat" --home "%FT_ERP_HOME%" --source "%PACKAGE%" --yes --install-service
```

4. Pass criteria after repair/reinstall:

```bat
dir C:\FT-ERP\app\server.js
dir C:\FT-ERP\web\index.html
dir C:\FT-ERP\releases\Flowtix-v1.0.0\app\server.js
type C:\FT-ERP\logs\installer-post.log
sc query FlowtixERP
curl http://localhost:4000/api/health
```

`installer-post.log` must show `SETUP_EXIT=0`. Prefer also confirming `setup.log` contains `source=install-archive; skip self-refresh` and that the archive file still exists after promotion.

Normative detail: FT-DEP-001 §34.3.1 / §35.4.1–§35.4.2.

## Collect evidence

```bat
tools\collect-diagnostics.bat --home C:\FT-ERP
```

Zip the diagnostics folder for support. Passwords are masked — still avoid attaching raw `.env`.

## Escalation

See Support Guide and `06 Support\templates\Support_Escalation.md`.
