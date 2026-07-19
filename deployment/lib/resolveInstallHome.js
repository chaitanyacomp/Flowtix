/**
 * Shared FT install-home detection for packaged tools (backup-db, migrate-db, verify-install).
 * Prefer FT_ERP_HOME; otherwise detect install-root or release/tools layouts.
 */
const fs = require("fs");
const path = require("path");

/**
 * @param {string} scriptDirectory Absolute directory containing the calling tool script.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Absolute install/repo home (never prints secrets).
 */
function resolveInstallHome(scriptDirectory, env = process.env) {
  if (env.FT_ERP_HOME && String(env.FT_ERP_HOME).trim()) {
    return path.resolve(String(env.FT_ERP_HOME).trim());
  }

  const here = path.resolve(scriptDirectory);
  const base = path.basename(here);

  // C:\FT-ERP\tools or releases\Flowtix-vX\tools
  if (base === "tools") {
    const toolsParent = path.resolve(here, "..");
    const grandParent = path.resolve(toolsParent, "..");

    // Installed layout: {home}/tools — home itself has shared/releases/app.
    if (
      fs.existsSync(path.join(toolsParent, "shared")) ||
      fs.existsSync(path.join(toolsParent, "releases")) ||
      fs.existsSync(path.join(toolsParent, "app"))
    ) {
      return toolsParent;
    }

    // Release package layout: {home}/releases/Flowtix-vX/tools → {home}
    if (path.basename(grandParent) === "releases") {
      return path.resolve(grandParent, "..");
    }
    if (
      fs.existsSync(path.join(grandParent, "releases")) ||
      fs.existsSync(path.join(grandParent, "shared"))
    ) {
      return grandParent;
    }

    // Dev layout: repo/release/Flowtix-vX/tools → repo root
    if (path.basename(grandParent) === "release") {
      return path.resolve(grandParent, "..");
    }
    if (fs.existsSync(path.join(grandParent, "backend"))) {
      return grandParent;
    }
    // Last resort: tools parent (install root) rather than drive root.
    return toolsParent;
  }

  if (base === "deployment") {
    return path.resolve(here, "..");
  }

  if (base === "lib" && path.basename(path.resolve(here, "..")) === "deployment") {
    return path.resolve(here, "..", "..");
  }

  return path.resolve(here, "..");
}

module.exports = { resolveInstallHome };
