/**
 * FT-DEP-001 Batch 2 — load environment from shared/.env then package .env.
 * Does not override variables already set in the process environment.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { resolveRuntimePaths, getPackageRoot } = require("./paths");

/**
 * @returns {{ loadedFrom: string[], paths: ReturnType<typeof resolveRuntimePaths> }}
 */
function loadRuntimeEnv() {
  // First pass: discover paths using current env (FT_ERP_HOME / SHARED_DIR may already be set).
  let paths = resolveRuntimePaths(process.env);
  const loadedFrom = [];

  const candidates = [
    path.join(paths.sharedDir, ".env"),
    path.join(getPackageRoot(), ".env"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const result = dotenv.config({ path: file, override: false });
    if (!result.error) loadedFrom.push(file);
  }

  // Re-resolve after shared/.env may have set FT_ERP_HOME / SHARED_DIR / LOG_DIR.
  paths = resolveRuntimePaths(process.env);
  return { loadedFrom, paths };
}

module.exports = { loadRuntimeEnv };
