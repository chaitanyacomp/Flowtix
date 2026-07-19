# Acceptance — Operational Checklist

- [ ] Admin login succeeds
- [ ] Role sample login (Store or Purchase) succeeds
- [ ] Dashboard loads
- [ ] Create/open one Sales Order document
- [ ] Stock / item master searchable
- [ ] One report screen loads without error
- [ ] Activity / history visible on a document
- [ ] Production Workspace tabs: Ready / Continue / Paused / Pending QA / Awaiting Store / Recent — selected tab heading matches cards
- [ ] Partial finalized + Pending QC + remaining → Continue Production tab + executable entry (not dead Waiting for QA)
- [ ] Pending Actions Ready to Start → Ready to Start tab (not empty Continue); single Ready focuses card via `pwFocus`
- [ ] Pending Actions Continue → Continue tab / executable remaining-balance screen
- [ ] Whole-card click equals primary button; no nested horizontal scrollbar on card grid; card footer fully visible
- [ ] After Confirm Report + Carried Forward, WO not under Continue/Ready; under Awaiting Store; WO closes after Store RM-return approval
- [ ] Left-menu Production Workspace remains unscoped overview (`/production`)
- [ ] Material Issue: Planned Allowance accepts % or Qty; last edited field stays authoritative and Recommended recalculates without drift
- [ ] Material Issue: 27 Kg theoretical + 1 Kg allowance → 3.5714%, 28 Kg recommended; Issue Now 28 has no excess
- [ ] Material Issue: excess is above Recommended; below Recommended and true theoretical short are distinct
- [ ] Material Issue: >5% requires reason/Admin; >10% blocks and directs to Additional RM Issue
- [ ] Material Issue: multi-line desktop rows are compact; tablet/mobile cards have no clipped controls or nested horizontal scroll
- [ ] Planned allowance does not post actual wastage; mandatory Production Report records actual wastage later
- [ ] Partial produce 500 of 1,500 → entry may be Pending QC; WO remains Active with 1,000 remaining; Pause → Paused Production; Resume → Active; continue production; Confirm Report finalizes only then
- [ ] Production Report Pending: one-viewport workbench (summary strip + sticky Confirm); Continue hidden; Confirm stays visible while adding wastage rows at 100% zoom
- [ ] Wastage Kg precision: issued 82 / consumed 81.23 → required 0.77 (not 1); classify 0.77 → unexplained 0; Add Wastage Reason disabled; Confirm enabled
- [ ] After Confirm Report & Close WO (short): lands on card Production Workspace → Ready to Start; no Select Work Order / Log production / Complete QA legacy screen; closed WO absent; no auto-open of another WO

**Result:** Pass / Fail · **Operator:** ________ · **Date:** ________
- [ ] Exact four-WO NO_QTY split scenario shows four Active/Ready WOs, four Pending Actions, canonical WO numbers, and Operations Clear is false.
- [ ] Partial Pending-QC WO pauses and resumes into Continue Production with remaining quantity and RM availability preserved; paused report/close/carry-forward actions are absent and rejected server-side.
