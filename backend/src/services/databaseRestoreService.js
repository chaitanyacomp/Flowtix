const fs = require("fs");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const { once } = require("events");
const { prisma } = require("../utils/prisma");
const { parseDatabaseUrl } = require("../utils/databaseUrl");
const {
  withBackupJobLock,
  createPreRestoreAutoBackup,
  getMysqlExecutable,
  getResolvedBackupStorageRoot,
  assertPathUnderRoot,
  writeMysqlClientCnf,
} = require("./databaseBackupService");

/**
 * @param {string} sqlFileAbs
 */
async function runMysqlRestoreFromSqlFile(sqlFileAbs) {
  const dbUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  const mysqlExe = getMysqlExecutable();
  const cnf = await writeMysqlClientCnf(dbUrl);
  const args = [
    `--defaults-extra-file=${cnf}`,
    "--default-character-set=utf8mb4",
    "--binary-mode",
    dbUrl.database,
  ];
  const child = spawn(mysqlExe, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });
  const src = fs.createReadStream(sqlFileAbs);
  let code = 1;
  try {
    code = await new Promise((resolve, reject) => {
      child.on("error", (err) => {
        const e = new Error(
          err && err.code === "ENOENT"
            ? `Could not start mysql (${mysqlExe}). Install MySQL client tools or set MYSQL_PATH in backend .env.`
            : String(err?.message || err),
        );
        e.statusCode = 503;
        e.code = "MYSQL_RESTORE_FAILED";
        reject(e);
      });
      pipeline(src, child.stdin)
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
      await fs.promises.unlink(cnf);
    } catch {
      // ignore
    }
    throw e;
  }
  try {
    await fs.promises.unlink(cnf);
  } catch {
    // ignore
  }
  if (code !== 0) {
    const err = new Error(
      stderr.trim() ||
        `mysql restore failed (exit ${code}). Install MySQL client tools and ensure MYSQL_PATH / PATH is correct. If the database is in an inconsistent state, restore the latest PRE_RESTORE_AUTO backup from the Backup & Restore screen or from disk.`,
    );
    err.statusCode = 503;
    err.code = "MYSQL_RESTORE_FAILED";
    throw err;
  }
}

/**
 * Restore database from a manual CREATED backup. Creates PRE_RESTORE_AUTO dump first (same lock).
 *
 * @param {{ backupId: number; actingUserId: number }} input
 */
async function restoreFromBackup(input) {
  return withBackupJobLock(async () => {
    const row = await prisma.dbBackup.findUnique({ where: { id: input.backupId } });
    if (!row) {
      const err = new Error("Backup not found.");
      err.statusCode = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    if (row.backupType !== "MANUAL" || row.status !== "CREATED") {
      const err = new Error("Only a manual backup in Created status can be restored from this screen.");
      err.statusCode = 400;
      err.code = "RESTORE_INVALID_TARGET";
      throw err;
    }
    const root = getResolvedBackupStorageRoot();
    assertPathUnderRoot(row.filePath, root);
    try {
      await fs.promises.access(row.filePath, fs.constants.R_OK);
    } catch {
      const err = new Error("Backup file is missing on disk.");
      err.statusCode = 400;
      err.code = "BACKUP_FILE_MISSING";
      throw err;
    }

    // eslint-disable-next-line no-console
    console.log("[restore] Pre-restore auto backup before restore of id=", input.backupId);
    await createPreRestoreAutoBackup({ userId: input.actingUserId, beforeBackupId: input.backupId });

    // eslint-disable-next-line no-console
    console.log("[restore] Running mysql import from backup id=", input.backupId);
    await runMysqlRestoreFromSqlFile(row.filePath);

    /**
     * The SQL import replaces the whole schema. The dump may not include `DbBackup` rows (or not this id),
     * so a single-row `update` can throw P2025 → generic "Record not found". Use `updateMany` and treat 0 rows as OK.
     */
    const marked = await prisma.dbBackup.updateMany({
      where: { id: input.backupId },
      data: { status: "RESTORED", restoredAt: new Date() },
    });
    if (marked.count === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[restore] Database import finished but DbBackup id=%s was not updated (row missing in restored snapshot).",
        input.backupId,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log("[restore] Marked backup id=%s as RESTORED", input.backupId);
    }

    // eslint-disable-next-line no-console
    console.log("[restore] Completed restore for backup id=", input.backupId);

    return {
      ok: true,
      restartRequired: true,
      backupHistoryUpdated: marked.count > 0,
      message:
        marked.count > 0
          ? "Database was restored from the selected backup. Stop and restart the API server, then have all users sign in again. If anything looks wrong, use the automatic pre-restore backup entry in Backup History."
          : "Database was restored from the selected backup file. The backup history row could not be updated automatically (the restored database snapshot did not contain that metadata row). Stop and restart the API server, then sign in again. Your automatic pre-restore .sql backup on disk is still valid.",
    };
  });
}

module.exports = { restoreFromBackup, runMysqlRestoreFromSqlFile };
