const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const { resolveBackupStorageRoot, assertBackupPathAllowed } = require("../lib/backupStoragePaths");

describe("deployment shared backupStoragePaths", () => {
  test("cwd-independent default with homeDir", () => {
    const home = path.join(os.tmpdir(), "ft-home-cli");
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const a = resolveBackupStorageRoot({}, { homeDir: home });
      process.chdir(path.join(__dirname, ".."));
      const b = resolveBackupStorageRoot({}, { homeDir: home });
      assert.equal(a, b);
    } finally {
      process.chdir(prev);
    }
  });

  test("rejects path outside trusted roots", () => {
    const home = path.join(os.tmpdir(), "ft-home-cli-2");
    assert.throws(
      () => assertBackupPathAllowed(path.join(os.tmpdir(), "outside.sql"), {}, { homeDir: home }),
      (e) => e.code === "BACKUP_PATH_INVALID",
    );
  });
});
