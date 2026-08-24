# Known Limitations — Flowtix ERP v1.0.0

| Area | Limitation |
|------|------------|
| MySQL | Not bundled; operator-provided MySQL 8+ |
| DB restore | Manual SQL restore only (no automated restore CLI) |
| Cloud | LAN / local-server model only |
| Roles | Product roles: ADMIN, STORE, PURCHASE, PRODUCTION, QA (demo personas map onto these) |
| Forced password change | Admin → Settings → Users can reset passwords; first-login forced-change flag remains out of scope for v1.0.0 |
| MSI / WiX | Inno Setup wrapper is the supported installer |
| Licensing server | Offline LAN license enforcement not included in this milestone |
| Demo seed | Creates masters + sample SOs; remaining workflow posts via UI |
| Installer wizard vs bootstrap | Inno may report “installed” even if Batch 9 post-install fails — always confirm live `app\`/`web\`, `SETUP_EXIT=0`, and intact `releases\…\app\server.js` (FT-DEP-001 §35.4.1) |
| Tally HTTP proxy | Not required when Tally and Flowtix backend run on the same PC and `http://localhost:9000` responds |
| Packaged vs source runtime | Some Node patterns (source-relative `require.resolve`, bare `@prisma/client` Decimal) work in source but fail in `app/server.js` — see FT-DEP-001 §28.5.1; fixed in packaging v1.14.2 |
| Tally import confirmation | Sales/Purchase Bill “exported” marks XML downloaded from Flowtix; operator must still import into Tally and confirm there |
| Master list selection | Select All applies to **visible rows on the current page only**; cross-page multi-select is not supported |
| Master lifecycle labels | Product architecture may describe Suspend/Archive; runtime uses Active/Inactive (`isActive`) until schema expands |
| Master list pagination | Large Item masters are filtered/sorted/paged in the browser after load; server-side page tokens for all masters remain a future hardening |
| Extra item categories | Packing / Stores & Spares / Tool / Scrap are not separate `ItemType` values; packing import maps to CONSUMABLE when approved |
| Machine purging execution | **Implemented (2026-08-24):** Production Run Start Confirmation per planned machine run; actual purging consumes issued Production RM (`PURGING_CONSUMPTION`); purging separate from process wastage. **Future:** PLC / machine interlock (premium); shift-wise reports and Shift Over (next checkpoint) |

Fill site-specific notes in FT-DEP-013 when deploying.
