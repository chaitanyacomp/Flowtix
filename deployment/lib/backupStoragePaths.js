/**
 * Single shared backup storage path resolver (Admin UI + deployment CLI).
 *
 * Location (SSOT): deployment/lib/backupStoragePaths.js
 * Backend re-exports this file; create-release copies it to tools/lib/.
 *
 * Priority for canonical write root:
 * 1. BACKUP_STORAGE_DIR
 * 2. BACKUP_DIR (legacy CLI alias)
 * 3. {FT_ERP_HOME}/backups/db
 * 4. {homeDir}/backups/db
 * 5. Detected install/repo home (from this module's location — not process.cwd()) → backups/db
 *
 * Trusted roots for read/download/delete/restore confinement:
 * - canonical write root
 * - {home}/ERP_DATA/backups  (legacy Admin UI default)
 * - {home}/ERP_DATA/backups/db
 *
 * Does not move or delete existing backups.
 */
const fs = require("fs");
const path = require("path");

/**
 * Detect Flowtix home / repo root without depending on process.cwd().
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ homeDir?: string | null }} [options]
 * @returns {string}
 */
function detectBackupHomeDir(env = process.env, options = {}) {
  if (options.homeDir && String(options.homeDir).trim()) {
    return path.resolve(String(options.homeDir).trim());
  }
  if (env.FT_ERP_HOME && String(env.FT_ERP_HOME).trim()) {
    return path.resolve(String(env.FT_ERP_HOME).trim());
  }

  // This file lives at:
  //   <repo>/deployment/lib/backupStoragePaths.js  (source)
  //   <home>/tools/lib/backupStoragePaths.js       (packaged)
  //   <release>/tools/lib/backupStoragePaths.js
  const here = path.resolve(__dirname);
  const parentName = path.basename(path.resolve(here, ".."));

  if (parentName === "deployment") {
    return path.resolve(here, "..", "..");
  }

  if (parentName === "tools") {
    const toolsParent = path.resolve(here, "..", "..");
    // Installed: {home}/tools/lib → home
    if (
      fs.existsSync(path.join(toolsParent, "shared")) ||
      fs.existsSync(path.join(toolsParent, "releases")) ||
      fs.existsSync(path.join(toolsParent, "app"))
    ) {
      return toolsParent;
    }
    const grand = path.resolve(toolsParent, "..");
    if (path.basename(toolsParent) === "releases" || path.basename(grand) === "releases") {
      // {home}/releases/Flowtix-vX/tools/lib
      if (path.basename(path.resolve(here, "..", "..")) !== "tools") {
        /* fall through */
      }
    }
    // {home}/releases/Flowtix-vX/tools → home is grandparent of tools
    const releaseParent = path.resolve(here, "..", "..");
    if (path.basename(releaseParent) === "releases") {
      return path.resolve(releaseParent, "..");
    }
    if (fs.existsSync(path.join(releaseParent, "backend"))) {
      return releaseParent;
    }
    return toolsParent;
  }

  // Fallback only when module path is unexpected
  return path.resolve(process.cwd());
}

/**
 * Canonical directory for new backup writes.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ homeDir?: string | null }} [options]
 * @returns {string}
 */
function resolveBackupStorageRoot(env = process.env, options = {}) {
  if (env.BACKUP_STORAGE_DIR && String(env.BACKUP_STORAGE_DIR).trim()) {
    return path.resolve(String(env.BACKUP_STORAGE_DIR).trim());
  }
  if (env.BACKUP_DIR && String(env.BACKUP_DIR).trim()) {
    return path.resolve(String(env.BACKUP_DIR).trim());
  }
  const home = detectBackupHomeDir(env, options);
  return path.join(home, "backups", "db");
}

/**
 * Trusted roots for path confinement (canonical + known legacy Admin UI locations).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ homeDir?: string | null }} [options]
 * @returns {string[]}
 */
function listTrustedBackupStorageRoots(env = process.env, options = {}) {
  const home = detectBackupHomeDir(env, options);
  const roots = [
    resolveBackupStorageRoot(env, options),
    path.join(home, "ERP_DATA", "backups"),
    path.join(home, "ERP_DATA", "backups", "db"),
  ];
  // Dedupe resolved paths
  const seen = new Set();
  const out = [];
  for (const r of roots) {
    const abs = path.resolve(r);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/**
 * @param {string} filePath
 * @param {string} rootResolved
 * @returns {boolean}
 */
function isPathInsideRoot(filePath, rootResolved) {
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(rootResolved);
  const rel = path.relative(absRoot, absFile);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? true
    : rel === "";
}

/**
 * Strict confinement: file must sit under one trusted root (never arbitrary DbBackup paths).
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ homeDir?: string | null }} [options]
 * @returns {string} matching trusted root
 */
function assertBackupPathAllowed(filePath, env = process.env, options = {}) {
  const absFile = path.resolve(filePath);
  const roots = listTrustedBackupStorageRoots(env, options);
  for (const root of roots) {
    const rel = path.relative(root, absFile);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return root;
    }
  }
  const err = new Error("Invalid backup file location.");
  err.statusCode = 400;
  err.code = "BACKUP_PATH_INVALID";
  throw err;
}

/**
 * @deprecated Prefer assertBackupPathAllowed (multi-root). Kept for call-site compatibility.
 * @param {string} filePath
 * @param {string} rootResolved
 */
function assertPathUnderRoot(filePath, rootResolved) {
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(rootResolved);
  const rel = path.relative(absRoot, absFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    // Also accept if allowed under trusted multi-root (legacy ERP_DATA while root is backups/db)
    try {
      assertBackupPathAllowed(filePath);
      return;
    } catch {
      const err = new Error("Invalid backup file location.");
      err.statusCode = 400;
      err.code = "BACKUP_PATH_INVALID";
      throw err;
    }
  }
}

module.exports = {
  detectBackupHomeDir,
  resolveBackupStorageRoot,
  listTrustedBackupStorageRoots,
  isPathInsideRoot,
  assertBackupPathAllowed,
  assertPathUnderRoot,
};
