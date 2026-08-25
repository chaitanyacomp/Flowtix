const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const { parseDatabaseUrl } = require("../../src/utils/databaseUrl");
const { reconcileManifestBackupToCatalog, findExistingCatalogRow } = require("../../../deployment/lib/backupCatalogReconcile");
const {
  assertPathUnderRoot,
  getResolvedBackupStorageRoot,
} = require("../../src/services/databaseBackupService");
const { assertBackupPathAllowed } = require("../../../deployment/lib/backupStoragePaths");

const db = parseDatabaseUrl(process.env.DATABASE_URL);
const mysql = process.env.MYSQL_PATH || (process.platform === "win32" ? "mysql.exe" : "mysql");

function writeCnf() {
  const tmp = path.join(os.tmpdir(), `bk-ph1-${crypto.randomBytes(4).toString("hex")}.cnf`);
  fs.writeFileSync(
    tmp,
    ["[client]", `host=${db.host}`, `port=${db.port}`, `user=${db.user}`, `password=${db.password.replace(/\\/g, "\\\\")}`].join(
      "\n",
    ) + "\n",
  );
  return tmp;
}

function mysqlRun(sql, database, cnf) {
  const args = [`--defaults-extra-file=${cnf}`, "-N", "-B"];
  if (database) args.push(database);
  args.push("-e", sql);
  const r = spawnSync(mysql, args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
  };
}

describe("backup phase1 upgrade blockers", () => {
  test("legacy ERP_DATA path accepted for download/delete/restore confinement", () => {
    const home = path.resolve(__dirname, "../../..");
    const legacy = path.join(home, "ERP_DATA", "backups", "2026", "08", "legacy_manual.sql");
    // Must not throw when home is repo (legacy root trusted)
    assert.doesNotThrow(() => assertBackupPathAllowed(legacy, {}, { homeDir: home }));
    // Service wrapper uses process.env — set home via FT_ERP_HOME for this assertion path
    const prev = process.env.FT_ERP_HOME;
    process.env.FT_ERP_HOME = home;
    try {
      assert.doesNotThrow(() => assertPathUnderRoot(legacy, getResolvedBackupStorageRoot()));
    } finally {
      if (prev == null) delete process.env.FT_ERP_HOME;
      else process.env.FT_ERP_HOME = prev;
    }
  });

  test("malicious outside-root paths rejected", () => {
    const home = path.join(os.tmpdir(), `erp-mal-${Date.now()}`);
    assert.throws(
      () => assertBackupPathAllowed(path.join(os.tmpdir(), "not-a-backup.sql"), {}, { homeDir: home }),
      (e) => e.code === "BACKUP_PATH_INVALID",
    );
  });

  test("old schema → catalog skip → post-migrate reconcile is idempotent", async () => {
    const cnf = writeCnf();
    const dumpDb = `erp_bk_ph1_${Date.now().toString(36)}`;
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bk-rec-"));
    const fileName = `flowtix-db-backup-v1.0.0-pre-mig.sql`;
    const filePath = path.join(tmpDir, fileName);
    await fs.promises.writeFile(filePath, "-- pre-migration dump\nSELECT 1;\n");

    try {
      let r = mysqlRun(`CREATE DATABASE \`${dumpDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, null, cnf);
      assert.equal(r.status, 0, r.stderr);

      // Old schema (pre unified catalog)
      r = mysqlRun(
        [
          "CREATE TABLE `User` (`id` INT NOT NULL AUTO_INCREMENT, `email` VARCHAR(255) NOT NULL, `name` VARCHAR(255) NOT NULL,",
          " `role` ENUM('ADMIN') NOT NULL, `isActive` TINYINT(1) NOT NULL DEFAULT 1, `passwordHash` VARCHAR(255) NOT NULL, PRIMARY KEY (`id`));",
          "INSERT INTO `User` (`email`,`name`,`role`,`isActive`,`passwordHash`) VALUES ('a@t.com','A','ADMIN',1,'x');",
          "CREATE TABLE `DbBackup` (",
          " `id` INT NOT NULL AUTO_INCREMENT, `fileName` VARCHAR(255) NOT NULL, `filePath` VARCHAR(1024) NOT NULL,",
          " `fileSizeBytes` BIGINT NULL, `backupType` ENUM('MANUAL','PRE_RESTORE_AUTO') NOT NULL,",
          " `status` ENUM('CREATED','FAILED','RESTORED') NOT NULL, `createdByUserId` INT NOT NULL,",
          " `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `restoredAt` DATETIME(3) NULL, `remarks` TEXT NULL,",
          " PRIMARY KEY (`id`),",
          " CONSTRAINT `DbBackup_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE",
          ") ENGINE=InnoDB;",
        ].join(""),
        dumpDb,
        cnf,
      );
      assert.equal(r.status, 0, r.stderr);

      // Simulate migrate applying unified catalog columns
      r = mysqlRun(
        [
          "ALTER TABLE `DbBackup` MODIFY COLUMN `backupType` ENUM('MANUAL','DEPLOYMENT','AUTOMATIC','PRE_RESTORE_AUTO') NOT NULL;",
          "ALTER TABLE `DbBackup` DROP FOREIGN KEY `DbBackup_createdByUserId_fkey`;",
          "ALTER TABLE `DbBackup` MODIFY COLUMN `createdByUserId` INTEGER NULL;",
          "ALTER TABLE `DbBackup` ADD CONSTRAINT `DbBackup_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;",
          "ALTER TABLE `DbBackup` ADD COLUMN `checksumSha256` VARCHAR(64) NULL,",
          " ADD COLUMN `userCount` INTEGER NULL, ADD COLUMN `activeAdminCount` INTEGER NULL,",
          " ADD COLUMN `validationWarnings` VARCHAR(512) NULL;",
        ].join(""),
        dumpDb,
        cnf,
      );
      assert.equal(r.status, 0, r.stderr);

      const conn = { ...db, database: dumpDb };
      const gate = { filename: fileName, path: filePath, fileSizeBytes: fs.statSync(filePath).size };

      const first = await reconcileManifestBackupToCatalog({ conn, backupGate: gate, mysqlExe: mysql });
      assert.equal(first.status, "created", first.message);
      assert.ok(first.id);

      const second = await reconcileManifestBackupToCatalog({ conn, backupGate: gate, mysqlExe: mysql });
      assert.equal(second.status, "exists", second.message);
      assert.equal(second.id, first.id);

      const found = await findExistingCatalogRow({ conn, fileName, filePath, mysqlExe: mysql });
      assert.equal(found.id, first.id);

      r = mysqlRun("SELECT COUNT(*) FROM `DbBackup`", dumpDb, cnf);
      assert.equal(r.stdout, "1");
    } finally {
      mysqlRun(`DROP DATABASE IF EXISTS \`${dumpDb}\``, null, cnf);
      try {
        fs.unlinkSync(cnf);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
