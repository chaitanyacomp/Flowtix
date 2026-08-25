const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildSchtasksCreateCommand,
  isDevelopmentHome,
  normalizeTimeLocal,
  DEFAULT_TIME,
} = require("../../../deployment/lib/backupSchedule");

describe("backupSchedule command generation", () => {
  test("default time is 02:00 and TR runs backup-db.bat --automatic without secrets", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ft-sched-"));
    fs.mkdirSync(path.join(home, "tools"), { recursive: true });
    const bat = path.join(home, "tools", "backup-db.bat");
    fs.writeFileSync(bat, "@echo off\n");
    const built = buildSchtasksCreateCommand({ homeDir: home, timeLocal: null });
    assert.equal(built.timeLocal, DEFAULT_TIME);
    assert.equal(normalizeTimeLocal("2:00"), "02:00");
    assert.match(built.tr, /backup-db\.bat" --automatic$/);
    assert.ok(built.args.includes("/RU"));
    assert.ok(built.args.includes("SYSTEM"));
    assert.ok(built.args.includes("/F"));
    const joined = built.args.join(" ");
    assert.doesNotMatch(joined, /DATABASE_URL|password|mysql:\/\//i);
    assert.doesNotMatch(built.commandPreview, /DATABASE_URL|password|mysql:\/\//i);
    assert.ok(built.commandPreview.includes("schtasks"));
    assert.ok(built.commandPreview.includes("--automatic"));
  });

  test("configurable time and never creates a real task (dry unit only)", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ft-sched2-"));
    fs.mkdirSync(path.join(home, "tools"), { recursive: true });
    fs.writeFileSync(path.join(home, "tools", "backup-db.bat"), "@echo off\n");
    const built = buildSchtasksCreateCommand({ homeDir: home, timeLocal: "03:30" });
    assert.equal(built.timeLocal, "03:30");
    assert.equal(built.args[built.args.indexOf("/ST") + 1], "03:30");
  });

  test("development home detection skips auto-schedule", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ft-dev-"));
    fs.mkdirSync(path.join(home, "backend", "src"), { recursive: true });
    fs.mkdirSync(path.join(home, "frontend", "src"), { recursive: true });
    assert.equal(isDevelopmentHome(home, {}), true);
    assert.equal(isDevelopmentHome(home, { FT_FORCE_BACKUP_SCHEDULE: "1" }), false);
    assert.equal(isDevelopmentHome(home, { FT_SKIP_BACKUP_SCHEDULE: "1" }), true);
  });
});
