# Version History — Flowtix ERP (Software)

| Version | Date | Summary |
|---------|------|---------|
| 1.0.0 | 2026-07 | First commercial customer delivery package — installer, server ZIP, docs, demo, acceptance, checksums/manifest (Milestones 1–4). Packaging hotfixes FT-DEP-001 v1.14 / v1.14.1 (installer place-release / post-install), v1.14.2 (Tally `require.resolve` + Control Tower `Prisma.Decimal`), and v1.14.3 (deployment UAT: production integrity, Issue RM eligibility, Tally HSN inheritance, backup-db home, Admin Users, BOM/RS refresh, Sales Bill bulk Tally, viewport/dispatch stability; login Show/Hide password). Source follow-ups: canonical Production Workbench state (Ready/Continue/Paused), Pending Actions `pwSection`/`pwFocus` routing, Continue-with-Pending-QC executable screen, compact whole-card workbench; Production Report compact viewport workbench (summary strip, sticky Confirm, Unexplained Balance); wastage Kg precision / required-allocation fix; post–Confirm Report close returns to card Workspace Ready to Start (no legacy Select-WO). Rebuild + clean-machine certify required before customer media refresh. |

Internal packaging milestones (not separate customer SKUs): Deployment Audit → Gap Closure → Installation Hardening → Customer Delivery.

Documentation corpus baseline (architecture volumes) remains separate from this software version line — see `docs/product/release/` for documentation release notes.
- Multi-WO production independence, canonical WO identity, and Dashboard counter consistency regression coverage added.
- Production execution, entry QC, remaining quantity, RM availability, and explicit final-report state separated across API and workspace UI.
- Corrected production draft finalization, pause/resume independence, shortage carry-forward idempotency, Workbench cards, and production deep-link classification.
- Corrected Material Issue Planned Allowance: Store enters Add Qty only; Allowance % is server-calculated from applicable BOM; async Admin approval above 5%–10% (Pending Actions → RM Allowance Approval) with no stock until Store final issue; side queue Approval Pending / Approved · Ready to Issue / Rejected · Revise so Store is never blocked waiting.
- Intentional partial RM issue: Qty (BOM) shows original requirement with separate Remaining; after partial issue WO moves to Partially Issued queue and Store continues next Ready WO; Continue RM Issue Pending Action; Short Issue remains explicit only.
- Pending Actions → Material Issue deep links use canonical `bucket=` for all queues (Ready / Partial / Approval Pending / Approved / Rejected); Open List shows the queue without re-selecting SO/WO/PMR.
