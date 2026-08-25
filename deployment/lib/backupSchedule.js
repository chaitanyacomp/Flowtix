/**
 * Windows Task Scheduler helpers for daily automatic backups.
 * Command never embeds DB credentials — backup-db.bat reads shared/.env at runtime.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { detectBackupHomeDir } = require("./backupStoragePaths");
const { retentionPolicySummary } = require("./backupRetention");

const DEFAULT_TASK_NAME = "Flowtix-ERP-Daily-Backup";
const DEFAULT_TIME = "02:00";

function normalizeTimeLocal(raw) {
  const s = String(raw ?? DEFAULT_TIME).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return DEFAULT_TIME;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function resolveScheduleConfigPath(home) {
  return path.join(home, "shared", "backup-schedule.json");
}

function readScheduleConfig(home) {
  const p = resolveScheduleConfigPath(home);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeScheduleConfig(home, cfg) {
  const p = resolveScheduleConfigPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return p;
}

/**
 * Development / repo layouts must not auto-install the scheduled task.
 */
function isDevelopmentHome(home, env = process.env) {
  if (env.FT_FORCE_BACKUP_SCHEDULE === "1") return false;
  if (env.FT_SKIP_BACKUP_SCHEDULE === "1") return true;
  const h = path.resolve(home);
  if (fs.existsSync(path.join(h, "backend", "src")) && fs.existsSync(path.join(h, "frontend", "src"))) {
    if (!fs.existsSync(path.join(h, "app", "server.js"))) return true;
  }
  return false;
}

function resolveBackupBat(home) {
  const candidates = [
    path.join(home, "tools", "backup-db.bat"),
    path.join(home, "deployment", "backup-db.bat"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(home, "tools", "backup-db.bat");
}

/**
 * Build schtasks /Create argument list (no secrets).
 * @returns {{ taskName: string; timeLocal: string; tr: string; args: string[]; commandPreview: string }}
 */
function buildSchtasksCreateCommand(options = {}) {
  const home = path.resolve(options.homeDir || detectBackupHomeDir(options.env || process.env, options));
  const timeLocal = normalizeTimeLocal(options.timeLocal || process.env.BACKUP_SCHEDULE_TIME || DEFAULT_TIME);
  const taskName = String(options.taskName || DEFAULT_TASK_NAME).trim() || DEFAULT_TASK_NAME;
  const bat = resolveBackupBat(home);
  // Quote path for cmd; --automatic selects AUTOMATIC catalog source. No DATABASE_URL here.
  const tr = `"${bat}" --automatic`;
  const args = [
    "/Create",
    "/TN",
    taskName,
    "/TR",
    tr,
    "/SC",
    "DAILY",
    "/ST",
    timeLocal,
    "/RU",
    "SYSTEM",
    "/RL",
    "HIGHEST",
    "/F",
  ];
  return {
    taskName,
    timeLocal,
    tr,
    batPath: bat,
    home,
    args,
    commandPreview: `schtasks ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`,
  };
}

function runSchtasks(args) {
  const r = spawnSync("schtasks", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function parseSchtasksQuery(stdout) {
  const text = String(stdout || "");
  const get = (label) => {
    const re = new RegExp(`^${label}:\\s*(.+)$`, "im");
    const m = re.exec(text);
    return m ? m[1].trim() : null;
  };
  return {
    taskName: get("TaskName"),
    nextRun: get("Next Run Time") || get("Next Run Time "),
    lastRun: get("Last Run Time"),
    lastResult: get("Last Result"),
    status: get("Status"),
    taskToRun: get("Task To Run"),
    scheduleType: get("Schedule Type"),
    startTime: get("Start Time"),
  };
}

function installDailyBackupSchedule(options = {}) {
  const built = buildSchtasksCreateCommand(options);
  if (isDevelopmentHome(built.home, options.env || process.env) && !options.force) {
    return {
      ok: true,
      skipped: true,
      reason: "development-home",
      message: "Skipped scheduling on development layout (set FT_FORCE_BACKUP_SCHEDULE=1 to override).",
      ...built,
    };
  }
  if (process.platform !== "win32" && !options.force) {
    return {
      ok: true,
      skipped: true,
      reason: "non-windows",
      message: "Scheduled task install is Windows-only.",
      ...built,
    };
  }
  const result = options.dryRun ? { status: 0, stdout: "", stderr: "", error: null } : runSchtasks(built.args);
  if (!options.dryRun && result.status !== 0) {
    return {
      ok: false,
      skipped: false,
      message: (result.stderr || result.stdout || result.error || "schtasks create failed").trim(),
      ...built,
      schtasks: result,
    };
  }
  const cfg = {
    enabled: true,
    timeLocal: built.timeLocal,
    taskName: built.taskName,
    batPath: built.batPath,
    updatedAt: new Date().toISOString(),
  };
  if (!options.dryRun) writeScheduleConfig(built.home, cfg);
  return {
    ok: true,
    skipped: false,
    message: options.dryRun ? "Dry-run create command built" : "Scheduled task installed/updated",
    config: cfg,
    ...built,
    schtasks: result,
  };
}

function verifyDailyBackupSchedule(options = {}) {
  const home = path.resolve(options.homeDir || detectBackupHomeDir(options.env || process.env, options));
  const cfg = readScheduleConfig(home) || {};
  const taskName = String(options.taskName || cfg.taskName || DEFAULT_TASK_NAME);
  if (process.platform !== "win32") {
    return {
      ok: false,
      present: false,
      platform: process.platform,
      taskName,
      timeLocal: normalizeTimeLocal(cfg.timeLocal || DEFAULT_TIME),
      message: "schtasks unavailable on this platform",
      config: cfg,
      retention: retentionPolicySummary(),
    };
  }
  const q = runSchtasks(["/Query", "/TN", taskName, "/V", "/FO", "LIST"]);
  const present = q.status === 0;
  const parsed = present ? parseSchtasksQuery(q.stdout) : null;
  return {
    ok: present,
    present,
    taskName,
    timeLocal: normalizeTimeLocal(parsed?.startTime || cfg.timeLocal || process.env.BACKUP_SCHEDULE_TIME || DEFAULT_TIME),
    nextRun: parsed?.nextRun || null,
    lastRun: parsed?.lastRun || null,
    lastResult: parsed?.lastResult || null,
    status: parsed?.status || null,
    taskToRun: parsed?.taskToRun || null,
    config: cfg,
    retention: retentionPolicySummary(),
    message: present ? "Scheduled task present" : "Scheduled task not found",
    schtasks: { status: q.status, stderr: q.stderr },
  };
}

function removeDailyBackupSchedule(options = {}) {
  const home = path.resolve(options.homeDir || detectBackupHomeDir(options.env || process.env, options));
  const cfg = readScheduleConfig(home) || {};
  const taskName = String(options.taskName || cfg.taskName || DEFAULT_TASK_NAME);
  if (process.platform !== "win32") {
    return { ok: true, skipped: true, message: "non-windows", taskName };
  }
  const r = runSchtasks(["/Delete", "/TN", taskName, "/F"]);
  const nextCfg = { ...cfg, enabled: false, updatedAt: new Date().toISOString(), taskName };
  writeScheduleConfig(home, nextCfg);
  return {
    ok: r.status === 0 || /cannot find|does not exist/i.test(r.stderr + r.stdout),
    taskName,
    message: r.status === 0 ? "Scheduled task removed" : (r.stderr || r.stdout || "").trim(),
    schtasks: r,
  };
}

/**
 * Idempotent install for setup/update — no-op on development homes.
 */
function ensureDailyBackupSchedule(options = {}) {
  return installDailyBackupSchedule({ ...options, force: options.force === true });
}

/**
 * Explicit production bypass for schedule readiness failures.
 * Documented: --allow-schedule-failure | FT_ALLOW_BACKUP_SCHEDULE_FAILURE=1
 */
function isAllowBackupScheduleFailure(env = process.env, options = {}) {
  if (options.allowScheduleFailure === true) return true;
  return String(env.FT_ALLOW_BACKUP_SCHEDULE_FAILURE || "").trim() === "1";
}

/**
 * Existing task is operational when present and TR runs backup-db.bat --automatic (no secrets).
 */
function isOperationalScheduledTask(verifyResult) {
  if (!verifyResult || !verifyResult.present) return false;
  const tr = String(verifyResult.taskToRun || "");
  if (!tr) return false;
  return /backup-db\.bat/i.test(tr) && /--automatic/i.test(tr);
}

/**
 * New customer / production setup gate: install + verify must succeed.
 * Development skip is ok. Bypass only via isAllowBackupScheduleFailure.
 *
 * @param {{
 *   installResult?: object | null;
 *   verifyResult?: object | null;
 *   developmentSkip?: boolean;
 *   allowFailure?: boolean;
 * }} input
 */
function evaluateSetupScheduleGate(input = {}) {
  if (input.developmentSkip) {
    return {
      ok: true,
      skipped: true,
      failSetup: false,
      message: "Skipped scheduling on development layout",
    };
  }
  const installOk = Boolean(input.installResult && input.installResult.ok !== false && !input.installResult.skipped);
  const installSkippedNonDev = Boolean(input.installResult && input.installResult.skipped);
  // non-windows install returns skipped:true ok:true — treat as not production-ready unless allowFailure
  if (installSkippedNonDev && input.installResult.reason === "non-windows") {
    if (input.allowFailure) {
      return {
        ok: true,
        skipped: false,
        bypassed: true,
        failSetup: false,
        message: "Schedule install skipped (non-windows) — bypassed via FT_ALLOW_BACKUP_SCHEDULE_FAILURE",
      };
    }
    return {
      ok: false,
      skipped: false,
      failSetup: true,
      message:
        "Daily backup schedule is required for production readiness but this platform cannot install a Windows scheduled task. Re-run on Windows or set FT_ALLOW_BACKUP_SCHEDULE_FAILURE=1 / --allow-schedule-failure to bypass (documented override only).",
    };
  }
  const verified =
    Boolean(input.verifyResult && input.verifyResult.present) &&
    (isOperationalScheduledTask(input.verifyResult) ||
      (installOk && input.verifyResult.present));
  if (installOk && verified) {
    return {
      ok: true,
      skipped: false,
      failSetup: false,
      message: "Daily backup schedule installed and verified",
    };
  }
  const detail =
    (input.installResult && input.installResult.message) ||
    (input.verifyResult && input.verifyResult.message) ||
    "schedule install/verify failed";
  if (input.allowFailure) {
    return {
      ok: true,
      skipped: false,
      bypassed: true,
      failSetup: false,
      message: `Schedule readiness failed (${detail}) — bypassed via FT_ALLOW_BACKUP_SCHEDULE_FAILURE / --allow-schedule-failure`,
    };
  }
  return {
    ok: false,
    skipped: false,
    failSetup: true,
    message: `Daily backup schedule is required for production readiness: ${detail}. Fix Task Scheduler permissions / schtasks, then re-run setup. Override only with FT_ALLOW_BACKUP_SCHEDULE_FAILURE=1 or --allow-schedule-failure.`,
  };
}

/**
 * Update gate: prefer reinstall; if install fails but an existing valid task remains → warn only.
 *
 * @param {{
 *   installResult?: object | null;
 *   verifyResult?: object | null;
 *   developmentSkip?: boolean;
 *   allowFailure?: boolean;
 * }} input
 */
function evaluateUpdateScheduleGate(input = {}) {
  if (input.developmentSkip) {
    return {
      ok: true,
      skipped: true,
      warnOnly: false,
      failUpdate: false,
      message: "Skipped scheduling on development layout",
    };
  }
  const installOk = Boolean(input.installResult && input.installResult.ok !== false && !input.installResult.skipped);
  const verifiedOk =
    Boolean(input.verifyResult && input.verifyResult.present) &&
    (isOperationalScheduledTask(input.verifyResult) || installOk);

  if (installOk && verifiedOk) {
    return {
      ok: true,
      skipped: false,
      warnOnly: false,
      failUpdate: false,
      message: "Daily backup schedule installed/updated and verified",
    };
  }

  if (isOperationalScheduledTask(input.verifyResult)) {
    return {
      ok: true,
      skipped: false,
      warnOnly: true,
      failUpdate: false,
      message:
        (input.installResult && input.installResult.message
          ? `Schedule update warn: ${input.installResult.message}. `
          : "") + "Existing operational daily backup task remains; continuing update.",
    };
  }

  const detail =
    (input.installResult && input.installResult.message) ||
    (input.verifyResult && input.verifyResult.message) ||
    "no operational daily backup task";

  if (input.allowFailure) {
    return {
      ok: true,
      skipped: false,
      bypassed: true,
      warnOnly: true,
      failUpdate: false,
      message: `Schedule readiness failed (${detail}) — bypassed via FT_ALLOW_BACKUP_SCHEDULE_FAILURE / --allow-schedule-failure`,
    };
  }

  return {
    ok: false,
    skipped: false,
    warnOnly: false,
    failUpdate: true,
    message: `Daily backup schedule is not operational after update: ${detail}. Fix the scheduled task, then re-run update. Override only with FT_ALLOW_BACKUP_SCHEDULE_FAILURE=1 or --allow-schedule-failure.`,
  };
}

/**
 * Run install + verify and evaluate gate for setup or update.
 */
function ensureAndVerifyDailyBackupSchedule(options = {}) {
  const env = options.env || process.env;
  const home = options.homeDir;
  const developmentSkip = isDevelopmentHome(
    home || detectBackupHomeDir(env, options),
    env,
  );
  if (developmentSkip && !options.force) {
    return {
      developmentSkip: true,
      installResult: { ok: true, skipped: true, reason: "development-home" },
      verifyResult: null,
    };
  }
  const installResult = ensureDailyBackupSchedule(options);
  const verifyResult = verifyDailyBackupSchedule(options);
  return { developmentSkip: false, installResult, verifyResult };
}

module.exports = {
  DEFAULT_TASK_NAME,
  DEFAULT_TIME,
  normalizeTimeLocal,
  isDevelopmentHome,
  buildSchtasksCreateCommand,
  installDailyBackupSchedule,
  verifyDailyBackupSchedule,
  removeDailyBackupSchedule,
  ensureDailyBackupSchedule,
  isAllowBackupScheduleFailure,
  isOperationalScheduledTask,
  evaluateSetupScheduleGate,
  evaluateUpdateScheduleGate,
  ensureAndVerifyDailyBackupSchedule,
  readScheduleConfig,
  writeScheduleConfig,
  resolveScheduleConfigPath,
  parseSchtasksQuery,
  retentionPolicySummary,
};
