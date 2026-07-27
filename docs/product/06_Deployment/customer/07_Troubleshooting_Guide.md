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
| Tally Preview 500: `Cannot find module './mapLedgerToParty'` | Old packaged `server.js` (pre-v1.14.2) | Rebuild/reinstall fixed release (FT-DEP-001 §28.5.1). Do not hand-patch `C:\FT-ERP\app` |
| Control Tower 500: `Prisma.Decimal is not a constructor` | Bare `@prisma/client` Decimal in old bundle | Rebuild/reinstall fixed release (§28.5.1) |
| Tally Master import / localhost:9000 | Same-PC Tally | No separate Tally HTTP proxy required when Tally and Flowtix backend run on the same PC and `http://localhost:9000` responds |
| `backup-db` shows `home=C:\` / DATABASE_URL not set | Old tools home detection | Rebuild/reinstall v1.14.3+; from `C:\FT-ERP\tools` home must resolve to `C:\FT-ERP`. Optional: `set FT_ERP_HOME=C:\FT-ERP` |
| Wrong password shows “Session expired” | Old UI mapped all 401s to session loss | Rebuild/reinstall v1.14.3+; login failures show “Invalid email or password” |
| No way to reset store@… password | Pre-Users UI build | Admin → Settings → **Users** (v1.14.3+); or re-seed role accounts via backend startup helper |
| Dashboard “Issue RM” opens empty Material Issue | Stale eligibility / awaiting release | Rebuild/reinstall v1.14.3+; Issue RM only for pending PMR; awaiting release uses Production Release |
| Material Issue shows excess above BOM + Add Qty | Issue Now exceeds applicable BOM + Add Qty for this fill | Reduce Issue Now or revise Add Qty; planned allowance is not wastage |
| Allowance above 5% cannot be issued by Store | Async Admin approval required | Enter reason → **Send for Admin Approval** → continue other WOs → after Admin approves in Pending Actions, open **Approved · Ready to Issue** and Issue Material. Above 10% use Additional RM Issue |
| Side queue still shows Approval Pending after Admin approved | Store list not refreshed | Open Pending Actions → **RM Allowance Approved** (or refresh Material Issue). Deep link uses `bucket=approved` |
| Partially issued WO still appears under Ready to Issue | Queue should use Partially Issued tab | Use Pending Actions **Continue RM Issue** (`bucket=partiallyIssued`) or the Partially Issued tab. Ready holds only WOs with nothing issued yet |
| Pending Actions opens Material Issue but wrong/empty Ready queue | Open List dropped the bucket | Links must keep `bucket=…`; Open List shows that queue’s cards without requiring SO/WO/PMR re-selection |
| Qty (BOM) looked like remaining balance | Older display used remaining entitlement as Qty (BOM) | Qty (BOM) is original requirement; use **Remaining** for the unissued balance |
| Theoretical RM appears to include runner twice | Runner was added outside canonical BOM quantity | Theoretical RM already includes runner. Do not add runner again in Planned Allowance |
| Work Order Planning loops “Updating RM…” / qty fields reset | Live RM preview was bumping ERP refresh | Source fix: exclude `/execution/rm-preview` from refresh scopes; preserve typed drafts. Rebuild frontend/package when shipping |
| Active Production still shows WO after report confirmed + Carried Forward | UI used residual pending qty / QC label as “active” | Expected: WO stays open for Store RM-return; leave Active Production; use Pending Store Tasks + Pending QA. Rebuild frontend when shipping |
| Pending QA = 1 but Recent entries show 2 Pending QC rows | Pending QA is WO-scoped; Recent list is entry-scoped | Valid when both entries belong to the same WO |
| Pending Actions Ready opens empty Continue tab | `productionBucket=readyToStart` landed on default Continue tab | URL must include `pwSection=ready`. Rebuild frontend when shipping |
| Continue Production opens dead “Waiting for QA” page while remaining qty exists | Entry Pending QC blocked the process screen | Remaining balance → Continue entry; entry QC is informational in Recent. Rebuild when shipping |
| Pending Actions “Open Production Workspace” shows “Production entry completed” while Ready WOs exist | Multi-WO PA link pinned SO/cycle/flow and reused a finished sibling | Multi-WO open uses overview + `productionBucket` + `pwSection` (`from`/`returnTo=pending-actions`). Rebuild frontend when shipping |
| After Pause, WO missing from Production Workspace / only Recent shows Pending QC | Entry QC was treated as WO-level QC; paused WOs had no Paused section | Use **Paused Production** tab + Resume; entry Pending QC ≠ WO finalized. Rebuild when shipping |
| Card grid horizontal / nested scrollbars cut Start Production | Nested `overflow-auto` + fixed card min widths | Workbench uses page scroll + responsive CSS Grid (`min-w-0`). Rebuild when shipping |

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
# Dashboard WO counts disagree

Compare Pending Actions work items, distinct production-eligible WOs, and Active Production lines using `docs/PRODUCTION_MULTI_WO_CANONICAL_RULE.md`. A higher sibling WO id is not evidence that an earlier WO was carried forward. User-facing labels must come from `WorkOrder.docNo` (flow-wise `WO-R` / `WO-NQ` / `WO-GL` or legacy `WO-YY-####` — see `docs/DOCUMENT_NUMBERING_WORK_ORDERS.md`).

If Resume opens Final Report, verify execution is RUNNING, remainder is positive, and no report is confirmed. Pending QC on an earlier entry is informational. If unused RM appears as wastage before confirmation, verify the report payload uses explicit `scrapWasteQty`; available RM must remain issued minus consumed/returned/declared wastage.
# Production RM reconciliation

- If recommended RM appears high, verify the percentage and remember the theoretical quantity already includes runner; runner must not be added again.
- If Production Report shows variance, enter an honest explanation or correct consumption/return/wastage. Do not classify unused RM as false wastage.
- Pending QC is not a blocker for the RM Production Report.
- A paused WO must be resumed before it can end; pause creates neither shortage nor carry-forward.
