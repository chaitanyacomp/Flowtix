# Checklist 09 — Client Handover

| Customer | Partner | Date |
|----------|---------|------|
| | | |

Partner → customer operational handover (FT-PD-091 hypercare transition / OPS-10).

## Artifacts delivered

- [ ] Certified package / installer location documented
- [ ] `FT_ERP_HOME` path documented
- [ ] This handover pack (or release `docs\handover\`) left on site
- [ ] [Administrator Runbook](../FT-DEP-012_Administrator_Runbook.md) reviewed with Admin
- [ ] [Compatibility matrix](../FT-DEP-013_Version_Compatibility_Matrix.md) filled for this release
- [ ] Signed [Release Sign-off](../templates/Release_Signoff.md)
- [ ] Completed [Deployment Report](../templates/Deployment_Report.md)

## Access & credentials (process only — no secrets on this form)

- [ ] Admin account ownership transferred / confirmed
- [ ] MySQL admin access owned by customer (or agreed custodian)
- [ ] `shared\.env` access restricted; not emailed

## Training / ops

- [ ] Start/stop (service or `node app\server.js`) demonstrated
- [ ] Backup demonstrated (Admin catalog and/or `backup-db.bat`); schedule verify shown
- [ ] Daily/weekly backup verification checklist handed over
- [ ] Restore awareness: full restore replaces users/passwords; cleanup preserves users; maintenance / rollback / emergency IT
- [ ] Update path (Batch 6) explained
- [ ] Rollback Mode A (app/web) vs Mode B / Admin safe restore explained
- [ ] Support escalation path agreed

## Hypercare

- [ ] Hypercare window dates: _______________ → _______________
- [ ] Steady-state support start date: _______________

**Handover complete:** Yes / No  

**Partner:** _______________ **Customer Admin:** _______________
