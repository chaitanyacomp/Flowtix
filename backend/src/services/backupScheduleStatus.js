/**
 * Admin-visible automatic backup schedule status (no secrets).
 * Pure helpers are unit-tested; schtasks query is best-effort on Windows.
 */
const path = require("path");
const {
  verifyDailyBackupSchedule,
  readScheduleConfig,
  normalizeTimeLocal,
  DEFAULT_TIME,
  DEFAULT_TASK_NAME,
  isDevelopmentHome,
  retentionPolicySummary,
} = require("../../../deployment/lib/backupSchedule");
const { detectBackupHomeDir } = require("./backupStoragePaths");

/** Hours after scheduled time before we treat automatic backup as overdue (default 36h). */
const DEFAULT_OVERDUE_HOURS = 36;

/**
 * @param {{
 *   enabled?: boolean;
 *   timeLocal?: string;
 *   lastAutomaticSuccessAt?: string | Date | null;
 *   lastAutomaticFailureAt?: string | Date | null;
 *   lastAutomaticStatus?: string | null;
 *   now?: Date;
 *   overdueHours?: number;
 * }} input
 */
function buildScheduleWarning(input) {
  const now = input.now instanceof Date ? input.now : new Date();
  const overdueHours = input.overdueHours ?? DEFAULT_OVERDUE_HOURS;
  const overdueMs = overdueHours * 60 * 60 * 1000;

  if (!input.enabled) {
    return { level: null, code: null, message: null };
  }

  const failAt = input.lastAutomaticFailureAt ? new Date(input.lastAutomaticFailureAt) : null;
  const okAt = input.lastAutomaticSuccessAt ? new Date(input.lastAutomaticSuccessAt) : null;

  if (failAt && Number.isFinite(failAt.getTime())) {
    if (!okAt || failAt.getTime() >= okAt.getTime()) {
      return {
        level: "error",
        code: "LAST_SCHEDULED_BACKUP_FAILED",
        message:
          "The latest scheduled automatic backup failed. Check logs/backup-scheduler.log and Backup history.",
      };
    }
  }

  if (!okAt || !Number.isFinite(okAt.getTime())) {
    return {
      level: "warning",
      code: "NO_AUTOMATIC_SUCCESS",
      message:
        "Automatic backups are enabled but no successful automatic backup is recorded yet.",
    };
  }

  if (now.getTime() - okAt.getTime() > overdueMs) {
    return {
      level: "warning",
      code: "SCHEDULED_BACKUP_OVERDUE",
      message: `No successful automatic backup in the last ${overdueHours} hours. The scheduled job may be overdue or not running.`,
    };
  }

  return { level: null, code: null, message: null };
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ homeDir?: string; env?: NodeJS.ProcessEnv; skipSchtasks?: boolean }} [options]
 */
async function getAutomaticBackupScheduleStatus(prisma, options = {}) {
  const env = options.env || process.env;
  const home = path.resolve(options.homeDir || detectBackupHomeDir(env, options));
  const cfg = readScheduleConfig(home) || {};
  const retention = retentionPolicySummary();
  const developmentHome = isDevelopmentHome(home, env);

  let schedule = {
    present: false,
    enabled: Boolean(cfg.enabled),
    timeLocal: normalizeTimeLocal(cfg.timeLocal || env.BACKUP_SCHEDULE_TIME || DEFAULT_TIME),
    taskName: String(cfg.taskName || DEFAULT_TASK_NAME),
    nextRun: null,
    lastRun: null,
    lastResult: null,
    status: null,
    taskToRun: null,
    message: developmentHome ? "Development layout — scheduler not auto-installed" : null,
  };

  if (!options.skipSchtasks && process.platform === "win32" && !developmentHome) {
    try {
      const verified = verifyDailyBackupSchedule({ homeDir: home, env, taskName: schedule.taskName });
      schedule = {
        ...schedule,
        present: Boolean(verified.present),
        enabled: Boolean(verified.present || cfg.enabled),
        timeLocal: normalizeTimeLocal(verified.timeLocal || schedule.timeLocal),
        nextRun: verified.nextRun || null,
        lastRun: verified.lastRun || null,
        lastResult: verified.lastResult || null,
        status: verified.status || null,
        taskToRun: verified.taskToRun || null,
        message: verified.message || schedule.message,
      };
      // Never expose credentials even if somehow present in task string
      if (schedule.taskToRun && /password|DATABASE_URL|mysql:\/\//i.test(schedule.taskToRun)) {
        schedule.taskToRun = "(redacted)";
      }
    } catch (e) {
      schedule.message = e instanceof Error ? e.message : String(e);
    }
  } else if (cfg.enabled) {
    schedule.enabled = true;
  }

  const lastSuccess = await prisma.dbBackup.findFirst({
    where: { backupType: "AUTOMATIC", status: "CREATED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, fileName: true, status: true },
  });
  const lastFailure = await prisma.dbBackup.findFirst({
    where: { backupType: "AUTOMATIC", status: "FAILED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, fileName: true, status: true, remarks: true },
  });

  const lastAutomaticSuccessAt = lastSuccess?.createdAt?.toISOString?.() ?? null;
  const lastAutomaticFailureAt = lastFailure?.createdAt?.toISOString?.() ?? null;

  const warning = buildScheduleWarning({
    enabled: schedule.enabled || schedule.present,
    timeLocal: schedule.timeLocal,
    lastAutomaticSuccessAt,
    lastAutomaticFailureAt,
  });

  return {
    automaticBackupEnabled: Boolean(schedule.enabled || schedule.present),
    scheduledTimeLocal: schedule.timeLocal,
    nextRun: schedule.nextRun,
    lastRun: schedule.lastRun,
    taskPresent: schedule.present,
    taskName: schedule.taskName,
    developmentHome,
    retention,
    lastAutomaticSuccess: lastSuccess
      ? {
          id: lastSuccess.id,
          createdAt: lastAutomaticSuccessAt,
          fileName: lastSuccess.fileName,
          status: lastSuccess.status,
        }
      : null,
    lastAutomaticFailure: lastFailure
      ? {
          id: lastFailure.id,
          createdAt: lastAutomaticFailureAt,
          fileName: lastFailure.fileName,
          status: lastFailure.status,
          remarks: lastFailure.remarks,
        }
      : null,
    warning,
  };
}

module.exports = {
  DEFAULT_OVERDUE_HOURS,
  buildScheduleWarning,
  getAutomaticBackupScheduleStatus,
};
