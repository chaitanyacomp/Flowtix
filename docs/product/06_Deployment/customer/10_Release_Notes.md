# Release Notes — Flowtix ERP v1.0.0

| Field | Value |
|-------|-------|
| **Product version** | 1.0.0 |
| **Codename** | Commercial customer delivery (Milestone 4) |
| **Status** | Customer-ready LAN package |

## Highlights

- End-to-end manufacturing ERP on LAN (enquiry → dispatch / billing)
- Windows installer + certified server package
- Installation hardening (validate, configure-env, db-safety, recovery, diagnostics)
- Customer documentation pack + acceptance checklists
- Commercial demo seed for partner labs

## Installer hotfixes (FT-DEP-001 v1.14 / v1.14.1)

- **Place-release self-wipe:** When setup runs with `--source` equal to `{home}\releases\Flowtix-vX` (Inno post-install layout), setup no longer refreshes the archive onto itself. Live `app\` and `web\` are promoted from the intact package. Regression: `certify-install` → `place_release_installer_layout`.
- **Post-install invocation:** Inno runs `post-install.bat` directly (not via broken `cmd /C "bat" "args"` quoting).
- **First-time `.env`:** `shared\.env` alone is not treated as a complete existing install (allows configure-env → setup).
- **Certification:** Always verify live runtime **and** that `releases\Flowtix-vX\app\server.js` remains after install. Rebuild the real setup EXE for customer delivery — do not certify by hand-copying scripts only.

See package `RELEASE_NOTES.md` and FT-DEP-001 §34.3.1 / §35.4.

## Packaging

- Setup: `Flowtix-ERP-Setup.exe`
- Server: `Flowtix-Server.zip`
- Checksums: `08 Checksums\SHA256SUMS.txt`
- Manifest: `10 Manifest\RELEASE_MANIFEST.json`

## See also

- [11_Known_Limitations.md](./11_Known_Limitations.md)
- [12_Version_History.md](./12_Version_History.md)
- Package `RELEASE_NOTES.md` from the certified release (build identity)
