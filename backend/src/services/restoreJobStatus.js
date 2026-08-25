/**
 * Restore job status / phase tracking (Phase 3).
 * Phases: PRECHECK → SAFETY_BACKUP → RESTORING → VERIFYING → ROLLING_BACK | COMPLETED | FAILED
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { resolveRuntimePaths } = require("../runtime/paths");

const STATUS_FILE = "restore-status.json";
const LOG_FILE = "restore.log";

const PHASES = Object.freeze({
  PRECHECK: "PRECHECK",
  SAFETY_BACKUP: "SAFETY_BACKUP",
  RESTORING: "RESTORING",
  VERIFYING: "VERIFYING",
  ROLLING_BACK: "ROLLING_BACK",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});

function resolveStatusPath(env = process.env) {
  if (env.FT_RESTORE_STATUS_PATH && String(env.FT_RESTORE_STATUS_PATH).trim()) {
    return path.resolve(String(env.FT_RESTORE_STATUS_PATH).trim());
  }
  const { sharedDir } = resolveRuntimePaths(env);
  return path.join(sharedDir, STATUS_FILE);
}

function resolveLogPath(env = process.env) {
  const { logsDir } = resolveRuntimePaths(env);
  return path.join(logsDir, LOG_FILE);
}

function appendRestoreLog(line, env = process.env) {
  try {
    const p = resolveLogPath(env);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
}

function readRestoreStatus(env = process.env) {
  const p = resolveStatusPath(env);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeRestoreStatus(status, env = process.env) {
  const p = resolveStatusPath(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = {
    ...status,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + "\n", "utf8");
  appendRestoreLog(
    `phase=${payload.phase} job=${payload.jobId} targetBackupId=${payload.targetBackupId ?? ""} outcome=${payload.outcome || ""}`,
    env,
  );
  return payload;
}

function startRestoreJob({ actorUserId, targetBackupId, targetFileName, targetBackupType, env = process.env }) {
  const jobId = crypto.randomBytes(8).toString("hex");
  return writeRestoreStatus(
    {
      jobId,
      phase: PHASES.PRECHECK,
      phaseStartedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      actorUserId,
      targetBackupId,
      targetFileName: targetFileName || null,
      targetBackupType: targetBackupType || null,
      safetyBackupId: null,
      outcome: null,
      message: null,
      emergency: false,
      forceLogout: false,
      restartRequired: false,
      timestamps: { PRECHECK: new Date().toISOString() },
    },
    env,
  );
}

function setRestorePhase(phase, patch = {}, env = process.env) {
  const cur = readRestoreStatus(env) || {};
  const timestamps = { ...(cur.timestamps || {}), [phase]: new Date().toISOString() };
  return writeRestoreStatus(
    {
      ...cur,
      ...patch,
      phase,
      phaseStartedAt: new Date().toISOString(),
      timestamps,
    },
    env,
  );
}

/** Public DTO — never exposes file paths or credentials. */
function toPublicRestoreStatus(status) {
  if (!status) {
    return {
      active: false,
      phase: null,
      message: null,
      emergency: false,
    };
  }
  const terminal = status.phase === PHASES.COMPLETED || status.phase === PHASES.FAILED;
  return {
    active: !terminal && Boolean(status.jobId),
    jobId: status.jobId || null,
    phase: status.phase || null,
    startedAt: status.startedAt || null,
    updatedAt: status.updatedAt || null,
    actorUserId: status.actorUserId ?? null,
    targetBackupId: status.targetBackupId ?? null,
    targetFileName: status.targetFileName || null,
    targetBackupType: status.targetBackupType || null,
    safetyBackupId: status.safetyBackupId ?? null,
    outcome: status.outcome || null,
    message: status.message || null,
    emergency: Boolean(status.emergency),
    forceLogout: Boolean(status.forceLogout),
    restartRequired: Boolean(status.restartRequired),
    timestamps: status.timestamps || {},
  };
}

module.exports = {
  PHASES,
  resolveStatusPath,
  resolveLogPath,
  appendRestoreLog,
  readRestoreStatus,
  writeRestoreStatus,
  startRestoreJob,
  setRestorePhase,
  toPublicRestoreStatus,
};
