# Clean-Machine Deployment Certification — Flowtix ERP v1.0.0

| Field | Value |
|-------|-------|
| **Document** | Clean-Machine Certification Checklist |
| **Parent** | FT-DEP-001 §36–§38 · FT-DEP-011 |
| **Stable git** | `0a087ab` (Customer Delivery Package) |
| **Site / Lab PC** | |
| **Operator** | |
| **Date** | |

Use on a **clean Windows PC** (no prior Flowtix install). Do **not** paste passwords, full `shared\.env`, or production data into evidence packs.

**Severity key:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

**Final status options:** CERTIFIED · CERTIFIED WITH CONDITIONS · NOT CERTIFIED

---

## 0. Build identity (packager machine — before clean PC)

### 0.1 Rebuild certified artifacts (if VERSION.txt git ≠ HEAD)

```bat
cd /d <repo>
git log -1 --oneline
deployment\create-release.bat
deployment\installer\build-installer.bat
deployment\create-customer-media.bat
deployment\certify-customer-media.bat
```

| Expected | Evidence | Fail class | Troubleshoot |
|----------|----------|------------|--------------|
| `release\Flowtix-v1.0.0\VERSION.txt` `gitCommit=` matches `git rev-parse --short HEAD` | Copy VERSION.txt (no secrets) | 🟠 | Rebuild release |
| `certify-customer-media` exit 0 | Console log | 🔴 | Fix missing media files |

---

## 1. Clean installation (installer path)

### 1.1 Prerequisites on target PC

| Action | Expected | Evidence | Fail | Troubleshoot |
|--------|----------|----------|------|--------------|
| Windows 10/11 or Server; Admin rights | OK | `winver` screenshot | 🔴 | Upgrade OS |
| Node.js LTS on PATH | `node -v` / `npm -v` print versions | Text capture | 🔴 | Install Node LTS |
| MySQL 8+ running; `mysql` / `mysqldump` available | Version ≥ 8 | Text capture | 🔴 | Install/configure MySQL |
| Disk ≥ 10 GB free on install volume | Free space OK | Explorer/Properties | 🟠 | Free disk |

### 1.2 Install from customer media

```bat
REM From media root (Administrator)
01 Setup\Flowtix-ERP-Setup.exe
```

Choose dir (default `C:\FT-ERP`). Prefer tasks: install service + firewall when certifying service/LAN.

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Wizard completes; `{app}\releases\Flowtix-v1.0.0\` present | Dir listing | 🔴 | `logs\installer-*.log`; Inno log |
| If first install needs Path A: `shared\.env` must exist before migrate | See §2 | 🔴 | Run configure-env then re-run setup (§1.3) |

**Note:** Installer post-install runs `setup-flowtix` only when `shared\.env` + `app\server.js` + `web\index.html` are **not** already a complete install. First-time Path A typically needs configure-env before/during setup (see §2–3).

### 1.3 Manual Path A (authoritative if wizard skipped migrate)

```bat
set FT_ERP_HOME=C:\FT-ERP
set PACKAGE=%FT_ERP_HOME%\releases\Flowtix-v1.0.0

"%PACKAGE%\tools\install-validate.bat" --home "%FT_ERP_HOME%" --source "%PACKAGE%"
"%PACKAGE%\tools\configure-env.bat" --home "%FT_ERP_HOME%"
"%PACKAGE%\tools\setup-flowtix.bat" --home "%FT_ERP_HOME%" --source "%PACKAGE%" --yes --install-service --configure-firewall
```

Optional lab DB create: add `--create-db` to setup (or `SETUP_CREATE_DB=1`).

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| install-validate exit 0 (or FAIL report with corrective actions only) | `logs\install\install-validation-report.txt` | 🔴 | Fix FAIL items; re-run |
| configure-env writes `shared\.env` (secrets not logged) | Confirm file exists; **do not** attach .env | 🔴 | Re-run configure-env; check JWT length ≥ 16 |
| setup exit 0 or 8 (partial verify) | `logs\setup.log`, `logs\SETUP_MANIFEST.json` | 🔴 | install-recovery status/abort; FT-DEP-012 §7b |

---

## 2. Prerequisite detection

```bat
"%PACKAGE%\tools\install-validate.bat" --home "%FT_ERP_HOME%" --source "%PACKAGE%"
"%PACKAGE%\tools\check-prereqs.bat" --home "%FT_ERP_HOME%"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Node/npm/disk/Windows checks documented | validation report | 🟠 | Install missing prereqs |

---

## 3. MySQL connectivity & DB safety

```bat
"%PACKAGE%\tools\db-safety.bat" --home "%FT_ERP_HOME%"
REM optional first create:
"%PACKAGE%\tools\db-safety.bat" --home "%FT_ERP_HOME%" --create-db
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Exit 0; MySQL ≥ 8; DB exists; not blocked as `mini_erp` etc. | Console (no passwords) | 🔴 | Fix DATABASE_URL via configure-env; never use `--allow-dev-db` on customer |

Default production DB name example: `flowtix_erp` (`mysql://…@127.0.0.1:3306/flowtix_erp`).

---

## 4. Migrations

Applied by Path A setup / `migrate-db` as **`prisma migrate deploy` only**.

```bat
REM If verifying migrate alone (after backup gate):
"%PACKAGE%\tools\migrate-db.bat"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Migrate success in setup log / MIGRATION_MANIFEST | Manifest (no secrets) | 🔴 | Restore from pre-migrate backup (Mode B); never `migrate reset` / `db push` |

---

## 5. WinSW service

Service ID: **`FlowtixERP`** · Display name: **Flowtix ERP Backend** · Files: `{FT_ERP_HOME}\service\FlowtixERP.exe` + `.xml`

```bat
"%PACKAGE%\tools\service-status.bat" --home "%FT_ERP_HOME%"
"%PACKAGE%\tools\service-start.bat" --home "%FT_ERP_HOME%"
sc query FlowtixERP
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| State RUNNING | `sc query` text | 🔴 | `logs\service\`; re-run service-install; Node PATH; shared\.env |

---

## 6. Backend health

```bat
curl -s http://127.0.0.1:4000/health
REM PORT from shared\.env (default 4000)
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| JSON `ok: true`, `application: Flowtix ERP`, `version` set | Redacted health JSON | 🔴 | Service/logs; DB up |

---

## 7. Frontend & LAN access

```bat
"%PACKAGE%\tools\verify-install.bat" --home "%FT_ERP_HOME%"
"%PACKAGE%\tools\firewall-flowtix.bat" verify --home "%FT_ERP_HOME%"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| verify-install exit **0** | `logs\verify-install.log` | 🔴/🟠 | Exit 1 files · 2 backend · 3 UI · 4 version |
| Browser `http://127.0.0.1:<PORT>/` shows login HTML | Screenshot (no passwords) | 🔴 | Confirm `web\index.html`; static hosting |
| LAN `http://<hostname-or-IPv4>:<PORT>/` from second PC | Screenshot | 🟠 | firewall-flowtix add; LAN-ACCESS.txt |

---

## 8. Initial admin login

| Action | Expected | Evidence | Fail | Troubleshoot |
|--------|----------|----------|------|--------------|
| Sign in with site admin (not demo defaults on production) | Dashboard loads | Screenshot of shell (no password) | 🔴 | Users/seed; JWT; browser console |

Lab demo users (lab DB only): see media `03 Demo\DEMO_USERS.md` — **never** on customer production.

---

## 9. Customer delivery media completeness

On packager or USB copy:

```bat
deployment\certify-customer-media.bat
Get-FileHash -Algorithm SHA256 "customer-media\Flowtix-ERP-v1.0.0\01 Setup\Flowtix-ERP-Setup.exe"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Folders 01–10 + README; checksum match | SHA256SUMS line + Get-FileHash | 🟠 | Recreate media |

---

## 10. Database backup

```bat
set FT_ERP_HOME=C:\FT-ERP
"%FT_ERP_HOME%\tools\backup-db.bat"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| `backups\db\flowtix-db-backup-v*.sql` size &gt; 0 | Filename + size (not dump contents) | 🔴 | mysqldump on PATH; DATABASE_URL; exit 2/3 |
| `BACKUP_MANIFEST.json` success | Manifest excerpt | 🔴 | Re-run backup |

---

## 11. Database restore (Mode B — manual)

**No automated restore CLI in v1.0.0** (by design).

```bat
"%FT_ERP_HOME%\tools\service-stop.bat" --home "%FT_ERP_HOME%"
REM Manual (example — adjust user/host/db; do not log password):
mysql -h 127.0.0.1 -P 3306 -u <user> -p <db_name> < "C:\FT-ERP\backups\db\<backup-file>.sql"
"%FT_ERP_HOME%\tools\service-start.bat" --home "%FT_ERP_HOME%"
"%FT_ERP_HOME%\tools\verify-install.bat" --home "%FT_ERP_HOME%"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| verify-install 0 after restore; login works | Health + verify log | 🔴 | Confirm DB name matches DATABASE_URL; guide `05_Backup_and_Restore_Guide.md` |

---

## 12. Application upgrade

1. Place **new** certified package under `%FT_ERP_HOME%\releases\Flowtix-vX.Y.Z\` (keep prior).
2. From **new** package tools:

```bat
set FT_ERP_HOME=C:\FT-ERP
"<new-package>\tools\update-flowtix.bat" --home "%FT_ERP_HOME%" --source "<new-package>" --yes
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Backup → migrate → app/web replace; health OK | UPDATE logs / manifests | 🔴 | Do not re-run installer as wipe; FT-DEP-012 §5 |

For same-version certification without a newer build: document N/A **or** use a deliberately rebuilt package with bumped packaging metadata only when available.

---

## 13. Failed-upgrade rollback (Mode A — files)

```bat
"%FT_ERP_HOME%\tools\rollback-flowtix.bat" --home "%FT_ERP_HOME%" --yes
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Prior `app\`/`web\`/`VERSION.txt` restored from `releases\*-pre-update-*` | VERSION.txt before/after | 🔴 | Checklist `06_Rollback_Verification.md` |
| MySQL **not** auto-restored | backups\ untouched by rollback | — | Mode B if schema mismatch (§11) |

---

## 14. Uninstall behaviour

Run Windows “Apps & features” → Uninstall Flowtix ERP.

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Prompt: preserve customer data (default **Yes**) | Photo of dialog | 🟠 | Flowtix.iss policy |
| With Yes: `app\`/`web\`/`prisma` removed; `shared\`/`backups\`/`logs\` kept | Dir listing | 🔴 | Manual cleanup only if intentional |
| MySQL database **still exists** | `SHOW DATABASES` (names only) | 🔴 | Never accept auto DB drop |

---

## 15. Reinstall with existing database

1. Keep MySQL DB + preferably preserved `shared\.env`.
2. Run installer again to same `C:\FT-ERP` **or** extract Server ZIP + setup Path B/A carefully.
3. If `shared\.env` + app + web already present, post-install **skips** setup — use `update-flowtix` for binaries; ensure `DATABASE_URL` still points at existing DB.

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| App starts against existing data; no wipe | Login + one existing document | 🔴 | post-install.bat EXISTING_INSTALL_SKIP_SETUP; never migrate reset |

---

## 16. Diagnostics & support evidence

```bat
"%FT_ERP_HOME%\tools\collect-diagnostics.bat" --home "%FT_ERP_HOME%"
```

| Expected | Evidence | Fail | Troubleshoot |
|----------|----------|------|--------------|
| Folder under `logs\diagnostics\flowtix-diagnostics-*` with masked `summary.json` | Zip folder for ticket | 🟠 | Support Guide; never attach raw `.env` |

---

## Sign-off

| Gate | Pass / Fail / N/A | Notes |
|------|-------------------|-------|
| 1 Clean install | | |
| 2 Prerequisites | | |
| 3 MySQL / db-safety | | |
| 4 Migrations | | |
| 5 WinSW service | | |
| 6 Health | | |
| 7 Frontend / LAN | | |
| 8 Admin login | | |
| 9 Customer media | | |
| 10 Backup | | |
| 11 Restore (Mode B) | | |
| 12 Upgrade | | |
| 13 Rollback (Mode A) | | |
| 14 Uninstall | | |
| 15 Reinstall + existing DB | | |
| 16 Diagnostics | | |

**Certification decision:** □ CERTIFIED · □ CERTIFIED WITH CONDITIONS · □ NOT CERTIFIED

**Conditions / exceptions:** ________________________________

**Operator:** _______________ **Date:** ________
