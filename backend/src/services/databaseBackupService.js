const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const { once } = require("events");
const { prisma } = require("../utils/prisma");
const { parseDatabaseUrl } = require("../utils/databaseUrl");

/** Single-flight lock: one mysqldump or mysql restore at a time (per Node process). */
let backupJobLocked = false;
/** `Date.now()` when lock taken; 0 when free. Used for stale lock recovery if a job crashes without releasing. */
let backupJobLockSince = 0;

/**
 * Default max age (ms) before treating the in-memory lock as stale and allowing a new job.
 * Set `BACKUP_JOB_LOCK_STALE_MS=0` to disable stale recovery (not recommended).
 * Increase if legitimate dumps/restores can exceed this window on your hardware.
 * @returns {number}
 */
function getBackupJobLockStaleMs() {
  const raw = process.env.BACKUP_JOB_LOCK_STALE_MS;
  if (raw == null || String(raw).trim() === "") return 30 * 60 * 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 30 * 60 * 1000;
  if (n === 0) return Number.POSITIVE_INFINITY;
  return n;
}

/**
 * Call once at HTTP server process start so a fresh PID never inherits a stuck flag
 * (normally already false; useful after hot reload / odd embed scenarios).
 */
function resetBackupJobLockOnProcessStart() {
  if (backupJobLocked) {
    // eslint-disable-next-line no-console
    console.warn(
      "[backup] Clearing in-memory backup job lock at process start. If you did not expect this, a previous run may have been interrupted.",
    );
  }
  backupJobLocked = false;
  backupJobLockSince = 0;
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withBackupJobLock(fn) {
  const staleMs = getBackupJobLockStaleMs();
  if (backupJobLocked && backupJobLockSince > 0) {
    const age = Date.now() - backupJobLockSince;
    if (age > staleMs) {
      // eslint-disable-next-line no-console
      console.warn(
        "[backup] Releasing stale backup job lock (held ~%ss, stale threshold ~%ss). A previous backup or restore may not have finished correctly; wait before retrying if mysqldump/mysql might still be running.",
        Math.round(age / 1000),
        Math.round(staleMs / 1000),
      );
      backupJobLocked = false;
      backupJobLockSince = 0;
    }
  }
  if (backupJobLocked) {
    const err = new Error(
      "Another backup or restore is already running on this server. If nothing is running, a previous job may have stopped unexpectedly: wait for automatic lock release, restart the API process, or try again after a few minutes.",
    );
    err.statusCode = 409;
    err.code = "BACKUP_BUSY";
    throw err;
  }
  backupJobLocked = true;
  backupJobLockSince = Date.now();
  try {
    return await fn();
  } finally {
    try {
      backupJobLocked = false;
      backupJobLockSince = 0;
    } catch (clearErr) {
      // eslint-disable-next-line no-console
      console.error("[backup] Failed while clearing backup job lock (forcing unlock):", clearErr);
      backupJobLocked = false;
      backupJobLockSince = 0;
    }
  }
}

/**
 * Default: `<repo>/ERP_DATA/backups` (sibling to `backend/`, outside backend source tree).
 * @returns {string}
 */
function getDefaultBackupStorageRoot() {
  const backendRoot = path.resolve(__dirname, "..", "..");
  return path.resolve(backendRoot, "..", "ERP_DATA", "backups");
}

/**
 * @returns {string}
 */
function getResolvedBackupStorageRoot() {
  const raw = process.env.BACKUP_STORAGE_DIR;
  if (raw && String(raw).trim()) {
    return path.resolve(String(raw).trim());
  }
  return getDefaultBackupStorageRoot();
}

/**
 * @returns {string}
 */
function getMysqldumpExecutable() {
  const p = process.env.MYSQLDUMP_PATH;
  if (p && String(p).trim()) return String(p).trim();
  return process.platform === "win32" ? "mysqldump.exe" : "mysqldump";
}

/**
 * @returns {string}
 */
function getMysqlExecutable() {
  const p = process.env.MYSQL_PATH;
  if (p && String(p).trim()) return String(p).trim();
  return process.platform === "win32" ? "mysql.exe" : "mysql";
}

/**
 * @param {string} filePath
 * @param {string} rootResolved
 */
function assertPathUnderRoot(filePath, rootResolved) {
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(rootResolved);
  const rel = path.relative(absRoot, absFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    const err = new Error("Invalid backup file location.");
    err.statusCode = 400;
    err.code = "BACKUP_PATH_INVALID";
    throw err;
  }
}

/**
 * @param {{ host: string; port: string; user: string; password: string }} conn
 * @returns {Promise<string>} path to temp cnf (caller must unlink in finally)
 */
async function writeMysqlClientCnf(conn) {
  const tmp = path.join(os.tmpdir(), `erp-mysql-cnf-${crypto.randomBytes(8).toString("hex")}.cnf`);
  const lines = [
    "[client]",
    `host=${conn.host}`,
    `port=${conn.port}`,
    `user=${conn.user}`,
    `password=${conn.password.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`,
  ];
  await fs.promises.writeFile(tmp, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return tmp;
}

/**
 * @param {string} exe
 * @param {string[]} args
 * @param {string} outFileAbs
 */
async function runMysqldumpToSqlFile(exe, args, outFileAbs) {
  await fs.promises.mkdir(path.dirname(outFileAbs), { recursive: true });
  const ws = fs.createWriteStream(outFileAbs);
  const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });
  let code = 1;
  try {
    code = await new Promise((resolve, reject) => {
      child.on("error", (err) => {
        const e = new Error(
          err && err.code === "ENOENT"
            ? `Could not start mysqldump (${exe}). Install MySQL client tools or set MYSQLDUMP_PATH in backend .env.`
            : String(err?.message || err),
        );
        e.statusCode = 503;
        e.code = "MYSQLDUMP_FAILED";
        reject(e);
      });
      pipeline(child.stdout, ws)
        .then(() => once(child, "close"))
        .then(([c]) => resolve(typeof c === "number" ? c : 1))
        .catch(reject);
    });
  } catch (e) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    try {
      await fs.promises.unlink(outFileAbs);
    } catch {
      // ignore
    }
    if (e && typeof e === "object" && "statusCode" in e) throw e;
    const err = new Error(e instanceof Error ? e.message : "mysqldump stream failed.");
    err.statusCode = 503;
    err.code = "MYSQLDUMP_FAILED";
    throw err;
  }
  if (code !== 0) {
    try {
      await fs.promises.unlink(outFileAbs);
    } catch {
      // ignore
    }
    const err = new Error(
      stderr.trim() ||
        `mysqldump failed (exit ${code}). Install MySQL client tools and ensure MYSQLDUMP_PATH / PATH is correct on this server.`,
    );
    err.statusCode = 503;
    err.code = "MYSQLDUMP_FAILED";
    throw err;
  }
}

/**
 * @param {{ userId: number; remarks?: string | null }} input
 */
async function createManualBackup(input) {
  return withBackupJobLock(async () => {
    const root = getResolvedBackupStorageRoot();
    await fs.promises.mkdir(root, { recursive: true });

    const dbUrl = parseDatabaseUrl(process.env.DATABASE_URL);
    const exe = getMysqldumpExecutable();
    const cnf = await writeMysqlClientCnf(dbUrl);
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(
      now.getHours(),
    ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const rand = crypto.randomBytes(4).toString("hex");
    const fileName = `mini_erp_${stamp}_${rand}.sql`;
    const outAbs = path.resolve(root, y, m, fileName);

    const dumpArgs = [
      `--defaults-extra-file=${cnf}`,
      "--single-transaction",
      "--routines",
      "--triggers",
      "--set-gtid-purged=OFF",
      "--column-statistics=0",
      "--default-character-set=utf8mb4",
      dbUrl.database,
    ];

    try {
      // eslint-disable-next-line no-console
      console.log("[backup] Starting mysqldump for manual backup:", fileName);
      await runMysqldumpToSqlFile(exe, dumpArgs, outAbs);
    } finally {
      try {
        await fs.promises.unlink(cnf);
      } catch {
        // ignore
      }
    }

    const stat = await fs.promises.stat(outAbs);
    const row = await prisma.dbBackup.create({
      data: {
        fileName,
        filePath: outAbs,
        fileSizeBytes: BigInt(stat.size),
        backupType: "MANUAL",
        status: "CREATED",
        createdByUserId: input.userId,
        remarks: input.remarks && String(input.remarks).trim() ? String(input.remarks).trim().slice(0, 4000) : null,
      },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    // eslint-disable-next-line no-console
    console.log("[backup] Manual backup created id=", row.id, "size=", stat.size);
    return row;
  });
}

/**
 * Safety snapshot before restore.
 * @param {{ userId: number; beforeBackupId: number }} input
 */
async function createPreRestoreAutoBackup(input) {
  const root = getResolvedBackupStorageRoot();
  await fs.promises.mkdir(root, { recursive: true });

  const dbUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  const exe = getMysqldumpExecutable();
  const cnf = await writeMysqlClientCnf(dbUrl);
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(
    now.getHours(),
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const rand = crypto.randomBytes(4).toString("hex");
  const fileName = `pre_restore_${stamp}_${rand}.sql`;
  const outAbs = path.resolve(root, y, m, fileName);
  const dumpArgs = [
    `--defaults-extra-file=${cnf}`,
    "--single-transaction",
    "--routines",
    "--triggers",
    "--set-gtid-purged=OFF",
    "--column-statistics=0",
    "--default-character-set=utf8mb4",
    dbUrl.database,
  ];

  try {
    // eslint-disable-next-line no-console
    console.log("[backup] Starting pre-restore auto mysqldump:", fileName);
    await runMysqldumpToSqlFile(exe, dumpArgs, outAbs);
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      // ignore
    }
  }

  const stat = await fs.promises.stat(outAbs);
  const remarks = `Automatic safety backup before restore of backup #${input.beforeBackupId}`;
  const row = await prisma.dbBackup.create({
    data: {
      fileName,
      filePath: outAbs,
      fileSizeBytes: BigInt(stat.size),
      backupType: "PRE_RESTORE_AUTO",
      status: "CREATED",
      createdByUserId: input.userId,
      remarks,
    },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  // eslint-disable-next-line no-console
  console.log("[backup] Pre-restore backup created id=", row.id);
  return row;
}

/**
 * @param {import("@prisma/client").DbBackup & { createdBy?: unknown }} row
 */
function toPublicBackup(row) {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes == null ? null : Number(row.fileSizeBytes),
    backupType: row.backupType,
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    restoredAt: row.restoredAt instanceof Date ? row.restoredAt.toISOString() : row.restoredAt,
    remarks: row.remarks,
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          name: row.createdBy.name,
          email: row.createdBy.email,
        }
      : null,
  };
}

/**
 * @param {number} id
 */
async function getBackupForAdminOrThrow(id) {
  const row = await prisma.dbBackup.findUnique({
    where: { id },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  if (!row) {
    const err = new Error("Backup not found.");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  const root = getResolvedBackupStorageRoot();
  assertPathUnderRoot(row.filePath, root);
  return row;
}

/**
 * @param {number} id
 */
async function deleteBackupById(id) {
  return withBackupJobLock(async () => {
    const row = await getBackupForAdminOrThrow(id);
    try {
      await fs.promises.unlink(row.filePath);
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }
    await prisma.dbBackup.delete({ where: { id: row.id } });
    // eslint-disable-next-line no-console
    console.log("[backup] Deleted backup id=", id);
    return { ok: true };
  });
}

module.exports = {
  withBackupJobLock,
  resetBackupJobLockOnProcessStart,
  getResolvedBackupStorageRoot,
  getMysqldumpExecutable,
  getMysqlExecutable,
  assertPathUnderRoot,
  createManualBackup,
  createPreRestoreAutoBackup,
  toPublicBackup,
  getBackupForAdminOrThrow,
  deleteBackupById,
  writeMysqlClientCnf,
  parseDatabaseUrl,
};
