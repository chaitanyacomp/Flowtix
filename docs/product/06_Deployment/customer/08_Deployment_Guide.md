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

## Out of scope (v1.0.0)

- Cloud / SaaS deployment
- Bundled MySQL installer
- Automated DB restore CLI
- CI/CD customer media pipelines
