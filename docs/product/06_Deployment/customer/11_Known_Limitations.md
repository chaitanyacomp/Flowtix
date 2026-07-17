# Known Limitations — Flowtix ERP v1.0.0

| Area | Limitation |
|------|------------|
| MySQL | Not bundled; operator-provided MySQL 8+ |
| DB restore | Manual SQL restore only (no automated restore CLI) |
| Cloud | LAN / local-server model only |
| Roles | Product roles: ADMIN, STORE, PURCHASE, PRODUCTION, QA (demo personas map onto these) |
| Forced password change | Operational policy; no first-login forced-change flag in v1.0.0 |
| MSI / WiX | Inno Setup wrapper is the supported installer |
| Licensing server | Offline LAN license enforcement not included in this milestone |
| Demo seed | Creates masters + sample SOs; remaining workflow posts via UI |
| Installer wizard vs bootstrap | Inno may report “installed” even if Batch 9 post-install fails — always confirm live `app\`/`web\`, `SETUP_EXIT=0`, and intact `releases\…\app\server.js` (FT-DEP-001 §35.4.1) |

Fill site-specific notes in FT-DEP-013 when deploying.
