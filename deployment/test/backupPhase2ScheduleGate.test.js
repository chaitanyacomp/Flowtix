const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateSetupScheduleGate,
  evaluateUpdateScheduleGate,
  buildSchtasksCreateCommand,
  DEFAULT_TIME,
} = require("../lib/backupSchedule");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("deployment Phase 2 schedule gate", () => {
  test("production setup failure without override", () => {
    const gate = evaluateSetupScheduleGate({
      developmentSkip: false,
      allowFailure: false,
      installResult: { ok: false, message: "access denied" },
      verifyResult: { present: false },
    });
    assert.equal(gate.failSetup, true);
  });

  test("update warn-only when valid task remains", () => {
    const gate = evaluateUpdateScheduleGate({
      developmentSkip: false,
      allowFailure: false,
      installResult: { ok: false, message: "create failed" },
      verifyResult: {
        present: true,
        taskToRun: `"D:\\home\\tools\\backup-db.bat" --automatic`,
      },
    });
    assert.equal(gate.warnOnly, true);
    assert.equal(gate.ok, true);
  });

  test("print-command / create args never include secrets", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dep-sched-"));
    fs.mkdirSync(path.join(home, "tools"), { recursive: true });
    fs.writeFileSync(path.join(home, "tools", "backup-db.bat"), "@echo off\n");
    const built = buildSchtasksCreateCommand({ homeDir: home });
    assert.equal(built.timeLocal, DEFAULT_TIME);
    assert.doesNotMatch(built.commandPreview, /DATABASE_URL|password|mysql:\/\//i);
    assert.match(built.tr, /--automatic/);
  });
});
