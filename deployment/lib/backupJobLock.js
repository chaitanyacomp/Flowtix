/**
 * Cross-process backup/restore job lock (CLI + Admin UI).
 * Lock file under {home}/shared/locks/backup-job.lock — never embeds DB credentials.
 *
 * Safety:
 * - Owner token required to release or heartbeat; never unlink another owner's lock.
 * - Long-running jobs stay protected via PID liveness + heartbeat (no fixed 30m steal).
 * - Reclaim only when the owner PID is dead AND heartbeat is stale.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { detectBackupHomeDir } = require("./backupStoragePaths");

const LOCK_FILE_NAME = "backup-job.lock";
/** How often the holder refreshes heartbeatMs. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 1000;
/**
 * After owner PID is dead, wait this long past last heartbeat before reclaim.
 * Alive PIDs are never stolen regardless of age (large dumps may run for hours).
 */
const DEFAULT_HEARTBEAT_STALE_MS = 2 * 60 * 1000;

function getHeartbeatIntervalMs(env = process.env) {
  const raw = env.BACKUP_JOB_LOCK_HEARTBEAT_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_HEARTBEAT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_HEARTBEAT_INTERVAL_MS;
  return n;
}

function getHeartbeatStaleMs(env = process.env) {
  const raw = env.BACKUP_JOB_LOCK_HEARTBEAT_STALE_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_HEARTBEAT_STALE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_HEARTBEAT_STALE_MS;
  return n;
}

/**
 * @deprecated Prefer heartbeat + PID liveness. Kept only for env compatibility docs.
 * Fixed-age steal is no longer used for reclaim.
 */
function getBackupJobLockStaleMs(env = process.env) {
  return getHeartbeatStaleMs(env);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ homeDir?: string | null }} [options]
 * @returns {string}
 */
function resolveBackupJobLockPath(env = process.env, options = {}) {
  if (env.BACKUP_JOB_LOCK_PATH && String(env.BACKUP_JOB_LOCK_PATH).trim()) {
    return path.resolve(String(env.BACKUP_JOB_LOCK_PATH).trim());
  }
  const home = detectBackupHomeDir(env, options);
  return path.join(home, "shared", "locks", LOCK_FILE_NAME);
}

function readLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    return {
      pid: Number(j.pid) || null,
      startedAt: String(j.startedAt || ""),
      startedMs: Number(j.startedMs) || 0,
      heartbeatMs: Number(j.heartbeatMs) || Number(j.startedMs) || 0,
      owner: String(j.owner || ""),
      ownerToken: String(j.ownerToken || ""),
    };
  } catch {
    return null;
  }
}

function writeLockAtomicReplace(lockPath, payload) {
  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8" });
}

/**
 * @param {number|null} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: process exists but we cannot signal it → treat as alive
    return Boolean(e && e.code === "EPERM");
  }
}

/**
 * True while another job still owns the lock.
 * Alive PID ⇒ held forever (safe for multi-hour dumps).
 * Dead PID ⇒ held until heartbeat becomes stale, then reclaimable.
 */
function isLockHeldByLiveOwner(lock, env = process.env, nowMs = Date.now()) {
  if (!lock) return false;
  if (!lock.ownerToken) {
    // Legacy / corrupt lock without token: reclaim only if PID dead (or missing)
    return isProcessAlive(lock.pid);
  }
  if (isProcessAlive(lock.pid)) return true;
  const hb = Number(lock.heartbeatMs) || Number(lock.startedMs) || 0;
  if (!hb) return false;
  return nowMs - hb <= getHeartbeatStaleMs(env);
}

/**
 * @returns {boolean}
 */
function canReclaimLock(lock, env = process.env, nowMs = Date.now()) {
  if (!lock) return true;
  return !isLockHeldByLiveOwner(lock, env, nowMs);
}

/**
 * @returns {{
 *   ok: true,
 *   ownerToken: string,
 *   lockPath: string,
 * } | {
 *   ok: false,
 *   code: 'BACKUP_BUSY',
 *   message: string,
 *   lock?: object,
 * }}
 */
function tryAcquireBackupJobLock(env = process.env, options = {}) {
  const lockPath = resolveBackupJobLockPath(env, options);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const existing = fs.existsSync(lockPath) ? readLock(lockPath) : null;
  if (existing && isLockHeldByLiveOwner(existing, env)) {
    return {
      ok: false,
      code: "BACKUP_BUSY",
      message:
        "Another backup or restore is already running on this server. If nothing is running, wait for automatic lock release or retry after a few minutes.",
      lock: existing,
    };
  }
  if (existing && canReclaimLock(existing, env)) {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore — may race with another reclaim */
    }
  }

  const now = Date.now();
  const ownerToken = crypto.randomBytes(16).toString("hex");
  const payload = {
    pid: process.pid,
    startedAt: new Date(now).toISOString(),
    startedMs: now,
    heartbeatMs: now,
    owner: options.owner || "backup-job",
    ownerToken,
  };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
    return { ok: true, ownerToken, lockPath };
  } catch (e) {
    if (e && e.code === "EEXIST") {
      const again = readLock(lockPath);
      if (again && canReclaimLock(again, env)) {
        try {
          fs.unlinkSync(lockPath);
          fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
          return { ok: true, ownerToken, lockPath };
        } catch {
          /* fall through */
        }
      }
      return {
        ok: false,
        code: "BACKUP_BUSY",
        message:
          "Another backup or restore is already running on this server. If nothing is running, wait for automatic lock release or retry after a few minutes.",
        lock: again,
      };
    }
    throw e;
  }
}

/**
 * Refresh heartbeat. Only succeeds for the matching ownerToken.
 * @returns {{ ok: boolean; reason?: string }}
 */
function touchBackupJobLockHeartbeat(env = process.env, options = {}) {
  const token = options.ownerToken != null ? String(options.ownerToken) : "";
  if (!token) return { ok: false, reason: "missing-token" };
  const lockPath = resolveBackupJobLockPath(env, options);
  try {
    if (!fs.existsSync(lockPath)) return { ok: false, reason: "missing-lock" };
    const lock = readLock(lockPath);
    if (!lock) return { ok: false, reason: "unreadable" };
    if (lock.ownerToken !== token) return { ok: false, reason: "wrong-owner" };
    writeLockAtomicReplace(lockPath, {
      ...lock,
      heartbeatMs: Date.now(),
      pid: process.pid,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Start periodic heartbeat; returns stop function.
 * @returns {() => void}
 */
function startBackupJobLockHeartbeat(env = process.env, options = {}) {
  const intervalMs = getHeartbeatIntervalMs(env);
  const tick = () => {
    touchBackupJobLockHeartbeat(env, options);
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return () => {
    clearInterval(handle);
  };
}

/**
 * Release only when ownerToken matches. Never removes another process's lock.
 * @returns {{ released: boolean; reason?: string }}
 */
function releaseBackupJobLock(env = process.env, options = {}) {
  const token = options.ownerToken != null ? String(options.ownerToken) : "";
  const lockPath = resolveBackupJobLockPath(env, options);
  try {
    if (!fs.existsSync(lockPath)) return { released: true, reason: "already-gone" };
    const lock = readLock(lockPath);
    if (!lock) return { released: false, reason: "unreadable" };
    if (!token) return { released: false, reason: "missing-token" };
    if (lock.ownerToken !== token) return { released: false, reason: "wrong-owner" };
    fs.unlinkSync(lockPath);
    return { released: true };
  } catch (e) {
    return { released: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ homeDir?: string | null; owner?: string; env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<T>}
 */
async function withBackupJobLock(fn, options = {}) {
  const env = options.env || process.env;
  const acquired = tryAcquireBackupJobLock(env, options);
  if (!acquired.ok) {
    const err = new Error(acquired.message);
    err.statusCode = 409;
    err.code = "BACKUP_BUSY";
    throw err;
  }
  const stopHeartbeat = startBackupJobLockHeartbeat(env, {
    ...options,
    ownerToken: acquired.ownerToken,
  });
  try {
    return await fn();
  } finally {
    try {
      stopHeartbeat();
    } catch {
      /* ignore */
    }
    releaseBackupJobLock(env, { ...options, ownerToken: acquired.ownerToken });
  }
}

module.exports = {
  LOCK_FILE_NAME,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_STALE_MS,
  /** @deprecated alias of DEFAULT_HEARTBEAT_STALE_MS — fixed-age steal removed */
  DEFAULT_STALE_MS: DEFAULT_HEARTBEAT_STALE_MS,
  getHeartbeatIntervalMs,
  getHeartbeatStaleMs,
  getBackupJobLockStaleMs,
  resolveBackupJobLockPath,
  tryAcquireBackupJobLock,
  touchBackupJobLockHeartbeat,
  startBackupJobLockHeartbeat,
  releaseBackupJobLock,
  withBackupJobLock,
  readLock,
  isProcessAlive,
  isLockHeldByLiveOwner,
  canReclaimLock,
};
