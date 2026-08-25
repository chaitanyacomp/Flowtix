const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  hashBackupFileSha256,
  buildValidationWarnings,
  serializeValidationWarnings,
  parseValidationWarnings,
  WARNING_ZERO_USERS,
  WARNING_ZERO_ACTIVE_ADMINS,
} = require("../../src/services/backupValidation");
const { toPublicBackup } = require("../../src/services/databaseBackupService");

describe("backupValidation", () => {
  test("rejects zero-byte backup files", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bk-val-"));
    const empty = path.join(dir, "empty.sql");
    await fs.promises.writeFile(empty, "");
    await assert.rejects(() => hashBackupFileSha256(empty), (err) => {
      assert.equal(err.code, "BACKUP_EMPTY");
      return true;
    });
  });

  test("hashes non-empty file and returns size", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bk-val-"));
    const file = path.join(dir, "ok.sql");
    await fs.promises.writeFile(file, "-- sample dump\n");
    const { sizeBytes, checksumSha256 } = await hashBackupFileSha256(file);
    assert.ok(sizeBytes > 0);
    assert.match(checksumSha256, /^[a-f0-9]{64}$/);
  });

  test("flags zero users and zero active admins", () => {
    assert.deepEqual(buildValidationWarnings({ userCount: 0, activeAdminCount: 0 }), [
      WARNING_ZERO_USERS,
      WARNING_ZERO_ACTIVE_ADMINS,
    ]);
    assert.deepEqual(buildValidationWarnings({ userCount: 3, activeAdminCount: 1 }), []);
    assert.equal(
      serializeValidationWarnings([WARNING_ZERO_USERS]),
      WARNING_ZERO_USERS,
    );
    assert.deepEqual(parseValidationWarnings("ZERO_USERS,ZERO_ACTIVE_ADMINS"), [
      WARNING_ZERO_USERS,
      WARNING_ZERO_ACTIVE_ADMINS,
    ]);
  });
});

describe("toPublicBackup catalog DTO", () => {
  test("exposes validation fields and never filePath", () => {
    const pub = toPublicBackup({
      id: 9,
      fileName: "flowtix-db-backup-v1.sql",
      filePath: "C:\\secret\\path.sql",
      fileSizeBytes: 1200n,
      checksumSha256: "a".repeat(64),
      userCount: 0,
      activeAdminCount: 0,
      validationWarnings: "ZERO_USERS,ZERO_ACTIVE_ADMINS",
      backupType: "DEPLOYMENT",
      status: "CREATED",
      createdAt: new Date("2026-08-25T06:00:00.000Z"),
      restoredAt: null,
      remarks: "CLI",
      createdBy: null,
    });
    assert.equal(pub.backupType, "DEPLOYMENT");
    assert.equal(pub.hasValidationWarning, true);
    assert.deepEqual(pub.validationWarnings, ["ZERO_USERS", "ZERO_ACTIVE_ADMINS"]);
    assert.equal(pub.fileSizeBytes, 1200);
    assert.equal(pub.checksumSha256.length, 64);
    assert.equal("filePath" in pub, false);
  });

  test("manual CREATED remains restore-eligible source (phase 1 unchanged)", () => {
    const pub = toPublicBackup({
      id: 1,
      fileName: "manual.sql",
      filePath: "/tmp/manual.sql",
      fileSizeBytes: 10n,
      checksumSha256: "b".repeat(64),
      userCount: 2,
      activeAdminCount: 1,
      validationWarnings: null,
      backupType: "MANUAL",
      status: "CREATED",
      createdAt: new Date(),
      restoredAt: null,
      remarks: null,
      createdBy: { id: 1, name: "Admin", email: "a@b.c" },
    });
    assert.equal(pub.backupType, "MANUAL");
    assert.equal(pub.status, "CREATED");
    assert.equal(pub.hasValidationWarning, false);
    assert.equal(pub.restoreEligible, true);
  });
});
