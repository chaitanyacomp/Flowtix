/**
 * Install / verify / remove Flowtix daily backup scheduled task (Windows).
 *
 * Usage:
 *   node deployment/schedule-backup.js install --home C:\FT-ERP [--time 02:00]
 *   node deployment/schedule-backup.js verify --home C:\FT-ERP
 *   node deployment/schedule-backup.js remove --home C:\FT-ERP
 *   node deployment/schedule-backup.js print-command --home C:\FT-ERP
 *
 * Development homes skip install unless FT_FORCE_BACKUP_SCHEDULE=1 or --force.
 */
const path = require("path");
const {
  installDailyBackupSchedule,
  verifyDailyBackupSchedule,
  removeDailyBackupSchedule,
  buildSchtasksCreateCommand,
  isDevelopmentHome,
  DEFAULT_TIME,
} = require("./lib/backupSchedule");
const { resolveInstallHome } = require("./lib/resolveInstallHome");

function parseArgs(argv) {
  const out = {
    cmd: "verify",
    home: null,
    time: null,
    force: false,
    dryRun: false,
    json: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) {
    out.cmd = String(rest.shift()).toLowerCase();
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--home" && rest[i + 1]) out.home = path.resolve(rest[++i]);
    else if (a === "--time" && rest[i + 1]) out.time = rest[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
  }
  if (!out.home && process.env.FT_ERP_HOME) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  if (!out.home) {
    out.home = resolveInstallHome(__dirname, process.env);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = {
    homeDir: args.home,
    timeLocal: args.time || process.env.BACKUP_SCHEDULE_TIME || DEFAULT_TIME,
    force: args.force,
    dryRun: args.dryRun,
  };

  let result;
  if (args.cmd === "install" || args.cmd === "ensure") {
    result = installDailyBackupSchedule(opts);
  } else if (args.cmd === "verify" || args.cmd === "status") {
    result = verifyDailyBackupSchedule(opts);
  } else if (args.cmd === "remove" || args.cmd === "uninstall") {
    result = removeDailyBackupSchedule(opts);
  } else if (args.cmd === "print-command" || args.cmd === "command") {
    result = buildSchtasksCreateCommand(opts);
    result.developmentHome = isDevelopmentHome(opts.homeDir);
  } else {
    console.error(`[schedule-backup] Unknown command: ${args.cmd}`);
    console.error("  Use: install | verify | remove | print-command");
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[schedule-backup] home=${args.home}`);
    if (result.commandPreview) console.log(`[schedule-backup] ${result.commandPreview}`);
    if (result.message) console.log(`[schedule-backup] ${result.message}`);
    if (result.skipped) console.log(`[schedule-backup] skipped (${result.reason || "n/a"})`);
    if (result.timeLocal) console.log(`[schedule-backup] time=${result.timeLocal}`);
    if (result.nextRun) console.log(`[schedule-backup] nextRun=${result.nextRun}`);
    if (result.present === false) console.log("[schedule-backup] task not present");
  }

  if (result.ok === false) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("[schedule-backup] FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
