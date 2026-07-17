# Deployment Guide — Flowtix ERP v1.0.0

Customer-facing summary of LAN deployment. **Normative detail:** FT-DEP-001 (`reference/`).

## Topology

- One Windows LAN server hosts Node backend + packaged React UI (`web\`).
- Browsers on the LAN connect to `http://<server>:<PORT>/`.
- MySQL may be local or reachable on the LAN.

## Packaging layers

| Layer | Artifact |
|-------|----------|
| Certified release | `release\Flowtix-vX.Y.Z\` / Server ZIP |
| Windows installer | `Flowtix-ERP-Setup.exe` |
| Customer media | Numbered folders 01–10 (this delivery) |

## Go-live gate

Complete FT-DEP-011 Production Readiness and customer acceptance forms under `acceptance/`.

After Windows installer install, confirm **live** runtime (not archive-only):

- `{FT_ERP_HOME}\app\server.js` and `{FT_ERP_HOME}\web\index.html`
- `{FT_ERP_HOME}\releases\Flowtix-vX.Y.Z\app\server.js` still present (archive not wiped)
- `logs\installer-post.log` → `SETUP_EXIT=0`

Hotfix background: FT-DEP-001 §34.3.1 (installer place-release). Customer media must include a **rebuilt** setup EXE after tooling changes (§35.4.2).

## Out of scope (v1.0.0)

- Cloud / SaaS deployment
- Bundled MySQL installer
- Automated DB restore CLI
- CI/CD customer media pipelines
