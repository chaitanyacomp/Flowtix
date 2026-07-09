# FT-DEP-013 — Version Compatibility Matrix

| Field | Value |
|-------|-------|
| **Document ID** | FT-DEP-013 |
| **Version** | 1.0.0 |
| **Parent** | FT-DEP-001 v1.10.0 |
| **Instructions** | Fill one row per certified release before customer deploy |

## Release under test

| Field | Value |
|-------|-------|
| Product version | |
| Release folder | Flowtix-v |
| Git commit | |
| Build date | |
| Prisma migration head | |
| Installer EXE (if any) | Flowtix-Setup-v |
| Min Node.js | 18+ (confirm with check-prereqs) |
| MySQL | 8.x recommended |

## Upgrade paths

| From version | To version | Supported? | Notes (backup / migrate / smoke) |
|--------------|------------|------------|----------------------------------|
| | | Yes / No / Pilot only | |
| | | | |
| | | | |

## Tooling batch compatibility

| Capability | Batch | Present in this package? |
|------------|-------|---------------------------|
| Release package | 1 | Yes / No |
| Runtime /health | 2 | Yes / No |
| Bundled `app/server.js` | 3 | Yes / No |
| backup-db | 4 | Yes / No |
| migrate-db | 5 | Yes / No |
| update-flowtix | 6 | Yes / No |
| rollback-flowtix | 7 | Yes / No |
| service-* | 8 | Yes / No |
| setup-flowtix | 9 | Yes / No |
| Inno installer | 10 | Yes / No / N/A |
| Handover pack + verify-install | 11 | Yes / No |

## Known limitations for this release

1. 
2. 

## Sign-off

| Role | Name | Date |
|------|------|------|
| Release manager | | |
| Partner lead | | |
