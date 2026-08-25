# Administrator Guide — Flowtix ERP v1.0.0

This guide points administrators to the authoritative day-2 runbook.

**Primary reference:** FT-DEP-012 Administrator Runbook (`reference/FT-DEP-012_Administrator_Runbook.md`)

## Responsibilities

| Area | Tools / path |
|------|----------------|
| Start / stop | `tools\service-*.bat` or `node app\server.js` |
| Health | `GET /health`, `tools\verify-install.bat` |
| Firewall | `tools\firewall-flowtix.bat` |
| Backup / restore | `tools\backup-db.bat`, `tools\schedule-backup.bat`, Admin **Backup & Restore** — see Backup Guide |
| Update | `tools\update-flowtix.bat` — see Upgrade Guide |
| Rollback (app/web) | `tools\rollback-flowtix.bat` |
| Diagnostics | `tools\collect-diagnostics.bat` |
| Users & roles | Settings → Users (ADMIN) |
| Company profile | Settings → Company Profile |
| Login password visibility | Sign-in eye control: Show/Hide password (default hidden) |

## Configuration

- Secrets live only in `shared\.env` — never email them.
- Guided editor: `tools\configure-env.bat` (masks passwords in summaries).

## Production Pause / Resume (operator support)

- PRODUCTION/ADMIN pause and resume shop-floor WOs; Store does not resume production.
- Entry-level Pending QC is independent of WO pause/active state — do not close WOs because a partial batch awaits QA.
- Only Confirm Report & Close WO finalizes execution; RM-return Store approval may keep the WO open under Awaiting Store Approval.

## Planned Process Allowance approval

- Store authors **Add Qty** only; Allowance % is server-calculated from applicable BOM. Above 5% through 10% requires a Store reason and an **async Admin approval request** (Pending Actions → **RM Allowance Approval**).
- Approving does **not** issue stock. Store performs final **Issue Material** after approval, with stock rechecked at issue time.
- Rejection requires an Admin reason; Store sees **Rejected · Revise** and may resubmit.
- Requester cannot approve their own request. Above 10% remains blocked (Additional RM Issue).
- Planned allowance never records actual wastage; Production Report owns actual wastage.

## Recovery

Install-file recovery: `tools\install-recovery.bat` (does **not** roll back MySQL).  
Database: prefer Admin **safe restore** for eligible catalog backups (see Backup Guide). Legacy/unverified or emergency cases use IT-assisted SQL restore (Mode B). Full restore replaces users/data and reverts passwords to the backup date; cleanup preserves users.

Full procedures: FT-DEP-012 §§2–7 · [05_Backup_and_Restore_Guide.md](./05_Backup_and_Restore_Guide.md).
# Multi-WO diagnostics

Investigate carried-forward status without a final report/shortfall decision, terminal projections with active quantity, and labels that show internal numeric ids. Repair only records with no final report, no carry-forward decision, and no terminal closure event.

Also flag confirmed reports on paused executions, automatic wastage equal to all unconsumed RM, or QC-pending entries that suppress a RUNNING WO with remaining quantity. Pause/resume is idempotent and must not mutate production entries or RM ledgers.
### Production disposition audit

Administrators can distinguish draft entries, immutable finalized entries, persisted execution pause, terminal shortage closure, and the canonical `PRODUCTION_SHORTFALL` recovery source. Investigate any finalized partial entry without a persisted disposition; do not create carry-forward manually. Recovery uniqueness is enforced by its source-document identity.
# Planned Process Allowance controls

Normal allowance is 0–5% (Store issues directly). Above 5% through 10%: Store sends for Admin approval via Pending Actions; Admin Approve/Reject; Store issues only after APPROVED (no automatic stock on approve). Above 10% is blocked from this path (Additional RM Issue). Request, decision, and final issue events are audited. Planned allowance never posts wastage. Store confirmation of RM return remains the auditable stock receipt.
