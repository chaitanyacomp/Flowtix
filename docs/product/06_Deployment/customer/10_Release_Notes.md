# Release Notes — Flowtix ERP v1.0.0

| Field | Value |
|-------|-------|
| **Product version** | 1.0.0 |
| **Codename** | Commercial customer delivery (Milestone 4) |
| **Status** | Customer-ready LAN package |

## 2026-07-19 — Combined Sales Billing Enhancement

Sales Bill drafts can combine partial quantities from multiple dispatches for one SO/customer. Draft quantities are reserved, compatible lines aggregate without losing trace, and seller-charged transportation is proportionately allocated across GST-rate lines. Transporter-direct charges remain reference-only. Confirm GST/mixed-supply policy with the client's GST consultant.

## Highlights

- End-to-end manufacturing ERP on LAN (enquiry → dispatch / billing)
- Windows installer + certified server package
- Installation hardening (validate, configure-env, db-safety, recovery, diagnostics)
- Customer documentation pack + acceptance checklists
- Commercial demo seed for partner labs

## Material Issue — RM allowance Admin approval (async)

- Store authors **Add Qty** only; Allowance % is server-calculated from applicable BOM.
- **0%–5%:** Issue Material (stock moves).
- **Above 5%–10%:** Store sends for Admin approval (no stock); side queue shows Approval Pending; Store continues other WOs immediately.
- Admin Pending Actions → **RM Allowance Approval** (Approve / Reject with reason). Approval does not issue stock.
- Store then issues from **Approved · Ready to Issue** with stock revalidation. Rejection → Revise & Resubmit.
- Above 10% remains blocked (Additional RM Issue). Approval fingerprint invalidates on quantity/entitlement change.

## Material Issue — intentional partial RM issue

- **Qty (BOM)** shows the original BOM requirement; **Already Issued** and **Remaining** are separate.
- After a partial issue the WO moves to **Partially Issued** (not Ready); the form clears and Store continues the next Ready WO.
- Production may proceed on issued RM. **Close Remaining (Short Issue)** stays explicit/optional.
- Store Pending Action **Continue RM Issue** deep-links into the Partially Issued queue.

## Material Issue — Pending Actions deep links (all queues)

- Canonical URL: `/material-issue?bucket=<readyToIssue\|partiallyIssued\|approvalPending\|approved\|rejected>&from=pending-actions&returnTo=pending-actions`.
- Open List activates the matching queue and shows its cards immediately (no arbitrary WO).
- Open (single item) adds `workOrderId` + `pmrId` and loads that card’s RM lines.
- Store PA: Issue Material · Continue RM Issue · RM Allowance Awaiting Admin · RM Allowance Approved · RM Allowance Rejected.

## Installer hotfixes (FT-DEP-001 v1.14 / v1.14.1)

- **Place-release self-wipe:** When setup runs with `--source` equal to `{home}\releases\Flowtix-vX` (Inno post-install layout), setup no longer refreshes the archive onto itself. Live `app\` and `web\` are promoted from the intact package. Regression: `certify-install` → `place_release_installer_layout`.
- **Post-install invocation:** Inno runs `post-install.bat` directly (not via broken `cmd /C "bat" "args"` quoting).
- **First-time `.env`:** `shared\.env` alone is not treated as a complete existing install (allows configure-env → setup).
- **Certification:** Always verify live runtime **and** that `releases\Flowtix-vX\app\server.js` remains after install. Rebuild the real setup EXE for customer delivery — do not certify by hand-copying scripts only.

## Packaged runtime hotfixes (FT-DEP-001 v1.14.2)

- **Tally Master Preview:** Removed runtime `require.resolve` of source-relative Tally modules (broke esbuild `app/server.js`). Mapping/GSTIN/preview/apply behavior unchanged; diagnostics use static module ids.
- **Control Tower Decimal:** `accountsDashboardService` constructs `Prisma.Decimal` via `prismaClientPackage` (generated `client-v2`), not bare `@prisma/client`.
- **Regression:** `backend/test/packagedRuntimeBundle.test.js` builds the production bundle and asserts both fixes.
- **Tally same-PC:** No Tally HTTP proxy required when Tally and Flowtix share a PC and `localhost:9000` responds.

## Deployment UAT stabilization (FT-DEP-001 v1.14.3)

- Production draft autosave never closes a WO; incomplete wastage blocks leave/confirm; Confirm Report & Close WO is atomic.
- Dashboard “Issue RM” only for pending PMR; awaiting release → Production Release (not Material Issue).
- Tally HSN/GST inherits Stock Group / parents; hierarchy text strips `&#4;` junk.
- `tools\backup-db` resolves `C:\FT-ERP` from `C:\FT-ERP\tools` without `FT_ERP_HOME`.
- Login shows “Invalid email or password” (not “Session expired”); Admin → Users management + role seed accounts.
- Login password field includes an accessible Show/Hide eye control (default hidden; does not submit the form).
- Work Order Planning: Live RM feasibility no longer loops on “Updating RM…”; typed WO quantities stay stable while RM refreshes in the background.
- Production Workbench: one canonical state classifier for Dashboard, Pending Actions, Workbench, and process screen (Ready / Draft / Continue / Paused / QC-only / Blocked / Closed).
- Partial finalized qty may stay Pending QC while remaining balance stays executable under **Continue Production** — process screen no longer dead-ends as Waiting for QA.
- Pending Actions Ready → **Ready to Start** tab (`pwSection=ready`, `pwFocus` for single WO); Continue → **Continue Production** tab / executable screen; never empty wrong tab.
- Compact whole-card workbench (4/3/2/1 columns), no nested card scrollbars, search/filter/sort/page 12·20·25, URL state restored on Back.
- Pause/Resume and Confirm Report & Close WO rules unchanged; Awaiting Store Approval remains separate from Continue.
- Requirement Sheet refreshes after BOM approve; Sales Bill bulk Tally export + clearer ledger errors; Dispatch history `salesOrderId` filter fixed.
- BOM / Production Workspace scroll at 1366×768; Dispatch Save Draft without intermediate empty flashes.

See package `RELEASE_NOTES.md` and FT-DEP-001 §28.5.1 / §34.3.1 / §35.4.

## Packaging

- Setup: `Flowtix-ERP-Setup.exe`
- Server: `Flowtix-Server.zip`
- Checksums: `08 Checksums\SHA256SUMS.txt`
- Manifest: `10 Manifest\RELEASE_MANIFEST.json`

## See also

- [11_Known_Limitations.md](./11_Known_Limitations.md)
- [12_Version_History.md](./12_Version_History.md)
- Package `RELEASE_NOTES.md` from the certified release (build identity)
- Fixed same-FG, same-cycle sibling WOs being projected as carried forward; Production Dashboard now uses canonical business WO numbers and consistent production eligibility counts.
- Fixed resumed partial WOs opening Final Production Report, separated Ready/Active/Paused/Pending QA queues, prohibited paused finalization, and stopped automatic conversion of unconsumed RM into wastage.
- Production Workbench: partial drafts now use Review & Finalize with an atomic Continue, Pause, or Close WO with Shortage decision; actionable WO cards and Pending Actions use the persisted production work state.
# 2026-07 Production RM reconciliation correction

Planned Process Allowance is quantity-authored (**Add Qty** only) with server-calculated acknowledgement % against applicable BOM. Excess for a fill begins above applicable BOM + Add Qty. Above 5%–10% uses async Admin approval (no stock on submit/approve); Store continues other WOs from the side queue. Above 10% remains blocked (Additional RM Issue). Runner-included theoretical quantity and later Production Report actual-wastage comparison remain explicit.

Also includes explicit Continue/Pause/End navigation, QC-independent mandatory Production Reports for Equal/Shortage/Extra outcomes, explained RM variance, canonical Store return handling, and report-confirmed shortage carry-forward timing.

### 2026-07 Production Workspace lifecycle (finalize vs close)

- Equal/extra production within issued-RM capacity parks the WO under **Production Report Pending** (execution `SHORTFALL_PENDING`); meeting planned FG quantity no longer skips RM reconciliation or auto-closes the WO.
- **End Production with Shortage** opens the WO Production Report after a stable **Opening Production Report…** gate (no Continue/runner flash); authoritative `AWAITING_PRODUCTION_REPORT` / `SHORTFALL_PENDING`; Pending Action **Complete Production Report** deep-links `pwSection=reportPending&focusReport=1` (not generic NO_QTY Execution).
- Pause finalization leaves the paused runner, places the WO under **Paused Production**, and advances to the next eligible WO when available.
- Recent Entries default to the current WO id; sibling same-SO/cycle entries no longer appear in the runner by default.
- Workbench tab **Production Report Pending** coexists with Pending QC batches; QC Pending does not hide report-pending or paused WOs.
- Production Report UI: compact one-viewport workbench (summary strip, full-width Unexplained Balance table, compact wastage rows, collapsible remarks, sticky Confirm footer). Continue is hidden while Report Pending; Confirm stays on-screen while entering wastage.
- Production Report wastage: Kg precision preserved (0.77 not rounded to 1); default unexplained starts at 0 after required allocation; Add Wastage Reason disables when fully classified; wastage list has no internal scrollbar.
- After Confirm Report & Close WO (including short production), the app returns to the card Production Workspace → Ready to Start. The obsolete NO_QTY Select-WO / Log production screen is no longer used for post-close navigation; orphan `source=no_qty_so` URLs redirect to Ready to Start.
