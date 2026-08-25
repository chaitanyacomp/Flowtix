/**
 * Global auth session epoch — bump after successful restore to invalidate prior JWTs.
 * File-based so it works without schema migration and survives process restart.
 */
const fs = require("fs");
const path = require("path");
const { resolveRuntimePaths } = require("../runtime/paths");

const FILE_NAME = "auth-session-epoch.json";

function resolveEpochPath(env = process.env) {
  if (env.FT_AUTH_SESSION_EPOCH_PATH && String(env.FT_AUTH_SESSION_EPOCH_PATH).trim()) {
    return path.resolve(String(env.FT_AUTH_SESSION_EPOCH_PATH).trim());
  }
  const { sharedDir } = resolveRuntimePaths(env);
  return path.join(sharedDir, FILE_NAME);
}

function getAuthSessionEpoch(env = process.env) {
  const p = resolveEpochPath(env);
  try {
    if (!fs.existsSync(p)) return 0;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const n = Number(j && j.epoch);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * @returns {number} new epoch
 */
function bumpAuthSessionEpoch(env = process.env) {
  const p = resolveEpochPath(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const next = getAuthSessionEpoch(env) + 1;
  fs.writeFileSync(
    p,
    JSON.stringify({ epoch: next, bumpedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
  return next;
}

module.exports = {
  resolveEpochPath,
  getAuthSessionEpoch,
  bumpAuthSessionEpoch,
};
