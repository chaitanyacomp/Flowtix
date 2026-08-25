/**
 * Phase 3 restore — end-to-end integration verification on disposable MySQL DBs only.
 *
 * Usage (from backend/):
 *   set NODE_ENV=test
 *   set ERP_RUN_PHASE3_RESTORE_INTEGRATION=1
 *   npm run test:integration:phase3-restore
 *
 * Hard guards: never targets `erp`; aborts if operational DATABASE_URL would be erp/forbidden;
 * drops only DBs created by this run.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const assert = require("node:assert/strict");

const backendRoot = path.join(__dirname, "..");

require("dotenv").config({ path: path.join(backendRoot, ".env") });
require("dotenv").config({ path: path.join(backendRoot, ".env.integration") });

const {
  assertDisposableDatabaseName,
  assertSafeDatabaseUrl,
  rewriteDatabaseUrl,
  makeDisposableDatabaseName,
  resolveCredentialBaseUrl,
  parseDatabaseUrl,
  DISPOSABLE_PREFIX,
} = require("../test/integration/_phase3RestoreGuards");

const MARKER_ADMIN_EMAIL = "phase3-admin@ft-restore-marker.local";
const MARKER_USER_EMAIL = "phase3-user@ft-restore-marker.local";
const MARKER_COMPANY = "Phase3RestoreMarkerCo";
const MARKER_MIGRATION = "ft_phase3_restore_marker_migration";

/** @type {string[]} */
const createdDatabases = [];
/** @type {string | null} */
let workDir = null;
/** @type {import("mysql2/promise").Connection | null} */
let adminConn = null;

function fail(msg) {
  const err = new Error(msg);
  err.code = "PHASE3_INTEGRATION_FAIL";
  throw err;
}

function assertOperationalTargetSafe() {
  const parsed = assertSafeDatabaseUrl("DATABASE_URL", process.env.DATABASE_URL, {
    mustBeDisposable: true,
  });
  if (parsed.database.toLowerCase() === "erp") {
    fail("Operational DATABASE_URL must never be erp.");
  }
  assertDisposableDatabaseName(parsed.database);
}

/**
 * @param {import("mysql2/promise").Connection} conn
 * @param {string} dbName
 */
async function createDisposableDatabase(conn, dbName) {
  assertDisposableDatabaseName(dbName);
  await conn.query(
    `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  createdDatabases.push(dbName);
  // eslint-disable-next-line no-console
  console.log(`[phase3-restore-integration] Created disposable DB: ${dbName}`);
}

/**
 * Drop only DBs this run created (prefix + tracked list).
 * @param {import("mysql2/promise").Connection} conn
 */
async function dropCreatedDisposableDatabases(conn) {
  const unique = [...new Set(createdDatabases)];
  for (const dbName of unique) {
    assertDisposableDatabaseName(dbName);
    if (!dbName.startsWith(DISPOSABLE_PREFIX)) {
      fail(`Refusing to drop non-disposable DB: ${dbName}`);
    }
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    // eslint-disable-next-line no-console
    console.log(`[phase3-restore-integration] Dropped disposable DB: ${dbName}`);
  }
  createdDatabases.length = 0;
}

function runMigrateDeploy(databaseUrl) {
  assertSafeDatabaseUrl("migrate DATABASE_URL", databaseUrl, { mustBeDisposable: true });
  const prismaCli = path.join(backendRoot, "node_modules", "prisma", "build", "index.js");
  const r = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: backendRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
    },
    windowsHide: true,
  });
  if (r.error) {
    fail(`prisma migrate deploy failed to start: ${r.error.message}`);
  }
  if (r.status !== 0) {
    fail(
      `prisma migrate deploy failed (exit ${r.status}):\n${r.stderr || ""}\n${r.stdout || ""}`,
    );
  }
}

async function seedMarkerData(prisma, bcrypt) {
  const passwordHash = await bcrypt.hash("phase3-restore-test", 8);
  await prisma.user.create({
    data: {
      email: MARKER_ADMIN_EMAIL,
      name: "Phase3 Admin Marker",
      role: "ADMIN",
      isActive: true,
      passwordHash,
    },
  });
  await prisma.user.create({
    data: {
      email: MARKER_USER_EMAIL,
      name: "Phase3 User Marker",
      role: "STORE",
      isActive: true,
      passwordHash,
    },
  });
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, companyName: MARKER_COMPANY },
    update: { companyName: MARKER_COMPANY },
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`_prisma_migrations\` (\`id\`, \`checksum\`, \`finished_at\`, \`migration_name\`, \`logs\`, \`rolled_back_at\`, \`started_at\`, \`applied_steps_count\`)
     VALUES (?, ?, NOW(3), ?, NULL, NULL, NOW(3), 1)`,
    crypto.randomUUID(),
    crypto.createHash("sha256").update(MARKER_MIGRATION).digest("hex"),
    MARKER_MIGRATION,
  );
}

async function readMarkers(prisma) {
  const users = await prisma.user.findMany({
    where: { email: { in: [MARKER_ADMIN_EMAIL, MARKER_USER_EMAIL] } },
    select: { email: true, role: true, isActive: true, name: true },
    orderBy: { email: "asc" },
  });
  const admin = await prisma.user.findFirst({
    where: { email: MARKER_ADMIN_EMAIL, role: "ADMIN", isActive: true },
  });
  const setting = await prisma.appSetting.findUnique({ where: { id: 1 } });
  const migRows = await prisma.$queryRawUnsafe(
    `SELECT \`migration_name\` AS migrationName FROM \`_prisma_migrations\` WHERE \`migration_name\` = ? LIMIT 1`,
    MARKER_MIGRATION,
  );
  return {
    users,
    hasActiveAdmin: Boolean(admin),
    companyName: setting?.companyName ?? null,
    hasMigrationMarker: Array.isArray(migRows) && migRows.length > 0,
  };
}

async function assertMarkersPresent(prisma, label) {
  const m = await readMarkers(prisma);
  assert.equal(m.hasActiveAdmin, true, `${label}: active Admin marker missing`);
  assert.equal(m.users.length, 2, `${label}: expected 2 marker users`);
  assert.equal(m.companyName, MARKER_COMPANY, `${label}: business marker missing`);
  assert.equal(m.hasMigrationMarker, true, `${label}: migration history marker missing`);
  return m;
}

function writeCorruptSql(absPath) {
  const body =
    "-- deliberately corrupt Phase 3 restore target\n" +
    "THIS IS NOT VALID MYSQL;\n" +
    "DROP TABLE IF EXISTS totally_broken_syntax (((;\n";
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, body, "utf8");
}

async function main() {
  if (process.env.ERP_RUN_PHASE3_RESTORE_INTEGRATION !== "1") {
    // eslint-disable-next-line no-console
    console.error(
      "Refusing to run: set ERP_RUN_PHASE3_RESTORE_INTEGRATION=1 (disposable MySQL restore verification).",
    );
    process.exit(2);
  }
  if (process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line no-console
    console.error("Refusing to run: set NODE_ENV=test.");
    process.exit(2);
  }

  const mysql = require("mysql2/promise");
  const bcrypt = require("bcryptjs");

  const credentialBaseUrl = resolveCredentialBaseUrl();
  const credParsed = parseDatabaseUrl(credentialBaseUrl);

  adminConn = await mysql.createConnection({
    host: credParsed.host,
    port: Number(credParsed.port),
    user: credParsed.user,
    password: credParsed.password,
    multipleStatements: true,
  });

  const disposableName = makeDisposableDatabaseName();
  await createDisposableDatabase(adminConn, disposableName);
  const disposableUrl = rewriteDatabaseUrl(credentialBaseUrl, disposableName);

  // Point the process at the disposable DB only (never erp).
  process.env.DATABASE_URL = disposableUrl;
  assertOperationalTargetSafe();

  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-p3-restore-int-"));
  const isolatedBackupRoot = path.join(workDir, "backups", "db");
  const pinIsolatedBackupEnv = () => {
    process.env.FT_ERP_HOME = workDir;
    process.env.SHARED_DIR = path.join(workDir, "shared");
    process.env.LOG_DIR = path.join(workDir, "logs");
    // Isolate from development/customer BACKUP_STORAGE_DIR (e.g. D:\ERP_DATA\backups).
    // Re-pin after requires in case any loader touches dotenv.
    process.env.BACKUP_STORAGE_DIR = isolatedBackupRoot;
    process.env.BACKUP_DIR = isolatedBackupRoot;
    process.env.FT_MAINTENANCE_MODE_PATH = path.join(workDir, "shared", "maintenance-mode.json");
    process.env.FT_AUTH_SESSION_EPOCH_PATH = path.join(workDir, "shared", "auth-session-epoch.json");
    process.env.FT_RESTORE_STATUS_PATH = path.join(workDir, "shared", "restore-status.json");
    process.env.BACKUP_JOB_LOCK_PATH = path.join(workDir, "shared", "locks", "backup-job.lock");
    process.env.JWT_SECRET = process.env.JWT_SECRET || "phase3-restore-integration-secret";
  };
  pinIsolatedBackupEnv();
  fs.mkdirSync(process.env.SHARED_DIR, { recursive: true });
  fs.mkdirSync(process.env.LOG_DIR, { recursive: true });
  fs.mkdirSync(isolatedBackupRoot, { recursive: true });
  fs.mkdirSync(path.dirname(process.env.BACKUP_JOB_LOCK_PATH), { recursive: true });

  // eslint-disable-next-line no-console
  console.log("[phase3-restore-integration] Running migrate deploy on", disposableName);
  runMigrateDeploy(disposableUrl);
  assertOperationalTargetSafe();

  // Load app modules only after DATABASE_URL is disposable.
  pinIsolatedBackupEnv();
  const { resolveBackupStorageRoot } = require("../src/services/backupStoragePaths");
  const resolvedBackupRoot = resolveBackupStorageRoot(process.env);
  if (path.resolve(resolvedBackupRoot) !== path.resolve(isolatedBackupRoot)) {
    fail(
      `Backup storage isolation failed: resolved=${resolvedBackupRoot} expected=${isolatedBackupRoot}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log("[phase3-restore-integration] Isolated backup root:", resolvedBackupRoot);

  const { prisma } = require("../src/utils/prisma");
  pinIsolatedBackupEnv();
  const { createManualBackup, createPreRestoreAutoBackup } = require("../src/services/databaseBackupService");
  const { hashBackupFileSha256 } = require("../src/services/backupValidation");
  const {
    restoreFromBackup,
    runMysqlRestoreFromSqlFile,
    EMERGENCY_IT_MESSAGE,
  } = require("../src/services/databaseRestoreService");
  const { isMaintenanceActive, clearMaintenanceMode } = require("../src/services/maintenanceMode");
  const { readRestoreStatus, toPublicRestoreStatus } = require("../src/services/restoreJobStatus");
  const { getAuthSessionEpoch } = require("../src/services/authSessionEpoch");
  const { signAccessToken, verifyAccessToken } = require("../src/utils/jwt");
  const { createApp } = require("../src/createApp");
  pinIsolatedBackupEnv();
  const request = require("supertest");

  const results = {
    successRestore: false,
    rollbackRecovered: false,
    rollbackFailureEmergency: false,
    jwtEpochInvalidation: false,
    restoreStatusPolling: false,
  };

  try {
    // --- Seed state A ---
    await seedMarkerData(prisma, bcrypt);
    await assertMarkersPresent(prisma, "state A seed");

    const adminUser = await prisma.user.findFirst({ where: { email: MARKER_ADMIN_EMAIL } });
    assert.ok(adminUser);

    // --- Backup A (real mysqldump + catalog) ---
    assertOperationalTargetSafe();
    pinIsolatedBackupEnv();
    // eslint-disable-next-line no-console
    console.log(
      "[phase3-restore-integration] About to createManualBackup; storage=",
      resolveBackupStorageRoot(process.env),
    );
    const backupA = await createManualBackup({
      userId: adminUser.id,
      remarks: "Phase3 integration backup A",
    });
    assert.equal(backupA.status, "CREATED");
    assert.ok(backupA.checksumSha256);
    assert.ok(Number(backupA.fileSizeBytes) > 0);
    assert.ok((backupA.userCount ?? 0) >= 2);
    assert.ok((backupA.activeAdminCount ?? 0) >= 1);

    // --- Mutate away from A ---
    await prisma.user.update({
      where: { email: MARKER_USER_EMAIL },
      data: { name: "MUTATED_AFTER_BACKUP_A" },
    });
    await prisma.appSetting.update({
      where: { id: 1 },
      data: { companyName: "MUTATED_COMPANY_AFTER_A" },
    });
    const mutated = await readMarkers(prisma);
    assert.equal(mutated.companyName, "MUTATED_COMPANY_AFTER_A");

    // JWT before restore (epoch 0)
    const epochBefore = getAuthSessionEpoch();
    const tokenBefore = signAccessToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: "ADMIN",
      name: adminUser.name,
    });
    assert.equal(verifyAccessToken(tokenBefore).sessionEpoch, epochBefore);

    const app = createApp();
    const authHeader = { Authorization: `Bearer ${tokenBefore}` };

    // Idle restore-status poll
    {
      const idle = await request(app).get("/api/admin/backups/restore-status").set(authHeader);
      assert.equal(idle.status, 200);
      assert.equal(idle.body.maintenance.active, false);
    }

    // --- Success path: restore A via real engine (with mid-restore status poll) ---
    let polledDuringRestore = false;
    const success = await restoreFromBackup(
      { backupId: backupA.id, actingUserId: adminUser.id },
      {
        skipLock: false,
        runMysqlRestoreFromSqlFile: async (sqlFile) => {
          assertOperationalTargetSafe();
          const mid = await request(app).get("/api/admin/backups/restore-status").set(authHeader);
          assert.equal(mid.status, 200, "restore-status must remain reachable in maintenance");
          assert.equal(mid.body.maintenance.active, true);
          assert.ok(mid.body.restoreStatus);
          polledDuringRestore = true;
          await prisma.$disconnect().catch(() => {});
          try {
            return await runMysqlRestoreFromSqlFile(sqlFile);
          } finally {
            await prisma.$connect().catch(() => {});
          }
        },
      },
    );
    assert.equal(success.ok, true);
    assert.equal(success.forceLogout, true);
    results.restoreStatusPolling = polledDuringRestore;

    await prisma.$disconnect().catch(() => {});
    // Prisma may hold stale connections after raw mysql import — reconnect by querying
    await prisma.$connect();
    await assertMarkersPresent(prisma, "after successful restore of A");
    const afterOk = await readMarkers(prisma);
    assert.equal(
      afterOk.users.find((u) => u.email === MARKER_USER_EMAIL)?.name,
      "Phase3 User Marker",
      "user marker name must revert from mutation",
    );
    results.successRestore = true;

    // JWT epoch invalidation
    const epochAfter = getAuthSessionEpoch();
    assert.ok(epochAfter > epochBefore, "epoch must bump after successful restore");
    assert.throws(() => verifyAccessToken(tokenBefore), /Session invalidated/);
    const tokenAfter = signAccessToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: "ADMIN",
      name: adminUser.name,
    });
    assert.equal(verifyAccessToken(tokenAfter).sessionEpoch, epochAfter);
    results.jwtEpochInvalidation = true;

    assert.equal(isMaintenanceActive(), false, "maintenance must clear after successful restore");
    {
      const done = await request(app).get("/api/admin/backups/restore-status").set({
        Authorization: `Bearer ${tokenAfter}`,
      });
      assert.equal(done.status, 200);
      assert.equal(done.body.maintenance.active, false);
      assert.equal(done.body.restoreStatus.phase, "COMPLETED");
    }

    // --- Failure / rollback path: safety state B, corrupt target ---
    await prisma.appSetting.update({
      where: { id: 1 },
      data: { companyName: "STATE_B_SAFETY_MARKER" },
    });
    await prisma.user.update({
      where: { email: MARKER_USER_EMAIL },
      data: { name: "STATE_B_USER" },
    });

    const corruptPath = path.join(process.env.BACKUP_STORAGE_DIR, "phase3", "corrupt_target.sql");
    writeCorruptSql(corruptPath);
    const { sizeBytes, checksumSha256 } = await hashBackupFileSha256(corruptPath);
    const corruptRow = await prisma.dbBackup.create({
      data: {
        fileName: path.basename(corruptPath),
        filePath: corruptPath,
        fileSizeBytes: BigInt(sizeBytes),
        checksumSha256,
        userCount: 2,
        activeAdminCount: 1,
        backupType: "MANUAL",
        status: "CREATED",
        createdByUserId: adminUser.id,
        remarks: "Phase3 deliberate corrupt restore target",
      },
    });

    let rolledBackErr = null;
    try {
      await restoreFromBackup(
        { backupId: corruptRow.id, actingUserId: adminUser.id },
        { skipLock: false },
      );
    } catch (e) {
      rolledBackErr = e;
    }
    assert.ok(rolledBackErr, "corrupt restore must fail");
    assert.equal(rolledBackErr.code, "RESTORE_FAILED_ROLLED_BACK");
    assert.equal(rolledBackErr.rolledBack, true);
    assert.equal(isMaintenanceActive(), false, "maintenance clears after successful rollback");

    await prisma.$disconnect().catch(() => {});
    await prisma.$connect();
    const afterRb = await readMarkers(prisma);
    assert.equal(afterRb.companyName, "STATE_B_SAFETY_MARKER", "rollback must restore state B business marker");
    assert.equal(
      afterRb.users.find((u) => u.email === MARKER_USER_EMAIL)?.name,
      "STATE_B_USER",
      "rollback must restore state B user marker",
    );
    assert.equal(afterRb.hasActiveAdmin, true);
    assert.equal(afterRb.hasMigrationMarker, true);
    {
      const st = toPublicRestoreStatus(readRestoreStatus());
      assert.equal(st.outcome, "RESTORE_FAILED_DATA_RECOVERED");
      assert.equal(st.emergency, false);
    }
    results.rollbackRecovered = true;

    // --- Simulate rollback failure → maintenance stays, emergency status ---
    clearMaintenanceMode();
    await prisma.appSetting.update({
      where: { id: 1 },
      data: { companyName: "PRE_EMERGENCY_STATE" },
    });

    const eligibleEmergency = await prisma.dbBackup.create({
      data: {
        fileName: "emergency_target.sql",
        filePath: corruptPath,
        fileSizeBytes: BigInt(sizeBytes),
        checksumSha256,
        userCount: 2,
        activeAdminCount: 1,
        backupType: "MANUAL",
        status: "CREATED",
        createdByUserId: adminUser.id,
        remarks: "Phase3 rollback-failure simulation target",
      },
    });

    // Real safety dump, then force both primary and rollback imports to fail.
    let emergencyErr = null;
    try {
      await restoreFromBackup(
        { backupId: eligibleEmergency.id, actingUserId: adminUser.id },
        {
          skipLock: false,
          createPreRestoreAutoBackup,
          runMysqlRestoreFromSqlFile: async () => {
            const err = new Error("simulated import failure for rollback-failure path");
            err.code = "MYSQL_RESTORE_FAILED";
            throw err;
          },
        },
      );
    } catch (e) {
      emergencyErr = e;
    }
    assert.ok(emergencyErr);
    assert.equal(emergencyErr.code, "ROLLBACK_FAILED");
    assert.equal(emergencyErr.emergency, true);
    assert.match(String(emergencyErr.message), /EMERGENCY/);
    assert.equal(isMaintenanceActive(), true, "maintenance must remain active after rollback failure");
    {
      const st = toPublicRestoreStatus(readRestoreStatus());
      assert.equal(st.outcome, "ROLLBACK_FAILED");
      assert.equal(st.emergency, true);
      assert.match(String(st.message), /EMERGENCY/);
      assert.equal(st.message, EMERGENCY_IT_MESSAGE);
    }
    results.rollbackFailureEmergency = true;

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          disposableDatabase: disposableName,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      const { prisma } = require("../src/utils/prisma");
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    if (adminConn) {
      try {
        await dropCreatedDisposableDatabases(adminConn);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[phase3-restore-integration] Cleanup drop failed:", e.message);
      }
      await adminConn.end().catch(() => {});
    }
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  const allOk = Object.values(results).every(Boolean);
  if (!allOk) {
    fail(`Incomplete verification: ${JSON.stringify(results)}`);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[phase3-restore-integration] FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});
