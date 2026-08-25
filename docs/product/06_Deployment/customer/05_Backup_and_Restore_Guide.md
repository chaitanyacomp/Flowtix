# Backup & Restore Guide — Flowtix ERP v1.0.0

Authoritative day-2 procedures for database backup, schedule, retention, and **safe Admin restore**.
Related forms: [acceptance/04_Backup_Checklist.md](./acceptance/04_Backup_Checklist.md), handover [04_Backup_Verification.md](../handover/checklists/04_Backup_Verification.md).

**Never** use `prisma migrate reset` or `db push` on production.
**Never** paste `DATABASE_URL`, passwords, or `.env` contents into tickets or chat.

---

## 1. Unified catalog and storage

Admin UI (**Settings → Backup & Restore**) and CLI (`tools\backup-db.bat`) share one **catalog** and one **storage root**:

| Kind | How created | Notes |
|------|-------------|--------|
| **MANUAL** | Admin UI or CLI without `--automatic` | Operator-owned; retention does **not** auto-delete |
| **AUTOMATIC** | Daily scheduled task (`--automatic`) | Subject to retention (below) |
| **DEPLOYMENT** | Pre-update / deploy tooling | Protected from automatic retention purge |
| **PRE_RESTORE_AUTO** | Created automatically before a restore | Rollback-only — not an Admin self-service restore target |

Both surfaces register the same `.sql` files and metadata (size, checksum when available, user/Admin counts, warnings). Prefer the Admin catalog for day-to-day visibility; use CLI for schedules, gates, and offline ops.

### Storage and logs (no secrets)

Assume install home `FT_ERP_HOME` (example: `C:\FT-ERP`). Paths may differ if `BACKUP_STORAGE_DIR` is set at install — record the site path in the handover pack.

| Item | Typical location |
|------|------------------|
| SQL dumps + catalog files | `{FT_ERP_HOME}\backups\db\` (year\month subfolders for newer dumps) |
| Legacy CLI manifest | `{FT_ERP_HOME}\backups\db\BACKUP_MANIFEST.json` |
| Cross-process backup/restore lock | `{FT_ERP_HOME}\shared\locks\backup-job.lock` |
| Maintenance / restore status / auth epoch | `{FT_ERP_HOME}\shared\` (`maintenance-mode.json`, `restore-status.json`, `auth-session-epoch.json`) |
| Restore / ops logs | `{FT_ERP_HOME}\logs\` (including `restore.log` when present) |
| Deploy / service logs | `{FT_ERP_HOME}\logs\deploy\`, `{FT_ERP_HOME}\logs\service\` |

These files must **not** contain database passwords. Do not email lock/status JSON with site diagnostics unless secrets are confirmed absent.

---

## 2. Creating a backup

### CLI (manual / deploy)

```bat
set FT_ERP_HOME=C:\FT-ERP
"%FT_ERP_HOME%\tools\backup-db.bat"
```

(If `tools\` lives under the active home, running from that folder also resolves `FT_ERP_HOME` automatically.)

- Confirm dump file size &gt; 0.
- Confirm catalog / `BACKUP_MANIFEST.json` success (no password fields).
- Take a verified backup **before** every production update.

### Admin UI

Admin → **Backup & Restore** → create manual backup. Review size, checksum, user/Admin counts, and any validation warnings before relying on the file.

### Automatic daily backup

Production installs register Windows task **`Flowtix-ERP-Daily-Backup`**, default **02:00** local time, running as **SYSTEM** with `backup-db.bat --automatic` (no credentials in the task XML).

---

## 3. Schedule install / verify / remove

```bat
set FT_ERP_HOME=C:\FT-ERP
"%FT_ERP_HOME%\tools\schedule-backup.bat" install --home "%FT_ERP_HOME%"
"%FT_ERP_HOME%\tools\schedule-backup.bat" verify --home "%FT_ERP_HOME%"
"%FT_ERP_HOME%\tools\schedule-backup.bat" remove --home "%FT_ERP_HOME%"
```

- Optional time: `install --home … --time 02:00` (default **02:00**).
- Development / repo homes skip install unless forced (`--force` / documented env override).
- Setup expects a verified schedule on production Windows; updates warn if reinstall fails but an operational task remains.
- Admin UI schedule panel reflects the same task status (when the API can read it).

---

## 4. Retention (AUTOMATIC only)

Default policy for **AUTOMATIC** backups:

| Bucket | Keep |
|--------|------|
| Daily | **14** latest daily points |
| Weekly | **8** weekly points |
| Monthly | **12** monthly points |

**Always preserved (not purged by retention):**

- **MANUAL**, **DEPLOYMENT**, **PRE_RESTORE_AUTO**
- Latest successful backup (any type)
- **FAILED** catalog rows (remain visible for diagnosis)

Operator-owned offsite copies remain a site policy.

---

## 5. Backup validation and Admin warnings

At backup time the product records:

- File size and SHA-256 checksum (when hashing succeeds)
- Live **user count** and **active Admin** count

Admin UI may show warnings such as:

- **ZERO_USERS** — database had no users at backup time
- **ZERO_ACTIVE_ADMINS** — no active Admin at backup time

Treat warned backups as high risk. Prefer a fresh manual backup after confirming at least one active Admin exists.

---

## 6. Cleanup vs restore (users)

| Action | Users / passwords |
|--------|-------------------|
| **Admin database cleanup / demo reset** (transaction cleanup) | **Preserves** user accounts and login credentials |
| **Full database restore** | **Replaces** users and all business data with the backup snapshot |

Do not confuse cleanup with restore. Only restore rewinds accounts to the backup date.

---

## 7. Safe Admin restore (self-service)

Eligible backups: **MANUAL**, **AUTOMATIC**, or **DEPLOYMENT** with status **Created**, valid size/checksum, and at least one user + one active Admin in metadata.

**PRE_RESTORE_AUTO** is for automatic rollback only — not selectable as a normal restore target.

**Legacy / unverified** backups (missing checksum or user/Admin metadata) require **IT-assisted** restore — do not use self-service.

### What a full restore does

1. Replaces the **entire** live MySQL database with the selected dump.
2. **Users and passwords revert to the backup-date credentials** — anyone whose password changed after the backup must use the old password (or Admin reset after login).
3. Business data (orders, stock, masters in DB, etc.) matches the snapshot.

### Phases (high level)

1. **PRECHECK** — file integrity / eligibility
2. **SAFETY_BACKUP** — automatic **PRE_RESTORE_AUTO** dump of current DB
3. **RESTORING** — import selected backup
4. **VERIFYING** — independent connectivity + core tables (`User`, migrations) + Admin/user checks
5. **COMPLETED** — or **ROLLING_BACK** / **FAILED**

### Maintenance mode and forced logout

- While restore runs, ERP enters **maintenance mode**: only health and **restore-status** remain available.
- On **successful** restore: maintenance clears, **auth session epoch** bumps → **all prior JWTs invalid** → users must sign in again; **API restart** is required.
- Poll progress: Admin → Backup & Restore restore status (or `GET /api/admin/backups/restore-status` while authenticated).

### Automatic rollback

If the selected restore fails **after** a validated safety backup:

- Product imports the **PRE_RESTORE_AUTO** safety dump.
- On successful rollback verification: previous data is recovered, maintenance clears, outcome indicates restore failed but data recovered. Restart and sign in again as instructed.
- The UI must **not** report a successful restore of the selected target.

### Emergency IT condition

If **primary restore fails and automatic rollback also fails**:

- **Maintenance mode stays active**
- Restore status is marked **emergency**
- Stop all ERP use and contact IT immediately — do **not** clear maintenance mode manually

---

## 8. Manual / IT-assisted restore (Mode B)

Use when self-service is blocked (legacy backup, emergency, or IT policy):

1. Stop the Windows Service / Node process.
2. Restore the `.sql` dump with MySQL client tools into the **correct** target database (confirm name — never guess).
3. Confirm `DATABASE_URL` still points at that database (do not print the URL in logs you share).
4. Start service; run `verify-install` and smoke tests.
5. Ensure users can sign in (passwords match the dump).

App/web file rollback (not database): `tools\rollback-flowtix.bat` — see Upgrade Guide.

---

## 9. Customer daily / weekly verification checklist

### Daily (or next business morning after 02:00)

- [ ] Automatic task present: `schedule-backup.bat verify --home "%FT_ERP_HOME%"`
- [ ] Newest **AUTOMATIC** (or overnight) backup in Admin catalog: size &gt; 0, status Created
- [ ] No unexplained **FAILED** overnight row (investigate if present)
- [ ] Disk free space adequate under `backups\db\`

### Weekly

- [ ] Spot-check checksum / warnings on latest automatic and one recent manual backup
- [ ] Confirm at least one **active Admin** still exists in the live system
- [ ] Confirm offsite / secondary copy policy (if used) received last week’s dumps
- [ ] Review Admin schedule panel / last run time
- [ ] Skim `logs\` for restore or backup errors (no secrets in tickets)

---

## 10. Restore drill (disposable database only)

Practice recovery **without** touching the live customer database.

1. Create an explicitly named **disposable** MySQL database (example pattern: `ft_restore_drill_YYYYMMDD`). **Never** use the live `erp` (or production) database name.
2. Point a **temporary** connection only at that disposable DB (keep production `DATABASE_URL` unchanged in `shared\.env`).
3. Load schema as for a lab install, seed a known Admin + marker rows if needed.
4. Take a validated backup of the disposable DB; mutate data; restore that backup through Admin restore **or** IT-assisted import aimed **only** at the disposable DB.
5. Verify Admin, users, and markers returned; confirm maintenance clears after success.
6. Optionally rehearse a corrupt-file failure and confirm automatic rollback on the disposable DB.
7. **Drop only** the disposable database(s) you created. Do not drop `erp` or other site databases.

Record date, operator, disposable DB name, and Pass/Fail on the acceptance backup/recovery forms.

---

## 11. Related documents

| Document | Role |
|----------|------|
| [acceptance/04_Backup_Checklist.md](./acceptance/04_Backup_Checklist.md) | Acceptance sign-off |
| [acceptance/05_Recovery_Checklist.md](./acceptance/05_Recovery_Checklist.md) | Recovery acceptance |
| [11_Known_Limitations.md](./11_Known_Limitations.md) | Current restore limits |
| Handover [04_Backup_Verification.md](../handover/checklists/04_Backup_Verification.md) | Partner verification |
| FT-PD-093 (architecture) | Resilience governance |
| FT-DEP-012 Administrator Runbook | Day-2 ops companion |
