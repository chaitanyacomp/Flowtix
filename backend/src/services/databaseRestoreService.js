/**
 * Phase 3 — Safe customer restore with maintenance mode, verified import, and auto-rollback.
 * Destructive mysql import is never invoked from unit tests without injected stubs.
 */
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
  writeMysqlClientCnf,
} = require("./databaseBackupService");
const {
  evaluateRestoreEligibility,
  verifyBackupFileIntegrity,
  assertPreRestoreBackupValid,
} = require("./restoreEligibility");
const { verifyRestoredDatabase } = require("./restoreVerification");
const {
  enterMaintenanceMode,
  clearMaintenanceMode,
} = require("./maintenanceMode");
const {
  PHASES,
  startRestoreJob,
  setRestorePhase,
  readRestoreStatus,
  toPublicRestoreStatus,
  appendRestoreLog,
} = require("./restoreJobStatus");
const { bumpAuthSessionEpoch } = require("./authSessionEpoch");

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
      // Attach close listener before piping stdin so a fast import cannot miss 'close'.
      const closed = once(child, "close").then(([c]) => (typeof c === "number" ? c : 1));
      pipeline(src, child.stdin)
        .then(() => closed)
        .then(resolve)
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
        `mysql restore failed (exit ${code}). Install MySQL client tools and ensure MYSQL_PATH / PATH is correct.`,
    );
    err.statusCode = 503;
    err.code = "MYSQL_RESTORE_FAILED";
    throw err;
  }
}

const EMERGENCY_IT_MESSAGE =
  "EMERGENCY: Database restore failed and automatic rollback also failed. Maintenance mode remains active. Stop all ERP use and contact IT immediately. Do not clear maintenance mode manually.";

/**
 * @param {{ backupId: number; actingUserId: number }} input
 * @param {{
 *   runMysqlRestoreFromSqlFile?: typeof runMysqlRestoreFromSqlFile;
 *   verifyRestoredDatabase?: typeof verifyRestoredDatabase;
 *   createPreRestoreAutoBackup?: typeof createPreRestoreAutoBackup;
 *   verifyBackupFileIntegrity?: typeof verifyBackupFileIntegrity;
 *   bumpAuthSessionEpoch?: typeof bumpAuthSessionEpoch;
 *   enterMaintenanceMode?: typeof enterMaintenanceMode;
 *   clearMaintenanceMode?: typeof clearMaintenanceMode;
 *   findBackup?: (id: number) => Promise<object | null>;
 *   markBackupRestored?: (id: number) => Promise<boolean>;
 *   skipLock?: boolean;
 * }} [deps] Injected only for disposable/unit tests — never point at production ERP DB.
 */
async function restoreFromBackup(input, deps = {}) {
  const runImport = deps.runMysqlRestoreFromSqlFile || runMysqlRestoreFromSqlFile;
  const verifyDb = deps.verifyRestoredDatabase || verifyRestoredDatabase;
  const createSafety = deps.createPreRestoreAutoBackup || createPreRestoreAutoBackup;
  const verifyFile = deps.verifyBackupFileIntegrity || verifyBackupFileIntegrity;
  const bumpEpoch = deps.bumpAuthSessionEpoch || bumpAuthSessionEpoch;
  const enterMaint = deps.enterMaintenanceMode || enterMaintenanceMode;
  const clearMaint = deps.clearMaintenanceMode || clearMaintenanceMode;
  const findBackup =
    deps.findBackup || ((id) => prisma.dbBackup.findUnique({ where: { id } }));
  const markRestored =
    deps.markBackupRestored ||
    (async (id) => {
      const marked = await prisma.dbBackup.updateMany({
        where: { id },
        data: { status: "RESTORED", restoredAt: new Date() },
      });
      return marked.count > 0;
    });

  const run = async () => {
    const row = await findBackup(input.backupId);
    const eligibility = evaluateRestoreEligibility(row);
    if (!eligibility.eligible) {
      const err = new Error(eligibility.reason || "Backup is not eligible for self-service restore.");
      err.statusCode = eligibility.code === "NOT_FOUND" ? 404 : 400;
      err.code = eligibility.code || "RESTORE_INVALID_TARGET";
      err.itAssistedRequired = eligibility.itAssistedRequired;
      throw err;
    }

    const job = startRestoreJob({
      actorUserId: input.actingUserId,
      targetBackupId: row.id,
      targetFileName: row.fileName,
      targetBackupType: row.backupType,
    });

    enterMaint({
      reason: "database-restore",
      restoreJobId: job.jobId,
      actorUserId: input.actingUserId,
      targetBackupId: row.id,
    });

    let safetyRow = null;
    try {
      setRestorePhase(PHASES.PRECHECK, {
        message: "Verifying backup file integrity…",
      });
      await verifyFile(row);

      setRestorePhase(PHASES.SAFETY_BACKUP, {
        message: "Creating and validating pre-restore safety backup…",
      });
      // eslint-disable-next-line no-console
      console.log("[restore] Pre-restore auto backup before restore of id=", input.backupId);
      safetyRow = await createSafety({ userId: input.actingUserId, beforeBackupId: input.backupId });
      assertPreRestoreBackupValid(safetyRow);
      // Re-hash safety file to confirm on-disk integrity
      await verifyFile({
        ...safetyRow,
        fileSizeBytes: safetyRow.fileSizeBytes,
        checksumSha256: safetyRow.checksumSha256,
      });
      setRestorePhase(PHASES.SAFETY_BACKUP, {
        safetyBackupId: safetyRow.id,
        message: "Safety backup validated.",
      });

      setRestorePhase(PHASES.RESTORING, {
        message: "Importing selected backup into the database…",
      });
      // eslint-disable-next-line no-console
      console.log("[restore] Running mysql import from backup id=", input.backupId);
      await runImport(row.filePath);

      setRestorePhase(PHASES.VERIFYING, {
        message: "Verifying restored database…",
      });
      const verified = await verifyDb();
      if (!verified.ok) {
        throw Object.assign(new Error(verified.message || "Restore verification failed."), {
          statusCode: 503,
          code: verified.code || "RESTORE_VERIFY_FAILED",
          verification: verified,
        });
      }

      // Mark target as RESTORED when the row still exists in the restored snapshot
      let backupHistoryUpdated = false;
      try {
        backupHistoryUpdated = await markRestored(input.backupId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[restore] Could not mark backup RESTORED:", e?.message || e);
      }

      const newEpoch = bumpEpoch();
      clearMaint();
      const successStatus = setRestorePhase(PHASES.COMPLETED, {
        outcome: "SUCCESS",
        forceLogout: true,
        restartRequired: true,
        message:
          "Database restored successfully. API restart and fresh login are required. Users and passwords match the backup date.",
        authSessionEpoch: newEpoch,
        emergency: false,
      });

      appendRestoreLog(
        `COMPLETED targetBackupId=${input.backupId} actorUserId=${input.actingUserId} epoch=${newEpoch}`,
      );

      return {
        ok: true,
        restartRequired: true,
        forceLogout: true,
        backupHistoryUpdated,
        phase: PHASES.COMPLETED,
        restoreStatus: toPublicRestoreStatus(successStatus),
        message: successStatus.message,
      };
    } catch (primaryErr) {
      // If we never got a validated safety backup, do not attempt rollback import
      if (!safetyRow || safetyRow.status !== "CREATED") {
        setRestorePhase(PHASES.FAILED, {
          outcome: "FAILED_NO_ROLLBACK",
          emergency: true,
          message:
            primaryErr.message ||
            "Restore aborted before a valid safety backup existed. Maintenance remains active — contact IT.",
          forceLogout: false,
          restartRequired: false,
        });
        // Keep maintenance active
        const err = primaryErr;
        err.restoreStatus = toPublicRestoreStatus(readRestoreStatus());
        throw err;
      }

      setRestorePhase(PHASES.ROLLING_BACK, {
        message: "Target restore failed — rolling back from pre-restore safety backup…",
        outcome: null,
      });
      // eslint-disable-next-line no-console
      console.error("[restore] Primary restore failed; attempting rollback:", primaryErr.message);

      try {
        await runImport(safetyRow.filePath);
        const rbVerify = await verifyDb();
        if (!rbVerify.ok) {
          throw Object.assign(new Error(rbVerify.message || "Rollback verification failed."), {
            code: "ROLLBACK_VERIFY_FAILED",
          });
        }
        clearMaint();
        const failedStatus = setRestorePhase(PHASES.FAILED, {
          outcome: "RESTORE_FAILED_DATA_RECOVERED",
          emergency: false,
          forceLogout: false,
          restartRequired: true,
          message:
            "Restore of the selected backup failed. The previous database was recovered from the automatic safety backup. Restart the API server and sign in again. The system did not report a successful restore.",
        });
        const err = new Error(failedStatus.message);
        err.statusCode = 503;
        err.code = "RESTORE_FAILED_ROLLED_BACK";
        err.restoreStatus = toPublicRestoreStatus(failedStatus);
        err.rolledBack = true;
        throw err;
      } catch (rollbackErr) {
        if (rollbackErr && rollbackErr.code === "RESTORE_FAILED_ROLLED_BACK") {
          throw rollbackErr;
        }
        setRestorePhase(PHASES.FAILED, {
          outcome: "ROLLBACK_FAILED",
          emergency: true,
          forceLogout: false,
          restartRequired: true,
          message: EMERGENCY_IT_MESSAGE,
        });
        // Keep maintenance lock active
        const err = new Error(EMERGENCY_IT_MESSAGE);
        err.statusCode = 503;
        err.code = "ROLLBACK_FAILED";
        err.emergency = true;
        err.restoreStatus = toPublicRestoreStatus(readRestoreStatus());
        err.causePrimary = primaryErr.message;
        err.causeRollback = rollbackErr.message;
        throw err;
      }
    }
  };

  if (deps.skipLock) return run();
  return withBackupJobLock(run);
}

module.exports = {
  restoreFromBackup,
  runMysqlRestoreFromSqlFile,
  evaluateRestoreEligibility,
  EMERGENCY_IT_MESSAGE,
};
