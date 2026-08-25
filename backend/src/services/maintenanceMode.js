/**
 * Persistent ERP maintenance mode during safe restore (Phase 3).
 * Stored under shared/ — no DB dependency (DB may be mid-restore).
 */
const fs = require("fs");
const path = require("path");
const { resolveRuntimePaths } = require("../runtime/paths");

const FILE_NAME = "maintenance-mode.json";

function resolveMaintenancePath(env = process.env) {
  if (env.FT_MAINTENANCE_MODE_PATH && String(env.FT_MAINTENANCE_MODE_PATH).trim()) {
    return path.resolve(String(env.FT_MAINTENANCE_MODE_PATH).trim());
  }
  const { sharedDir } = resolveRuntimePaths(env);
  return path.join(sharedDir, FILE_NAME);
}

function readMaintenanceState(env = process.env) {
  const p = resolveMaintenancePath(env);
  try {
    if (!fs.existsSync(p)) return { active: false };
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!j || typeof j !== "object") return { active: false };
    return {
      active: Boolean(j.active),
      reason: j.reason || null,
      startedAt: j.startedAt || null,
      restoreJobId: j.restoreJobId || null,
      actorUserId: j.actorUserId ?? null,
      targetBackupId: j.targetBackupId ?? null,
    };
  } catch {
    return { active: false };
  }
}

function isMaintenanceActive(env = process.env) {
  return Boolean(readMaintenanceState(env).active);
}

/**
 * @param {{ reason?: string; restoreJobId?: string; actorUserId?: number; targetBackupId?: number; env?: NodeJS.ProcessEnv }} [opts]
 */
function enterMaintenanceMode(opts = {}) {
  const env = opts.env || process.env;
  const p = resolveMaintenancePath(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = {
    active: true,
    reason: opts.reason || "database-restore",
    startedAt: new Date().toISOString(),
    restoreJobId: opts.restoreJobId || null,
    actorUserId: opts.actorUserId ?? null,
    targetBackupId: opts.targetBackupId ?? null,
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

/**
 * Clear only after successful restore verification or successful rollback verification.
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
function clearMaintenanceMode(opts = {}) {
  const env = opts.env || process.env;
  const p = resolveMaintenancePath(env);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
  return { active: false };
}

/**
 * Paths allowed while maintenance is active (health + restore status only).
 */
function isMaintenanceExemptPath(method, urlPath) {
  const p = String(urlPath || "").split("?")[0];
  if (method === "OPTIONS") return true;
  if (p === "/health" || p === "/api/health" || p === "/api/health/live") return true;
  if (method === "GET" && /\/api\/admin\/backups\/restore-status\/?$/.test(p)) return true;
  return false;
}

module.exports = {
  resolveMaintenancePath,
  readMaintenanceState,
  isMaintenanceActive,
  enterMaintenanceMode,
  clearMaintenanceMode,
  isMaintenanceExemptPath,
};
