/**
 * Post-restore / post-rollback verification via an independent mysql client connection.
 * Never uses Prisma (may be stale mid-restore). Never prints credentials.
 */
const fs = require("fs");
const { spawnSync } = require("child_process");
const { parseDatabaseUrl } = require("../utils/databaseUrl");
const { getMysqlExecutable, writeMysqlClientCnf } = require("./databaseBackupService");

/** Core tables that must exist after a full ERP dump restore. */
const REQUIRED_CORE_TABLES = ["User", "_prisma_migrations"];

/**
 * @param {string} sql
 * @param {{ mysqlExe?: string; databaseUrl?: string; env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ ok: boolean; stdout: string; stderr: string; status: number }>}
 */
async function runIndependentMysqlQuery(sql, opts = {}) {
  const env = opts.env || process.env;
  const dbUrl = parseDatabaseUrl(opts.databaseUrl || env.DATABASE_URL);
  const mysqlExe = opts.mysqlExe || getMysqlExecutable();
  const cnf = await writeMysqlClientCnf(dbUrl);
  try {
    const r = spawnSync(
      mysqlExe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", dbUrl.database, "-e", sql],
      { encoding: "utf8", windowsHide: true, timeout: 60000 },
    );
    return {
      ok: r.status === 0 && !r.error,
      stdout: String(r.stdout || ""),
      stderr: String(r.stderr || (r.error && r.error.message) || ""),
      status: typeof r.status === "number" ? r.status : 1,
    };
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {{ mysqlExe?: string; databaseUrl?: string; env?: NodeJS.ProcessEnv; requiredTables?: string[] }} [opts]
 */
async function verifyRestoredDatabase(opts = {}) {
  const requiredTables = opts.requiredTables || REQUIRED_CORE_TABLES;
  const connectivity = await runIndependentMysqlQuery("SELECT 1 AS ok;", opts);
  if (!connectivity.ok || !String(connectivity.stdout).includes("1")) {
    return {
      ok: false,
      code: "VERIFY_CONNECTIVITY",
      message: "Restored database connectivity check failed.",
      details: { connectivity: false },
    };
  }

  const missing = [];
  for (const table of requiredTables) {
    const q = await runIndependentMysqlQuery(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '${String(table).replace(/'/g, "''")}';`,
      opts,
    );
    const count = Number(String(q.stdout || "").trim().split(/\s+/)[0]);
    if (!q.ok || count < 1) missing.push(table);
  }
  if (missing.length) {
    return {
      ok: false,
      code: "VERIFY_CORE_TABLES",
      message: `Required core tables missing after restore: ${missing.join(", ")}`,
      details: { missingTables: missing },
    };
  }

  const users = await runIndependentMysqlQuery(
    "SELECT COUNT(*) FROM `User`; SELECT COUNT(*) FROM `User` WHERE `role`='ADMIN' AND `isActive`=1;",
    opts,
  );
  if (!users.ok) {
    return {
      ok: false,
      code: "VERIFY_USER_QUERY",
      message: "Could not query User counts after restore.",
      details: {},
    };
  }
  const lines = String(users.stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((l) => Number(String(l).trim()))
    .filter((n) => Number.isFinite(n));
  const userCount = lines[0] ?? 0;
  const activeAdminCount = lines[1] ?? 0;
  if (userCount < 1) {
    return {
      ok: false,
      code: "VERIFY_ZERO_USERS",
      message: "Restored database has zero users.",
      details: { userCount, activeAdminCount },
    };
  }
  if (activeAdminCount < 1) {
    return {
      ok: false,
      code: "VERIFY_ZERO_ADMINS",
      message: "Restored database has zero active Admin users.",
      details: { userCount, activeAdminCount },
    };
  }

  return {
    ok: true,
    code: null,
    message: "Restore verification passed.",
    details: { userCount, activeAdminCount, connectivity: true, tablesOk: true },
  };
}

module.exports = {
  REQUIRED_CORE_TABLES,
  runIndependentMysqlQuery,
  verifyRestoredDatabase,
};
