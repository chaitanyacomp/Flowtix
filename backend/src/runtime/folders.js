/**
 * FT-DEP-001 Batch 2 — ensure runtime folders exist and are writable.
 */
const fs = require("fs");
const path = require("path");

/**
 * @param {string} dir
 * @returns {{ ok: boolean, path: string, error?: string }}
 */
function ensureDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok", "utf8");
    fs.unlinkSync(probe);
    return { ok: true, path: dir };
  } catch (err) {
    return {
      ok: false,
      path: dir,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * @param {{ sharedDir: string, logsDir: string, uploadsDir: string, tempDir: string }} paths
 * @returns {{ ok: boolean, created: string[], failures: Array<{ path: string, error: string }> }}
 */
function ensureRuntimeFolders(paths) {
  const created = [];
  const failures = [];
  const targets = [
    paths.sharedDir,
    paths.uploadsDir,
    paths.tempDir,
    paths.logsDir,
  ];

  for (const dir of targets) {
    const existed = fs.existsSync(dir);
    const result = ensureDirWritable(dir);
    if (!result.ok) {
      failures.push({ path: dir, error: result.error || "unknown" });
    } else if (!existed) {
      created.push(dir);
    }
  }

  return { ok: failures.length === 0, created, failures };
}

module.exports = { ensureDirWritable, ensureRuntimeFolders };
