# FT-DEP-012 — Administrator Runbook

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-012 |
| **Version** | 1.3.0 |
| **Parent** | FT-DEP-001 v1.13.0 |
| **Audience** | Customer System Administrator |

Day-2 operations for LAN Flowtix ERP. Tools live under `{FT_ERP_HOME}\tools\` or `releases\Flowtix-v*\tools\` (copied from repo `deployment/` at packaging time).

## 1. Paths

| Item | Typical path |
|------|----------------|
| Install home | `C:\FT-ERP` (`FT_ERP_HOME`) |
| Secrets | `shared\.env` (never commit / never email) |
| Backups | `backups\db\` |
| Logs | `logs\` |
| Active app | `app\server.js` |
| Packaged UI | `web\` (served by backend in production) |
| Server URL | `http://127.0.0.1:<PORT>/` (this PC / shortcut) |
| LAN client URL | `http://<hostname-or-LAN-IPv4>:<PORT>/` |
| Port source | `shared\.env` → `PORT` (default **4000**) |

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

## 3. Health and UI check

- Browser (this server): `http://127.0.0.1:<PORT>/` — login page / Flowtix shell (HTML)
- Browser (LAN client): `http://<server-hostname-or-IPv4>:<PORT>/`
- API: `GET http://127.0.0.1:<PORT>/health` (JSON)
- Read-only helper (API + UI HTML, no auth):

```bat
tools\verify-install.bat --home C:\FT-ERP
```

Exit codes: `0` PASS · `1` missing files · `2` backend unavailable · `3` API OK but frontend unavailable · `4` version mismatch

## 3b. Firewall (LAN)

```bat
tools\firewall-flowtix.bat verify --home C:\FT-ERP
tools\firewall-flowtix.bat add --home C:\FT-ERP
tools\firewall-flowtix.bat remove
```

Idempotent rule name: `Flowtix ERP Backend`. Requires Administrator for add/remove. Manual fallback is printed by the helper.

## 4. Backup & restore

```bat
tools\backup-db.bat
tools\schedule-backup.bat verify --home C:\FT-ERP
```

- Unified Admin UI + CLI catalog under `backups\db\` (see customer Backup & Restore Guide).
- Daily task **Flowtix-ERP-Daily-Backup** at **02:00**; AUTOMATIC retention **14** daily / **8** weekly / **12** monthly.
- Confirm dump size &gt; 0, catalog/`BACKUP_MANIFEST.json` success, no password fields.
- Admin **safe restore** for eligible backups (maintenance mode, safety backup, verify, auto-rollback). Success forces re-login (session epoch) and API restart. Legacy/unverified → IT-assisted. Emergency if rollback fails → leave maintenance on, call IT.
- Cleanup/demo reset **preserves users**; full restore **replaces** users/passwords with the snapshot.

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

Restores prior `app\`/`web\` from `*-pre-update-*`. **Does not** restore MySQL by itself. If schema/data must be reverted, use Admin safe restore of the pre-update dump when eligible, otherwise IT-assisted SQL restore (Mode B).

## 7. First-time setup (reference)

Prefer Batch 10 installer or:

1. Validate environment (stops before place if FAIL):

```bat
tools\install-validate.bat --home C:\FT-ERP --source <package>
```

2. Guided configuration (never overwrite `.env` without confirm; passwords not printed):

```bat
tools\configure-env.bat --home C:\FT-ERP
```

3. Setup (Path A migrate, or Path B `--skip-migrate`):

```bat
tools\setup-flowtix.bat --home C:\FT-ERP --source <package> --yes
```

After Batch 10 install, `<package>` is normally `C:\FT-ERP\releases\Flowtix-vX.Y.Z` (same tree the installer extracted). Setup promotes `app`/`web` into `C:\FT-ERP\app` and `C:\FT-ERP\web` without refreshing that archive onto itself (FT-DEP-001 §34.3.1).

Optional flags: `--create-db`, `--install-service`, `--configure-firewall`, `--skip-diagnostics`, `--allow-dev-db` (lab only).

Requires existing `shared\.env` before setup. Database safety runs automatically before `prisma migrate deploy`.

**If the wizard finished but `C:\FT-ERP\app` / `web` are missing:**

1. Check `logs\installer-post.log` (`SETUP_EXIT`) and `logs\setup.log` (place-release).
2. Check whether the archive survived: `dir C:\FT-ERP\releases\Flowtix-v1.0.0\app\server.js`.
3. If the archive is **intact**, re-run setup with `--source` = that folder (fixed tools required).
4. If the archive is **wiped**, uninstall/remove the broken home and install a **rebuilt** setup EXE — do not certify a hand-copied script alone (FT-DEP-001 §34.3.1 / §35.4.2).
5. Confirm live `app\server.js` before installing the Windows service.

## 7b. Installation recovery

If setup fails mid-way, files may be restored via the install transaction (DB is **not** rolled back):

```bat
tools\install-recovery.bat status --home C:\FT-ERP
tools\install-recovery.bat abort --home C:\FT-ERP --reason "operator abort"
```

On a **fresh** install abort, partial `app`/`web` trees are removed (expected). The release under `releases\` must remain intact so setup can be re-run. App/web rollback after a successful update still uses `rollback-flowtix` (Batch 7). Manual SQL restore is Mode B if schema must be reverted.

## 7c. Diagnostics bundle

```bat
tools\collect-diagnostics.bat --home C:\FT-ERP
```

Creates a ZIP-ready folder under `logs\diagnostics\` with versions, service state, health, migrations, logs, and a **masked** configuration summary. Attach this folder (zipped) to support tickets — never paste `.env`.

## 7d. Windows Service recovery

Service XML uses Automatic (delayed) start, restart-on-failure (5s/10s/30s), start timeout 60s, stop timeout 30s, and roll-by-size logs under `logs\service\`.

```bat
tools\service-status.bat --home C:\FT-ERP
tools\service-restart.bat --home C:\FT-ERP
tools\verify-install.bat --home C:\FT-ERP
```

If the service fails to start: check `logs\service\`, `shared\.env` presence, `app\server.js`, Node on PATH, then re-run `service-install.bat` after fixing dependencies.

## 7e. Safe uninstall

Uninstaller removes application binaries by default and **asks** whether to preserve `shared\`, `backups\`, and `logs\`. Default = preserve. **MySQL is never deleted** by the Flowtix uninstaller.

## 8. Admin database reset (Settings)

Destructive Admin tools (Reset Transaction Data, Reset NO_QTY Data, MPRS Test Reset, Full Demo Reset) delete transactional rows only (masters preserved on transaction/NO_QTY paths).

**Canonical SSOT:** `backend/src/services/cleanup/cleanupRegistry.js`
NO_QTY recovery cleanup runs through `noQtyRecoveryCleanupService` using the registry recovery cluster (do not invent local delete sequences).

Child-first recovery order (Phase 2B):

1. `NoQtyRsItemRecoveryDecisionLine`
2. `NoQtyRsItemRecoveryDecision`
3. `RecoveryAllocation`
4. `NoQtySoWaiverLine`
5. `NoQtySoWaiver`
6. `NoQtyAcceptedFgDisposition`
7. `CarryForwardPending`
8. `ProductionShortfallResolution`

Do **not** change Prisma `onDelete: Restrict` to Cascade to “fix” reset. Confirm text gates remain required (`RESET`, `RESET MPRS`, etc.).

**Developer / CI checks**

```bash
cd backend
npm run verify:cleanup-dependencies
npm run test:cleanup
```

When a migration adds a transactional model or Restrict FK (especially `recoverySourceId`), update the cleanup registry until `verify:cleanup-dependencies` passes.

CLI reset: `npm run reset:transactions` (same path as Settings → Reset Transaction Data).

## 8b. Customer delivery media (Milestone 4)

Commercial USB/ISO-style pack is built with:

```bat
deployment\create-customer-media.bat
```

Output: `customer-media\Flowtix-ERP-vX.Y.Z\` (numbered folders 01–10).
Certify: `deployment\certify-customer-media.bat`.
Customer guides live under `docs\product\06_Deployment\customer\` (copied into media `02 Documentation`).

## 9. Escalation

Use [Support Escalation template](./templates/Support_Escalation.md). Never paste passwords.
Support placeholders: `support@flowtix.example` · `https://www.flowtix.example` (replace per contract).

## 10. Forbidden

- `prisma migrate reset` / `db push` on production
- Deleting `shared\`, `backups\`, or DB to “fix” deploy
- Running uncertified builds (DEP-08)
