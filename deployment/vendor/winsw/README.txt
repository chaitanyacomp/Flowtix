Flowtix ERP — WinSW vendor package (FT-DEP-001 Batch 8 / Milestone 2)

Pinned version: v2.12.0
Binary:         WinSW-x64.exe (required for offline service install)
Manifest:       winsw-manifest.json (version, URL, SHA-256)

Validate:
  node deployment\validate-winsw.js --require

create-release.bat copies a checksum-validated binary into:
  release\Flowtix-v*\tools\vendor\winsw\WinSW-x64.exe

service-install prefers this bundled binary. Network download is a last-resort
fallback only when the vendor file is missing and will still verify SHA-256
against winsw-manifest.json when possible.

Do not commit an unverified binary. Always update sha256 in the manifest when
replacing the EXE (see winsw-manifest.json replacementProcedure).
