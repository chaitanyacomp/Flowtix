# Flowtix ERP — Windows Installer (FT-DEP-001 Batch 10 / Milestone 2–3)

Inno Setup **wrapper only**. It packages the certified release from Batch 1 and runs Batch 9 `setup-flowtix` (optional Batch 8 service, optional firewall rule). Milestone 3 hardens setup (validate → configure-env → db-safety → install-recovery → diagnostics). It does **not** replace update/rollback, install MySQL, or redesign deployment.

## Prerequisites

- [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`ISCC.exe`)
- Node.js on PATH (for version read in `build-installer.bat`)
- Release package: `release/Flowtix-vX.Y.Z/` from `deployment/create-release.bat`
- Release must include `tools/setup-flowtix.bat` and offline `tools/vendor/winsw/WinSW-x64.exe`

## Build

```bat
deployment\create-release.bat
deployment\installer\build-installer.bat
```

Output:

```text
deployment/installer/output/Flowtix-Setup-vX.Y.Z.exe
```

### Package embedding (portability)

- `build-installer.bat` checks `release\Flowtix-vX.Y.Z\VERSION.txt` **before** ISCC.
- Inno `[Files] Source: {#ReleaseRoot}\*` **embeds** the certified release into the setup EXE at compile time.
- Customer runtime extracts to `{app}\releases\Flowtix-vX.Y.Z\` and runs `post-install.bat` with **`{app}`** paths only.
- **Regression (critical):** the setup EXE must never probe a developer `ReleaseRoot` / repo path at runtime. `InitializeSetup` does not call `ExpandConstant('{#ReleaseRoot}')`. `build-installer.bat` fails if the compiled EXE still contains the packager `%ROOT%` string.

## What the installer does

1. Extracts embedded certified package to `{app}\releases\Flowtix-vX.Y.Z\`
2. Runs `{app}\tools\post-install.bat` → Batch 9 `setup-flowtix.bat` with source=`{app}\releases\Flowtix-vX.Y.Z\`
3. Optional: Windows Service via setup `--install-service` (Batch 8 / offline WinSW)
4. Optional: Windows Firewall inbound TCP rule for app PORT (`--configure-firewall`)
5. Optional: `--skip-migrate` (Path B)
6. Creates Start Menu shortcut to **server localhost** URL; optional desktop shortcut
7. Writes `LAN-ACCESS.txt` with hostname/LAN URL guidance
8. Writes logs under `{app}\logs\`

## URLs and port

| Audience | URL |
|----------|-----|
| This server (shortcut) | `http://127.0.0.1:<PORT>/` |
| LAN clients | `http://<server-hostname>:<PORT>/` or `http://<LAN-IPv4>:<PORT>/` |

**Port source (single):** `shared\.env` → `PORT` (default **4000**, same as `deployment/production.env.example`).  
Do not introduce a second port configuration. The installer does **not** permanently embed a development URL.

After install, the wizard shows both server and LAN URL patterns. See `{app}\LAN-ACCESS.txt`.

## Static UI hosting

In production, the Node/Express backend serves the packaged React SPA from `web\` (Milestone 2). Clients open the URLs above; `/api/*` remains the API; `GET /health` remains the ops probe.

## Safety rules

| Rule | Behavior |
|------|----------|
| No MySQL install | Operator provides MySQL separately |
| No `.env` overwrite | Batch 9 never replaces existing `shared/.env` |
| Existing install | Post-install **skips** setup; use `update-flowtix` for upgrades |
| Offline WinSW | Release ships checksum-validated `WinSW-x64.exe` |
| Uninstall default | Stops/removes service + firewall rule; removes `app`/`web`/`prisma` binaries; **asks** to preserve `shared/`, `backups/`, `logs/` (default Yes); **never deletes MySQL** |
| Pre-setup config | Prefer `tools\configure-env.bat` before Path A; setup refuses placeholder secrets |
| Install failure | `install-recovery` restores installation files only — never auto-rolls back the database |

## Silent install

```bat
Flowtix-Setup-v1.0.0.exe /VERYSILENT /DIR="C:\FT-ERP" /LOG="C:\FT-ERP\logs\installer-inno.log"
```

Tasks:

| Task | Effect |
|------|--------|
| `skipmigrate` | Path B (`--skip-migrate`) |
| `installservice` | Optional WinSW via Batch 8 |
| `configurefirewall` | Inbound TCP rule for PORT |
| `desktopicon` | Desktop shortcut (localhost URL) |

Example Path B + service + firewall:

```bat
Flowtix-Setup-v1.0.0.exe /VERYSILENT /DIR="C:\FT-ERP" /TASKS="skipmigrate,installservice,configurefirewall"
```

**Path A (migrate)** requires a valid `shared\.env` **before** setup can succeed. For first-time silent Path A:

1. Create `C:\FT-ERP\shared` and place `.env` (from `production.env.example`)
2. Run installer **without** `skipmigrate`

If `.env` is missing, Batch 9 exits non-zero — check `logs\setup.log`.

## Day-2 operations (unchanged engines)

| Action | Tool |
|--------|------|
| Verify | `tools\verify-install.bat` (health + UI HTML) |
| Update | `tools\update-flowtix.bat` (Batch 6) |
| Rollback | `tools\rollback-flowtix.bat` (Batch 7) |
| Service | `tools\service-*.bat` (Batch 8) |
| Firewall | `tools\firewall-flowtix.bat` add\|verify\|remove |

## Deferred

- MSI / WiX
- Bundled MySQL installer
- Automated DB restore
- Auto-update agent (FT-DEP-001 §21 R5)
