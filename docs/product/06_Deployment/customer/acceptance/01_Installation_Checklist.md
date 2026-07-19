# Acceptance — Installation Checklist

| Site | Date | Version |
|------|------|---------|
| | | 1.0.0 |

- [ ] Installer / setup completed without errors
- [ ] `shared\.env` present (secrets not recorded here)
- [ ] Live `app\server.js` and `web\index.html` present under `FT_ERP_HOME` (not only under `releases\`)
- [ ] Archive intact: `releases\Flowtix-v*\app\server.js` still present after install
- [ ] `logs\installer-post.log` shows `SETUP_EXIT=0` (Batch 10) or setup log RESULT=success
- [ ] `VERSION.txt` productVersion = ________
- [ ] `verify-install` exit 0
- [ ] Localhost URL shows Flowtix login HTML
- [ ] Optional: Windows Service Running (`sc query FlowtixERP`)
- [ ] Optional: Firewall rule present
- [ ] `curl http://localhost:<PORT>/api/health` OK (PORT from `.env`, default 4000)
- [ ] Optional smoke: Control Tower panel metrics loads (no `Prisma.Decimal` error in `logs\error.log`)
- [ ] Optional smoke: Admin → Tally Master Preview succeeds when XML/Tally available (no `mapLedgerToParty` module error)
- [ ] Same-PC Tally: if `localhost:9000` responds, do **not** require a separate Tally proxy for Master import
- [ ] Optional smoke: `tools\backup-db.bat` resolves home under `FT_ERP_HOME` (not drive root) without setting `FT_ERP_HOME`
- [ ] Optional smoke: Admin → Users lists role accounts; wrong password on login shows “Invalid email or password” (not “Session expired”)
- [ ] Optional smoke: Login password Show/Hide eye toggles visibility; Enter still signs in; password value is not cleared
- [ ] Optional smoke: Work Order Planning — type WO qty; “Updating RM…” stops; fields do not reset; Create WO remains usable when validation allows
- [ ] Optional smoke: Opening Stock — approved rows show disabled **Approved** (not a primary Approve lookalike)
- [ ] Optional smoke: Dashboard does not deep-link “Issue RM” for WO awaiting release / without pending PMR
- [ ] Optional smoke: Production leave with incomplete wastage warns; WO stays open until Confirm Report & Close WO

**Result:** Pass / Fail · **Operator:** ________
