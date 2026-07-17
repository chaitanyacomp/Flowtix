# Upgrade Guide — Flowtix ERP v1.0.0

## Standard update (Batch 6)

1. Place the new certified package under `releases\Flowtix-vX.Y.Z\`.
2. Take a fresh backup: `tools\backup-db.bat`.
3. From the **new** package tools:

```bat
tools\update-flowtix.bat --home C:\FT-ERP --source <new-package>
```

4. Confirm backup → migrate deploy → app/web replace.
5. Smoke test (login, dashboard, one document path, `verify-install`).

## Rollback (app/web)

```bat
tools\rollback-flowtix.bat --home C:\FT-ERP
```

Restores prior `app\` / `web\` from pre-update archive. **Does not** auto-restore MySQL. If schema must revert, restore SQL dump manually.

## Do not

- Re-run the Windows installer as a wipe of a live site (post-install skips when `shared\.env` + live `app` + `web` already exist).
- Skip backup before migrate.
- Apply uncertified builds.
- Use a wiped `releases\Flowtix-vX` folder as `--source` for setup or update — if `releases\…\app\server.js` is missing, obtain a rebuilt package / installer first (FT-DEP-001 §34.3.1 recovery).

Details: FT-DEP-001 Batches 6–7; FT-DEP-012; checklists 05–06.
