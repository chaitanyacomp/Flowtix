const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { evaluateRestoreEligibility, assertPreRestoreBackupValid } = require("../../src/services/restoreEligibility");
const {
  isMaintenanceActive,
  enterMaintenanceMode,
  clearMaintenanceMode,
  isMaintenanceExemptPath,
} = require("../../src/services/maintenanceMode");
const { bumpAuthSessionEpoch, getAuthSessionEpoch } = require("../../src/services/authSessionEpoch");
const { signAccessToken, verifyAccessToken } = require("../../src/utils/jwt");
const { restoreFromBackup, EMERGENCY_IT_MESSAGE } = require("../../src/services/databaseRestoreService");
const { withBackupJobLock } = require("../../../deployment/lib/backupJobLock");
const { readRestoreStatus } = require("../../src/services/restoreJobStatus");

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-restore3-"));
  return {
    dir,
    env: {
      ...process.env,
      FT_ERP_HOME: dir,
      SHARED_DIR: path.join(dir, "shared"),
      LOG_DIR: path.join(dir, "logs"),
      FT_MAINTENANCE_MODE_PATH: path.join(dir, "shared", "maintenance-mode.json"),
      FT_AUTH_SESSION_EPOCH_PATH: path.join(dir, "shared", "auth-session-epoch.json"),
      FT_RESTORE_STATUS_PATH: path.join(dir, "shared", "restore-status.json"),
      JWT_SECRET: "phase3-test-secret",
      BACKUP_JOB_LOCK_PATH: path.join(dir, "shared", "locks", "backup-job.lock"),
    },
  };
}

function eligibleRow(overrides = {}) {
  return {
    id: 42,
    fileName: "eligible.sql",
    filePath: "C:\\virtual\\eligible.sql",
    backupType: "MANUAL",
    status: "CREATED",
    fileSizeBytes: 128,
    checksumSha256: "a".repeat(64),
    userCount: 3,
    activeAdminCount: 1,
    createdAt: new Date("2026-08-01T02:00:00Z"),
    ...overrides,
  };
}

describe("restore eligibility Phase 3", () => {
  test("checksum/metadata missing requires IT-assisted restore", () => {
    const r = evaluateRestoreEligibility({
      id: 1,
      backupType: "MANUAL",
      status: "CREATED",
      fileName: "a.sql",
      fileSizeBytes: null,
      checksumSha256: null,
      userCount: 2,
      activeAdminCount: 1,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.itAssistedRequired, true);
    assert.equal(r.code, "IT_ASSISTED_REQUIRED");
  });

  test("zero Admin blocks self-service restore", () => {
    const r = evaluateRestoreEligibility({
      id: 2,
      backupType: "AUTOMATIC",
      status: "CREATED",
      fileName: "b.sql",
      fileSizeBytes: 100,
      checksumSha256: "a".repeat(64),
      userCount: 5,
      activeAdminCount: 0,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.code, "ZERO_ADMIN_OR_USERS");
  });

  test("validated MANUAL/AUTOMATIC/DEPLOYMENT are eligible", () => {
    for (const backupType of ["MANUAL", "AUTOMATIC", "DEPLOYMENT"]) {
      const r = evaluateRestoreEligibility(eligibleRow({ backupType }));
      assert.equal(r.eligible, true, backupType);
    }
  });

  test("PRE_RESTORE_AUTO is rollback-only", () => {
    const r = evaluateRestoreEligibility(eligibleRow({ backupType: "PRE_RESTORE_AUTO" }));
    assert.equal(r.eligible, false);
    assert.equal(r.code, "ROLLBACK_ONLY");
  });
});

describe("maintenance mode Phase 3", () => {
  let prevEnv;
  let tmp;
  beforeEach(() => {
    tmp = tmpEnv();
    prevEnv = process.env;
    process.env = tmp.env;
  });
  afterEach(() => {
    process.env = prevEnv;
  });

  test("blocks non-exempt paths while active", () => {
    enterMaintenanceMode({ env: tmp.env, reason: "database-restore", actorUserId: 1 });
    assert.equal(isMaintenanceActive(tmp.env), true);
    assert.equal(isMaintenanceExemptPath("GET", "/api/health"), true);
    assert.equal(isMaintenanceExemptPath("GET", "/api/admin/backups/restore-status"), true);
    assert.equal(isMaintenanceExemptPath("POST", "/api/items"), false);
    clearMaintenanceMode({ env: tmp.env });
    assert.equal(isMaintenanceActive(tmp.env), false);
  });
});

describe("token invalidation Phase 3", () => {
  let prevEnv;
  let tmp;
  beforeEach(() => {
    tmp = tmpEnv();
    prevEnv = process.env;
    process.env = tmp.env;
  });
  afterEach(() => {
    process.env = prevEnv;
  });

  test("bumping auth session epoch invalidates prior tokens", () => {
    const token = signAccessToken({ userId: 1, email: "a@b.com", role: "ADMIN", name: "A" });
    assert.ok(verifyAccessToken(token));
    bumpAuthSessionEpoch(tmp.env);
    assert.throws(() => verifyAccessToken(token), (err) => err.name === "SessionEpochError");
  });
});

describe("restore orchestration Phase 3 (stubbed — never hits live ERP DB)", () => {
  let prevEnv;
  let tmp;
  beforeEach(() => {
    tmp = tmpEnv();
    prevEnv = process.env;
    process.env = tmp.env;
    clearMaintenanceMode({ env: tmp.env });
  });
  afterEach(() => {
    clearMaintenanceMode({ env: tmp.env });
    process.env = prevEnv;
  });

  function baseDeps(extra = {}) {
    const safety = eligibleRow({
      id: 99,
      backupType: "PRE_RESTORE_AUTO",
      fileName: "pre.sql",
      filePath: "C:\\virtual\\pre.sql",
    });
    return {
      skipLock: true,
      findBackup: async () => eligibleRow(),
      verifyBackupFileIntegrity: async () => ({ sizeBytes: 128, checksumSha256: "a".repeat(64) }),
      createPreRestoreAutoBackup: async () => safety,
      runMysqlRestoreFromSqlFile: async () => {},
      verifyRestoredDatabase: async () => ({
        ok: true,
        details: { userCount: 3, activeAdminCount: 1 },
      }),
      bumpAuthSessionEpoch: () => bumpAuthSessionEpoch(tmp.env),
      enterMaintenanceMode: (o) => enterMaintenanceMode({ ...o, env: tmp.env }),
      clearMaintenanceMode: () => clearMaintenanceMode({ env: tmp.env }),
      markBackupRestored: async () => true,
      ...extra,
    };
  }

  test("successful restore clears maintenance and bumps epoch", async () => {
    const epochBefore = getAuthSessionEpoch(tmp.env);
    const res = await restoreFromBackup({ backupId: 42, actingUserId: 7 }, baseDeps());
    assert.equal(res.ok, true);
    assert.equal(res.forceLogout, true);
    assert.equal(res.restartRequired, true);
    assert.equal(isMaintenanceActive(tmp.env), false);
    assert.ok(getAuthSessionEpoch(tmp.env) > epochBefore);
    assert.equal(readRestoreStatus(tmp.env).phase, "COMPLETED");
  });

  test("failed import with successful rollback recovers data and does not report success", async () => {
    const calls = [];
    let caught = null;
    try {
      await restoreFromBackup(
        { backupId: 42, actingUserId: 7 },
        baseDeps({
          runMysqlRestoreFromSqlFile: async (filePath) => {
            calls.push(String(filePath));
            if (calls.length === 1) {
              const err = new Error("import failed");
              err.code = "MYSQL_RESTORE_FAILED";
              throw err;
            }
          },
          verifyRestoredDatabase: async () => ({
            ok: true,
            details: { userCount: 3, activeAdminCount: 1 },
          }),
        }),
      );
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "expected restore to fail after rollback");
    assert.equal(caught.code, "RESTORE_FAILED_ROLLED_BACK", `got ${caught.code} primary=${caught.causePrimary} rb=${caught.causeRollback}`);
    assert.equal(caught.rolledBack, true);
    assert.equal(calls.length, 2);
    assert.equal(isMaintenanceActive(tmp.env), false);
    assert.equal(readRestoreStatus(tmp.env).outcome, "RESTORE_FAILED_DATA_RECOVERED");
  });

  test("failed rollback keeps maintenance lock and emergency message", async () => {
    await assert.rejects(
      () =>
        restoreFromBackup(
          { backupId: 42, actingUserId: 7 },
          baseDeps({
            runMysqlRestoreFromSqlFile: async () => {
              const err = new Error("import failed");
              err.code = "MYSQL_RESTORE_FAILED";
              throw err;
            },
          }),
        ),
      (err) => err.code === "ROLLBACK_FAILED" && err.emergency === true && /EMERGENCY/i.test(err.message),
    );
    assert.equal(isMaintenanceActive(tmp.env), true);
    assert.match(EMERGENCY_IT_MESSAGE, /EMERGENCY/);
  });

  test("checksum failure aborts before import", async () => {
    let imported = false;
    await assert.rejects(
      () =>
        restoreFromBackup(
          { backupId: 42, actingUserId: 7 },
          baseDeps({
            verifyBackupFileIntegrity: async () => {
              const err = new Error("checksum");
              err.code = "BACKUP_CHECKSUM_MISMATCH";
              err.statusCode = 400;
              throw err;
            },
            runMysqlRestoreFromSqlFile: async () => {
              imported = true;
            },
          }),
        ),
      (err) => err.code === "BACKUP_CHECKSUM_MISMATCH",
    );
    assert.equal(imported, false);
  });

  test("concurrent operations blocked by shared lock during restore", async () => {
    let releaseHold;
    const hold = new Promise((r) => {
      releaseHold = r;
    });
    const p1 = withBackupJobLock(
      async () => {
        await hold;
        return "restore-sim";
      },
      { env: tmp.env, owner: "restore" },
    );
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(
      () => withBackupJobLock(async () => "other", { env: tmp.env, owner: "manual" }),
      (err) => err.code === "BACKUP_BUSY",
    );
    releaseHold();
    assert.equal(await p1, "restore-sim");
  });

  test("assertPreRestoreBackupValid rejects zero Admin safety dump", () => {
    assert.throws(
      () =>
        assertPreRestoreBackupValid({
          status: "CREATED",
          checksumSha256: "d".repeat(64),
          fileSizeBytes: 10,
          userCount: 1,
          activeAdminCount: 0,
        }),
      (err) => err.code === "SAFETY_BACKUP_INVALID",
    );
  });
});
