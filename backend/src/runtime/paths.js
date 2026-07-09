/**
 * FT-DEP-001 Batch 2 — resolve runtime roots (shared/, logs/, release metadata).
 * No business logic. Separates development layout from LAN deployment layout.
 */
const fs = require("fs");
const path = require("path");

/** backend/ or app/ root (parent of src/) */
function getPackageRoot() {
  return path.resolve(__dirname, "..", "..");
}

/**
 * Detect Flowtix release package root (folder containing VERSION.txt + app/).
 * @param {string} packageRoot
 */
function detectReleaseDir(packageRoot) {
  const parent = path.resolve(packageRoot, "..");
  if (fs.existsSync(path.join(parent, "VERSION.txt"))) return parent;
  if (fs.existsSync(path.join(packageRoot, "VERSION.txt"))) return packageRoot;
  return null;
}

/**
 * Repo root when running from source tree (sibling of backend/).
 * @param {string} packageRoot
 */
function detectRepoRoot(packageRoot) {
  const parent = path.resolve(packageRoot, "..");
  if (fs.existsSync(path.join(parent, "frontend")) && fs.existsSync(path.join(parent, "backend"))) {
    return parent;
  }
  return parent;
}

/**
 * @returns {{
 *   packageRoot: string,
 *   releaseDir: string|null,
 *   homeDir: string,
 *   sharedDir: string,
 *   logsDir: string,
 *   uploadsDir: string,
 *   tempDir: string,
 *   versionFile: string|null,
 *   layout: 'ft-erp-home'|'release-package'|'development'
 * }}
 */
function resolveRuntimePaths(env = process.env) {
  const packageRoot = getPackageRoot();
  const releaseDir = detectReleaseDir(packageRoot);
  const repoRoot = detectRepoRoot(packageRoot);

  let layout;
  let homeDir;
  let sharedDir;
  let logsDir;

  if (env.FT_ERP_HOME && String(env.FT_ERP_HOME).trim()) {
    layout = "ft-erp-home";
    homeDir = path.resolve(String(env.FT_ERP_HOME).trim());
    sharedDir = env.SHARED_DIR ? path.resolve(String(env.SHARED_DIR).trim()) : path.join(homeDir, "shared");
    logsDir = env.LOG_DIR ? path.resolve(String(env.LOG_DIR).trim()) : path.join(homeDir, "logs");
  } else if (releaseDir) {
    layout = "release-package";
    homeDir = releaseDir;
    sharedDir = env.SHARED_DIR ? path.resolve(String(env.SHARED_DIR).trim()) : path.join(releaseDir, "shared");
    logsDir = env.LOG_DIR ? path.resolve(String(env.LOG_DIR).trim()) : path.join(releaseDir, "logs");
  } else {
    layout = "development";
    homeDir = repoRoot;
    sharedDir = env.SHARED_DIR ? path.resolve(String(env.SHARED_DIR).trim()) : path.join(repoRoot, "shared");
    logsDir = env.LOG_DIR ? path.resolve(String(env.LOG_DIR).trim()) : path.join(repoRoot, "logs");
  }

  const uploadsDir = path.join(sharedDir, "uploads");
  const tempDir = path.join(sharedDir, "temp");

  let versionFile = null;
  if (releaseDir && fs.existsSync(path.join(releaseDir, "VERSION.txt"))) {
    versionFile = path.join(releaseDir, "VERSION.txt");
  } else if (env.VERSION_FILE && fs.existsSync(String(env.VERSION_FILE))) {
    versionFile = path.resolve(String(env.VERSION_FILE));
  } else {
    const candidates = [
      path.join(homeDir, "VERSION.txt"),
      path.join(homeDir, "current", "VERSION.txt"),
      path.join(packageRoot, "VERSION.txt"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        versionFile = c;
        break;
      }
    }
  }

  return {
    packageRoot,
    releaseDir,
    homeDir,
    sharedDir,
    logsDir,
    uploadsDir,
    tempDir,
    versionFile,
    layout,
  };
}

module.exports = {
  getPackageRoot,
  detectReleaseDir,
  resolveRuntimePaths,
};
