FT-DEP-001 Batch 3 — vendored esbuild (packaging toolchain only)

Why this folder exists:
  Some Windows npm installs fail to materialize the `esbuild` package on disk
  even when it is listed in backend/package.json. The release bundler therefore
  prefers this vendor copy so `deployment/create-release.bat` remains reliable.

Contents:
  esbuild/              — esbuild@0.25.5 JS API
  @esbuild/win32-x64/   — Windows x64 native binary used by esbuild

This is a build-time dependency for packaging. It is NOT shipped inside
release/Flowtix-v*/app/ for clients.

Preferred long-term: `npm install --save-dev esbuild --prefix backend` when
the environment installs packages correctly; vendor remains the fallback.
