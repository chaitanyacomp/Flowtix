const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const {
  resolveBackupStorageRoot,
  listTrustedBackupStorageRoots,
  assertBackupPathAllowed,
  detectBackupHomeDir,
} = require("../../../deployment/lib/backupStoragePaths");

describe("shared backupStoragePaths (single resolver)", () => {
  test("backend re-export is the shared module", () => {
    const viaBackend = require("../../src/services/backupStoragePaths");
    const shared = require("../../../deployment/lib/backupStoragePaths");
    assert.equal(viaBackend.resolveBackupStorageRoot, shared.resolveBackupStorageRoot);
    assert.equal(viaBackend.assertBackupPathAllowed, shared.assertBackupPathAllowed);
  });

  test("same default root regardless of process.cwd()", () => {
    const prev = process.cwd();
    const home = path.join(os.tmpdir(), `erp-home-${Date.now()}`);
    try {
      process.chdir(os.tmpdir());
      const a = resolveBackupStorageRoot({}, { homeDir: home });
      process.chdir(path.join(__dirname, "../.."));
      const b = resolveBackupStorageRoot({}, { homeDir: home });
      assert.equal(a, b);
      assert.equal(a, path.join(path.resolve(home), "backups", "db"));
    } finally {
      process.chdir(prev);
    }
  });

  test("detectBackupHomeDir from module location is stable (not cwd)", () => {
    const prev = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const home = detectBackupHomeDir({}, {});
      // From deployment/lib → repo root
      assert.ok(fs.existsSync(path.join(home, "backend")) || fs.existsSync(path.join(home, "deployment")));
    } finally {
      process.chdir(prev);
    }
  });

  test("legacy ERP_DATA roots are trusted; outside paths rejected", () => {
    const home = path.join(os.tmpdir(), `erp-trust-${Date.now()}`);
    const roots = listTrustedBackupStorageRoots({}, { homeDir: home });
    assert.ok(roots.some((r) => r.endsWith(path.join("backups", "db")) || r.includes(`${path.sep}backups${path.sep}db`)));
    assert.ok(roots.some((r) => r.includes(path.join("ERP_DATA", "backups"))));

    const legacyFile = path.join(home, "ERP_DATA", "backups", "2026", "05", "old.sql");
    assert.equal(
      assertBackupPathAllowed(legacyFile, {}, { homeDir: home }),
      path.resolve(home, "ERP_DATA", "backups"),
    );

    const canonicalFile = path.join(home, "backups", "db", "flowtix.sql");
    assert.ok(assertBackupPathAllowed(canonicalFile, {}, { homeDir: home }));

    assert.throws(
      () => assertBackupPathAllowed(path.join(home, "evil", "steal.sql"), {}, { homeDir: home }),
      (err) => err.code === "BACKUP_PATH_INVALID",
    );
    assert.throws(
      () => assertBackupPathAllowed("C:\\Windows\\System32\\config\\sam", {}, { homeDir: home }),
      (err) => err.code === "BACKUP_PATH_INVALID",
    );
  });
});
