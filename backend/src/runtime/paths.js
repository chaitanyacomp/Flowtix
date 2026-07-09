/**
 * FT-DEP-001 Batch 2/3 — resolve runtime roots (shared/, logs/, release metadata).
 * No business logic. Separates development layout from LAN deployment layout.
 *
 * Works for:
 * - Source: backend/src/runtime/*.js  → package root = backend/
 * - Bundle: app/server.js             → package root = app/ (via require.main / cwd)
 *
 * Note: esbuild rewrites __dirname to source-relative paths, so bundled code
 * MUST NOT rely on __dirname alone for package-root detection.
 */
const fs = require("fs");
const path = require("path");

/**
 * backend/ (dev) or app/ (Batch 3 bundled release).
 * @returns {string}
 */
function getPackageRoot() {
  if (process.env.FT_PACKAGE_ROOT && String(process.env.FT_PACKAGE_ROOT).trim()) {
    return path.resolve(String(process.env.FT_PACKAGE_ROOT).trim());
  }

  // Bundled entry: node server.js → require.main is app/server.js
  try {
    if (typeof require !== "undefined" && require.main && require.main.filename) {
      const mainDir = path.dirname(require.main.filename);
      if (
        fs.existsSync(path.join(mainDir, "package.json")) &&
        fs.existsSync(path.join(mainDir, "server.js"))
      ) {
        return mainDir;
      }
    }
  } catch {
    // ignore
  }

  // CWD when started from app/
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, "server.js"))) {
    return cwd;
  }

  // Source layout: backend/src/runtime/paths.js → backend/
  const fromRuntime = path.resolve(__dirname, "..", "..");
  if (
    fs.existsSync(path.join(fromRuntime, "package.json")) &&
    fs.existsSync(path.join(fromRuntime, "src", "server.js"))
  ) {
    return fromRuntime;
  }

  return fromRuntime;
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
