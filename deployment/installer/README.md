# Flowtix ERP — Windows Installer (FT-DEP-001 Batch 10)

Inno Setup **wrapper only**. It packages the certified release from Batch 1 and runs Batch 9 `setup-flowtix` (optional Batch 8 service). It does **not** replace update/rollback, install MySQL, or redesign deployment.

## Prerequisites

- [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`ISCC.exe`)
- Node.js on PATH (for version read in `build-installer.bat`)
- Release package: `release/Flowtix-vX.Y.Z/` from `deployment/create-release.bat`
- Release must include `tools/setup-flowtix.bat` (Batch 9+)

## Build

```bat
deployment\create-release.bat
deployment\installer\build-installer.bat
```

Output:

```text
deployment/installer/output/Flowtix-Setup-vX.Y.Z.exe
```

## What the installer does

1. Extracts certified package to `{app}\releases\Flowtix-vX.Y.Z\`
2. Runs `tools\post-install.bat` → Batch 9 `setup-flowtix.bat`
3. Optional task: Windows Service via setup `--install-service` (Batch 8)
4. Optional task: `--skip-migrate` (Path B)
5. Creates Start Menu / optional desktop URL shortcut
6. Writes logs under `{app}\logs\` (`installer-post.log`, `setup.log`)

## Safety rules

| Rule | Behavior |
|------|----------|
| No MySQL install | Operator provides MySQL separately |
| No `.env` overwrite | Batch 9 never replaces existing `shared/.env` |
| Existing install | Post-install **skips** setup; use `update-flowtix` for upgrades |
| Uninstall default | Stops/removes service; removes app/web binaries; **keeps** `shared/`, `backups/`, `logs/`, DB, pre-update archives |

## Silent install

```bat
Flowtix-Setup-v1.0.0.exe /VERYSILENT /DIR="C:\FT-ERP" /LOG="C:\FT-ERP\logs\installer-inno.log"
```

Tasks:

| Task | Effect |
|------|--------|
| `skipmigrate` | Path B (`--skip-migrate`) |
| `installservice` | Optional WinSW via Batch 8 |
| `desktopicon` | Desktop shortcut |

Example Path B + service:

```bat
Flowtix-Setup-v1.0.0.exe /VERYSILENT /DIR="C:\FT-ERP" /TASKS="skipmigrate,installservice"
```

**Path A (migrate)** requires a valid `shared\.env` **before** setup can succeed. For first-time silent Path A:

1. Create `C:\FT-ERP\shared` and place `.env` (from `production.env.example`)
2. Run installer **without** `skipmigrate`

If `.env` is missing, Batch 9 exits non-zero — check `logs\setup.log`.

## Digital signing (optional — not required for Batch 10)

1. Obtain an Authenticode certificate.
2. In `Flowtix.iss` `[Setup]`, uncomment / set:

```text
SignTool=signtool $f
```

3. Configure Inno **Tools → Configure Sign Tools** (or CI) with `signtool sign /fd SHA256 /a $f`.

Unsigned builds may trigger SmartScreen until reputation or signing is established.

## Day-2 operations (unchanged)

| Action | Tool |
|--------|------|
| Update | `tools\update-flowtix.bat` (Batch 6) |
| Rollback | `tools\rollback-flowtix.bat` (Batch 7) |
| Service | `tools\service-*.bat` (Batch 8) |

Do **not** use this installer as a destructive re-bootstrap of a live site.

## Deferred

- MSI / WiX
- Bundled MySQL installer
- Automated DB restore
- Auto-update agent (FT-DEP-001 §21 R5)
