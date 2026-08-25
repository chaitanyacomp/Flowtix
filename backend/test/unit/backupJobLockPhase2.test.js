const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  tryAcquireBackupJobLock,
  releaseBackupJobLock,
  withBackupJobLock,
  resolveBackupJobLockPath,
  isLockHeldByLiveOwner,
  canReclaimLock,
  readLock,
  touchBackupJobLockHeartbeat,
} = require("../../../deployment/lib/backupJobLock");
const { assertBackupPathAllowed } = require("../../../deployment/lib/backupStoragePaths");
const {
  evaluateSetupScheduleGate,
  evaluateUpdateScheduleGate,
  isOperationalScheduledTask,
  isAllowBackupScheduleFailure,
} = require("../../../deployment/lib/backupSchedule");

function tmpLockEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-lock-"));
  const lockPath = path.join(dir, "backup-job.lock");
  return {
    dir,
    lockPath,
    env: {
      ...process.env,
      BACKUP_JOB_LOCK_PATH: lockPath,
      BACKUP_JOB_LOCK_HEARTBEAT_STALE_MS: "5000",
      ...extra,
    },
  };
}

describe("backupJobLock cross-process", () => {
  test("second acquire returns BACKUP_BUSY while first holds lock", () => {
    const { env } = tmpLockEnv();
    const a = tryAcquireBackupJobLock(env, { owner: "a" });
    assert.equal(a.ok, true);
    assert.ok(a.ownerToken);
    const b = tryAcquireBackupJobLock(env, { owner: "b" });
    assert.equal(b.ok, false);
    assert.equal(b.code, "BACKUP_BUSY");
    const rel = releaseBackupJobLock(env, { ownerToken: a.ownerToken });
    assert.equal(rel.released, true);
    const c = tryAcquireBackupJobLock(env, { owner: "c" });
    assert.equal(c.ok, true);
    releaseBackupJobLock(env, { ownerToken: c.ownerToken });
  });

  test("long-running lock with live PID is not stolen after 30+ minutes", () => {
    const { env, lockPath } = tmpLockEnv();
    const a = tryAcquireBackupJobLock(env, { owner: "long-dump" });
    assert.equal(a.ok, true);
    const lock = readLock(lockPath);
    // Simulate a dump that started > 30 minutes ago but is still running (this PID).
    const aged = {
      ...lock,
      startedMs: Date.now() - 45 * 60 * 1000,
      heartbeatMs: Date.now() - 10 * 1000,
      pid: process.pid,
    };
    fs.writeFileSync(lockPath, JSON.stringify(aged, null, 2) + "\n", "utf8");
    assert.equal(isLockHeldByLiveOwner(aged, env), true);
    assert.equal(canReclaimLock(aged, env), false);
    const b = tryAcquireBackupJobLock(env, { owner: "thief" });
    assert.equal(b.ok, false);
    assert.equal(b.code, "BACKUP_BUSY");
    releaseBackupJobLock(env, { ownerToken: a.ownerToken });
  });

  test("stale owner (dead PID + expired heartbeat) can be reclaimed", () => {
    const { env, lockPath } = tmpLockEnv({ BACKUP_JOB_LOCK_HEARTBEAT_STALE_MS: "1000" });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 1,
        startedAt: new Date(0).toISOString(),
        startedMs: Date.now() - 60_000,
        heartbeatMs: Date.now() - 60_000,
        owner: "dead",
        ownerToken: "dead-token",
      }),
      "utf8",
    );
    assert.equal(canReclaimLock(readLock(lockPath), env), true);
    const a = tryAcquireBackupJobLock(env, { owner: "fresh" });
    assert.equal(a.ok, true);
    releaseBackupJobLock(env, { ownerToken: a.ownerToken });
  });

  test("wrong-owner release never removes another process lock", () => {
    const { env, lockPath } = tmpLockEnv();
    const a = tryAcquireBackupJobLock(env, { owner: "owner-a" });
    assert.equal(a.ok, true);
    const wrong = releaseBackupJobLock(env, { ownerToken: "not-the-token" });
    assert.equal(wrong.released, false);
    assert.equal(wrong.reason, "wrong-owner");
    assert.equal(fs.existsSync(lockPath), true);
    const missing = releaseBackupJobLock(env, {});
    assert.equal(missing.released, false);
    assert.equal(missing.reason, "missing-token");
    assert.equal(fs.existsSync(lockPath), true);
    const ok = releaseBackupJobLock(env, { ownerToken: a.ownerToken });
    assert.equal(ok.released, true);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test("heartbeat touch rejects wrong owner token", () => {
    const { env } = tmpLockEnv();
    const a = tryAcquireBackupJobLock(env, { owner: "hb" });
    assert.equal(a.ok, true);
    const bad = touchBackupJobLockHeartbeat(env, { ownerToken: "nope" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "wrong-owner");
    const good = touchBackupJobLockHeartbeat(env, { ownerToken: a.ownerToken });
    assert.equal(good.ok, true);
    releaseBackupJobLock(env, { ownerToken: a.ownerToken });
  });

  test("withBackupJobLock throws BACKUP_BUSY when contended", async () => {
    const { env } = tmpLockEnv();
    let releaseOuter;
    const held = new Promise((resolve) => {
      releaseOuter = resolve;
    });
    const p1 = withBackupJobLock(async () => {
      await held;
      return "ok";
    }, { env, owner: "p1" });
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(
      () => withBackupJobLock(async () => "nope", { env, owner: "p2" }),
      (err) => err.code === "BACKUP_BUSY" && err.statusCode === 409,
    );
    releaseOuter();
    assert.equal(await p1, "ok");
  });

  test("retention concurrency: restore/manual cannot acquire while retention holder keeps lock", async () => {
    const { env } = tmpLockEnv();
    let finishRetention;
    const retentionDone = new Promise((resolve) => {
      finishRetention = resolve;
    });
    const retentionJob = withBackupJobLock(async () => {
      // Simulate retention file/catalog deletes under the same shared lock.
      await retentionDone;
      return "retention-ok";
    }, { env, owner: "automatic-retention" });
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(
      () => withBackupJobLock(async () => "manual", { env, owner: "admin-manual" }),
      (err) => err.code === "BACKUP_BUSY",
    );
    await assert.rejects(
      () => withBackupJobLock(async () => "restore", { env, owner: "admin-restore" }),
      (err) => err.code === "BACKUP_BUSY",
    );
    finishRetention();
    assert.equal(await retentionJob, "retention-ok");
    const after = await withBackupJobLock(async () => "free", { env, owner: "after" });
    assert.equal(after, "free");
  });

  test("resolveBackupJobLockPath uses override", () => {
    const p = resolveBackupJobLockPath({ BACKUP_JOB_LOCK_PATH: "C:\\x\\lock.json" });
    assert.equal(path.normalize(p), path.normalize("C:\\x\\lock.json"));
  });
});

describe("retention path safety", () => {
  test("assertBackupPathAllowed rejects paths outside trusted roots", () => {
    const home = path.join(os.tmpdir(), `ft-home-${Date.now()}`);
    assert.throws(
      () => assertBackupPathAllowed("C:\\Windows\\Temp\\evil.sql", {}, { homeDir: home }),
      (err) => err.code === "BACKUP_PATH_INVALID",
    );
  });
});

describe("setup schedule production readiness", () => {
  test("setup fails when schedule install/verify fails without override", () => {
    const gate = evaluateSetupScheduleGate({
      developmentSkip: false,
      allowFailure: false,
      installResult: { ok: false, skipped: false, message: "schtasks create failed" },
      verifyResult: { present: false, ok: false, message: "not found" },
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.failSetup, true);
    assert.match(gate.message, /production readiness/i);
  });

  test("setup succeeds with documented allow-schedule-failure bypass", () => {
    assert.equal(isAllowBackupScheduleFailure({ FT_ALLOW_BACKUP_SCHEDULE_FAILURE: "1" }), true);
    const gate = evaluateSetupScheduleGate({
      developmentSkip: false,
      allowFailure: true,
      installResult: { ok: false, skipped: false, message: "access denied" },
      verifyResult: { present: false },
    });
    assert.equal(gate.ok, true);
    assert.equal(gate.bypassed, true);
    assert.equal(gate.failSetup, false);
  });

  test("setup skips on development layout", () => {
    const gate = evaluateSetupScheduleGate({ developmentSkip: true });
    assert.equal(gate.ok, true);
    assert.equal(gate.skipped, true);
  });

  test("update warns only when existing operational task remains", () => {
    const gate = evaluateUpdateScheduleGate({
      developmentSkip: false,
      allowFailure: false,
      installResult: { ok: false, skipped: false, message: "schtasks create failed" },
      verifyResult: {
        present: true,
        ok: true,
        taskToRun: `"C:\\FT-ERP\\tools\\backup-db.bat" --automatic`,
      },
    });
    assert.equal(gate.ok, true);
    assert.equal(gate.warnOnly, true);
    assert.equal(gate.failUpdate, false);
  });

  test("update fails when no operational task remains", () => {
    const gate = evaluateUpdateScheduleGate({
      developmentSkip: false,
      allowFailure: false,
      installResult: { ok: false, message: "failed" },
      verifyResult: { present: false },
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.failUpdate, true);
  });

  test("isOperationalScheduledTask requires backup-db.bat --automatic", () => {
    assert.equal(
      isOperationalScheduledTask({
        present: true,
        taskToRun: `"C:\\x\\backup-db.bat" --automatic`,
      }),
      true,
    );
    assert.equal(
      isOperationalScheduledTask({
        present: true,
        taskToRun: `"C:\\x\\backup-db.bat"`,
      }),
      false,
    );
  });
});
