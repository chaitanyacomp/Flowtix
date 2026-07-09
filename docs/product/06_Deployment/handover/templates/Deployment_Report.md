# Template — Deployment Report

| Field | Value |
|-------|-------|
| **Report ID** | |
| **Customer / Site** | |
| **Operator** | |
| **Start (UTC/local)** | |
| **End** | |
| **Result** | Success / Failed / Partial / Rolled back |

## Identity

| Item | Value |
|------|-------|
| From version | |
| To version | |
| Git commit | |
| Release folder / installer | |
| FT_ERP_HOME | |

## Steps performed

| Step | Tool / action | Result | Notes |
|------|---------------|--------|-------|
| Prereqs | check-prereqs / manual | | |
| Setup / Install | setup-flowtix / Inno | | |
| Backup | backup-db | | Filename: |
| Migrate | migrate-db | | |
| Update | update-flowtix | | |
| Rollback | rollback-flowtix | | |
| Service | service-* | | |
| Verify | verify-install /health | | |

## Preservation confirmation

- [ ] `shared\.env` not overwritten unintentionally
- [ ] `backups\` retained
- [ ] `logs\` retained
- [ ] Database not wiped by deploy tools

## Issues / follow-ups

1. 
2. 

## Attachments (no secrets)

- Checklist IDs completed: 
- Sign-off: Yes / No / Pending
