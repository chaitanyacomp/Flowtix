/**
 * Register a DbBackup catalog row from deployment CLI (mysqldump tools).
 * Uses mysql client + defaults-extra-file — no Prisma dependency in tools/.
 * Gracefully no-ops when DbBackup table / Phase-1 columns are missing.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { serializeValidationWarnings } = require("./backupValidation");

function sqlString(value) {
  if (value == null) return "NULL";
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlInt(value) {
  if (value == null || !Number.isFinite(Number(value))) return "NULL";
  return String(Math.trunc(Number(value)));
}

function sqlBigInt(value) {
  if (value == null || !Number.isFinite(Number(value))) return "NULL";
  return String(Math.trunc(Number(value)));
}

/**
 * @param {{ host: string; port: string; user: string; password: string }} conn
 */
async function writeMysqlClientCnf(conn) {
  const tmp = path.join(os.tmpdir(), `flowtix-bk-cat-${crypto.randomBytes(8).toString("hex")}.cnf`);
  const lines = [
    "[client]",
    `host=${conn.host}`,
    `port=${conn.port}`,
    `user=${conn.user}`,
    `password=${String(conn.password).replace(/\\/g, "\\\\").replace(/\n/g, "\\n")}`,
  ];
  await fs.promises.writeFile(tmp, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return tmp;
}

function findMysqlExe(env = process.env) {
  if (env.MYSQL_PATH && String(env.MYSQL_PATH).trim()) return String(env.MYSQL_PATH).trim();
  return process.platform === "win32" ? "mysql.exe" : "mysql";
}

/**
 * @param {{
 *   conn: { host: string; port: string; user: string; password: string; database: string };
 *   fileName: string;
 *   filePath: string;
 *   fileSizeBytes: number | null;
 *   checksumSha256?: string | null;
 *   userCount?: number | null;
 *   activeAdminCount?: number | null;
 *   validationWarnings?: string[] | null;
 *   backupType: "DEPLOYMENT" | "AUTOMATIC" | "MANUAL" | "PRE_RESTORE_AUTO";
 *   status: "CREATED" | "FAILED";
 *   remarks?: string | null;
 *   mysqlExe?: string;
 * }} input
 * @returns {Promise<{ ok: boolean; skipped?: boolean; reason?: string; id?: number | null }>}
 */
async function registerDbBackupCatalog(input) {
  const mysqlExe = input.mysqlExe || findMysqlExe();
  const cnf = await writeMysqlClientCnf(input.conn);
  const warnings = serializeValidationWarnings(input.validationWarnings ?? null);
  const remarks = input.remarks ? String(input.remarks).slice(0, 4000) : null;

  const probeSql =
    "SELECT COUNT(*) FROM information_schema.COLUMNS " +
    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DbBackup' AND COLUMN_NAME = 'checksumSha256';";

  try {
    const probe = spawnSync(
      mysqlExe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", input.conn.database, "-e", probeSql],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    if (probe.error || probe.status !== 0) {
      return {
        ok: false,
        skipped: true,
        reason: "mysql catalog probe failed (DbBackup may be unavailable)",
      };
    }
    const colPresent = String(probe.stdout || "").trim() === "1";
    if (!colPresent) {
      // Pre-migration DB: try legacy insert without new columns if table exists.
      const legacyProbe = spawnSync(
        mysqlExe,
        [
          `--defaults-extra-file=${cnf}`,
          "-N",
          "-B",
          input.conn.database,
          "-e",
          "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DbBackup';",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 20000 },
      );
      if (String(legacyProbe.stdout || "").trim() !== "1") {
        return { ok: false, skipped: true, reason: "DbBackup table not found" };
      }
      const legacySql =
        "INSERT INTO `DbBackup` (`fileName`, `filePath`, `fileSizeBytes`, `backupType`, `status`, `createdByUserId`, `remarks`) VALUES (" +
        [
          sqlString(input.fileName),
          sqlString(input.filePath),
          sqlBigInt(input.fileSizeBytes),
          // Older enum may not include DEPLOYMENT/AUTOMATIC — map to MANUAL for legacy.
          sqlString(
            input.backupType === "PRE_RESTORE_AUTO" ? "PRE_RESTORE_AUTO" : "MANUAL",
          ),
          sqlString(input.status),
          "NULL",
          sqlString(remarks),
        ].join(", ") +
        "); SELECT LAST_INSERT_ID();";
      const legacyIns = spawnSync(
        mysqlExe,
        [`--defaults-extra-file=${cnf}`, "-N", "-B", input.conn.database, "-e", legacySql],
        { encoding: "utf8", windowsHide: true, timeout: 20000 },
      );
      if (legacyIns.error || legacyIns.status !== 0) {
        return {
          ok: false,
          skipped: true,
          reason: "legacy DbBackup insert failed (apply unified-catalog migration)",
        };
      }
      const id = Number(String(legacyIns.stdout || "").trim().split(/\r?\n/).pop());
      return { ok: true, id: Number.isFinite(id) ? id : null };
    }

    const insertSql =
      "INSERT INTO `DbBackup` (" +
      "`fileName`, `filePath`, `fileSizeBytes`, `checksumSha256`, `userCount`, `activeAdminCount`, " +
      "`validationWarnings`, `backupType`, `status`, `createdByUserId`, `remarks`" +
      ") VALUES (" +
      [
        sqlString(input.fileName),
        sqlString(input.filePath),
        sqlBigInt(input.fileSizeBytes),
        sqlString(input.checksumSha256 ?? null),
        sqlInt(input.userCount),
        sqlInt(input.activeAdminCount),
        sqlString(warnings),
        sqlString(input.backupType),
        sqlString(input.status),
        "NULL",
        sqlString(remarks),
      ].join(", ") +
      "); SELECT LAST_INSERT_ID();";

    const ins = spawnSync(
      mysqlExe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", input.conn.database, "-e", insertSql],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    if (ins.error || ins.status !== 0) {
      return {
        ok: false,
        skipped: true,
        reason: String(ins.stderr || ins.error || "DbBackup insert failed").slice(0, 300),
      };
    }
    const id = Number(String(ins.stdout || "").trim().split(/\r?\n/).pop());
    return { ok: true, id: Number.isFinite(id) ? id : null };
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      // ignore
    }
  }
}

/**
 * Query live user counts via mysql client.
 * @param {{ host: string; port: string; user: string; password: string; database: string }} conn
 * @param {string} [mysqlExe]
 */
async function queryUserCounts(conn, mysqlExe) {
  const exe = mysqlExe || findMysqlExe();
  const cnf = await writeMysqlClientCnf(conn);
  try {
    const sql =
      "SELECT " +
      "(SELECT COUNT(*) FROM `User`) AS userCount, " +
      "(SELECT COUNT(*) FROM `User` WHERE `role`='ADMIN' AND `isActive`=1) AS activeAdminCount;";
    const r = spawnSync(
      exe,
      [`--defaults-extra-file=${cnf}`, "-N", "-B", conn.database, "-e", sql],
      { encoding: "utf8", windowsHide: true, timeout: 20000 },
    );
    if (r.error || r.status !== 0) {
      return { userCount: null, activeAdminCount: null };
    }
    const parts = String(r.stdout || "")
      .trim()
      .split(/\s+/);
    return {
      userCount: Number(parts[0]),
      activeAdminCount: Number(parts[1]),
    };
  } finally {
    try {
      await fs.promises.unlink(cnf);
    } catch {
      // ignore
    }
  }
}

module.exports = {
  registerDbBackupCatalog,
  queryUserCounts,
  findMysqlExe,
  writeMysqlClientCnf,
};
