/**
 * FT-DEP-001 Milestone 3 Phase C — database safety before prisma migrate deploy.
 *
 * Never runs db push / migrate reset. Never prints passwords.
 *
 * Usage:
 *   node deployment/db-safety.js --home <FT_ERP_HOME> [--create-db] [--allow-dev-db] [--json]
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  parseEnvFile,
  parseDatabaseUrl,
  findMysqlClient,
  checkItem,
  DEV_DB_NAMES,
  redactSecrets,
  nowIso,
} = require("./install-common");

const MIN_MYSQL_MAJOR = 8;

function parseArgs(argv) {
  const out = {
    home: null,
    createDb: false,
    allowDevDb: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--create-db") out.createDb = true;
    else if (a === "--allow-dev-db") out.allowDevDb = true;
    else if (a === "--json") out.json = true;
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  if (process.env.DB_SAFETY_CREATE_DB === "1") out.createDb = true;
  return out;
}

function mysqlExec(mysqlExe, parsed, sql, { asAdminDb = false } = {}) {
  const args = [
    `-h${parsed.host}`,
    `-P${String(parsed.port)}`,
    `-u${parsed.user}`,
    `-p${parsed.password}`,
    "-N",
    "-B",
    "-e",
    sql,
  ];
  if (!asAdminDb && parsed.database) {
    args.splice(args.length - 2, 0, parsed.database);
  }
  const r = spawnSync(mysqlExe, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, MYSQL_PWD: undefined },
  });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || "").trim(),
    stderr: redactSecrets(String(r.stderr || "").trim()),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function probeMysqlVersion(mysqlExe, parsed) {
  const r = mysqlExec(mysqlExe, parsed, "SELECT VERSION();", { asAdminDb: true });
  if (r.status !== 0) {
    return { ok: false, version: null, detail: r.stderr || r.error || "mysql version query failed" };
  }
  const version = r.stdout.split(/\r?\n/).filter(Boolean)[0] || "";
  const major = Number(String(version).split(".")[0]);
  const ok = Number.isFinite(major) && major >= MIN_MYSQL_MAJOR;
  return {
    ok,
    version,
    major,
    detail: ok
      ? `MySQL ${version}`
      : `MySQL ${version || "?"} — require major >= ${MIN_MYSQL_MAJOR}`,
  };
}

function databaseExists(mysqlExe, parsed) {
  const sql = `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='${parsed.database.replace(/'/g, "")}'`;
  const r = mysqlExec(mysqlExe, parsed, sql, { asAdminDb: true });
  if (r.status !== 0) {
    return { ok: false, exists: false, detail: r.stderr || r.error || "schema lookup failed" };
  }
  const exists = r.stdout.toLowerCase().includes(String(parsed.database).toLowerCase());
  return { ok: true, exists, detail: exists ? `Database "${parsed.database}" exists` : `Database "${parsed.database}" does not exist` };
}

function createDatabase(mysqlExe, parsed) {
  const db = parsed.database.replace(/[`\\]/g, "");
  const sql = `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
  const r = mysqlExec(mysqlExe, parsed, sql, { asAdminDb: true });
  return {
    ok: r.status === 0,
    detail:
      r.status === 0
        ? `Created or verified database "${parsed.database}"`
        : `CREATE DATABASE failed: ${r.stderr || r.error}`,
  };
}

function readMigrationHistoryHint(home) {
  const candidates = [
    path.join(home, "prisma", "migrations"),
    path.join(home, "releases"),
  ];
  // Count migrations in home/prisma if present
  const migDir = path.join(home, "prisma", "migrations");
  if (fs.existsSync(migDir)) {
    const dirs = fs.readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    return { count: dirs.length, path: migDir };
  }
  return { count: 0, path: null, note: "prisma/migrations not at home yet (OK before place-release)" };
}

/**
 * @param {{ home: string, createIfMissing?: boolean, allowDevDatabase?: boolean, envPath?: string }} options
 */
async function validateDatabaseSafety(options = {}) {
  const home = path.resolve(options.home);
  const envPath = options.envPath || path.join(home, "shared", ".env");
  const createIfMissing = !!options.createIfMissing;
  const allowDevDatabase = !!options.allowDevDatabase;
  const checks = [];

  if (!fs.existsSync(envPath)) {
    checks.push(
      checkItem(
        "mysql_env",
        false,
        "error",
        "shared\\.env missing — cannot validate database",
        "Run configure-env.js first",
      ),
    );
    return { ok: false, checks, parsed: null };
  }

  const env = parseEnvFile(envPath);
  const parsed = parseDatabaseUrl(env.DATABASE_URL || "");
  if (!parsed.ok) {
    checks.push(
      checkItem("mysql_url", false, "error", parsed.error, "Fix DATABASE_URL in shared\\.env"),
    );
    return { ok: false, checks, parsed: null };
  }

  checks.push(
    checkItem(
      "mysql_url",
      true,
      "ok",
      `Target host=${parsed.host} port=${parsed.port} database=${parsed.database} user=${parsed.user}`,
    ),
  );

  if (!allowDevDatabase && DEV_DB_NAMES.has(String(parsed.database).toLowerCase())) {
    checks.push(
      checkItem(
        "mysql_dev_guard",
        false,
        "error",
        `Refusing production migrate against development-like database "${parsed.database}"`,
        "Change database name or pass --allow-dev-db only for lab installs",
      ),
    );
  } else {
    checks.push(checkItem("mysql_dev_guard", true, "ok", "Database name policy OK"));
  }

  // Lab/dev hostnames are OK for LAN server MySQL on localhost — flag INTEGRATION urls only
  if (/integration/i.test(parsed.database) || /INTEGRATION_DATABASE_URL/.test(JSON.stringify(env))) {
    checks.push(
      checkItem(
        "mysql_integration_guard",
        false,
        "error",
        "Integration/test database markers detected",
        "Do not point production installs at INTEGRATION_DATABASE_URL databases",
      ),
    );
  } else {
    checks.push(checkItem("mysql_integration_guard", true, "ok", "No integration DB markers"));
  }

  const mysqlExe = findMysqlClient();
  if (!mysqlExe) {
    checks.push(
      checkItem(
        "mysql_client",
        false,
        "error",
        "mysql client not found",
        "Install MySQL Server 8.x client tools and ensure mysql.exe is on PATH (or set MYSQL_PATH)",
      ),
    );
    return { ok: false, checks, parsed };
  }
  checks.push(checkItem("mysql_client", true, "ok", `mysql client: ${mysqlExe}`));

  // Reachability + credentials
  const ping = mysqlExec(mysqlExe, parsed, "SELECT 1;", { asAdminDb: true });
  if (ping.status !== 0) {
    checks.push(
      checkItem(
        "mysql_reachable",
        false,
        "error",
        `MySQL not reachable or credentials invalid (${ping.stderr || ping.error || "failed"})`,
        "Start MySQL service; verify host/port/user/password in shared\\.env",
      ),
    );
    return { ok: false, checks, parsed };
  }
  checks.push(checkItem("mysql_reachable", true, "ok", "MySQL reachable; credentials accepted"));

  const ver = probeMysqlVersion(mysqlExe, parsed);
  checks.push(
    checkItem(
      "mysql_version",
      ver.ok,
      ver.ok ? "ok" : "error",
      ver.detail,
      ver.ok ? null : `Upgrade MySQL to ${MIN_MYSQL_MAJOR}.x or later`,
    ),
  );

  let exists = databaseExists(mysqlExe, parsed);
  if (!exists.exists && createIfMissing) {
    const created = createDatabase(mysqlExe, parsed);
    checks.push(
      checkItem(
        "mysql_create_db",
        created.ok,
        created.ok ? "ok" : "error",
        created.detail,
        created.ok ? null : "Grant CREATE privilege to the DB user or create the database manually",
      ),
    );
    exists = databaseExists(mysqlExe, parsed);
  }

  checks.push(
    checkItem(
      "mysql_database",
      exists.exists,
      exists.exists ? "ok" : "error",
      exists.detail,
      exists.exists
        ? null
        : "Create the database or re-run with --create-db / DB_SAFETY_CREATE_DB=1",
    ),
  );

  const mig = readMigrationHistoryHint(home);
  checks.push(
    checkItem(
      "migration_files",
      true,
      mig.count > 0 ? "ok" : "warn",
      mig.count > 0
        ? `${mig.count} migration folders at ${mig.path}`
        : mig.note || "No local migrations yet",
    ),
  );

  // _prisma_migrations table presence (informational)
  if (exists.exists) {
    const hist = mysqlExec(
      mysqlExe,
      parsed,
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='_prisma_migrations';",
    );
    if (hist.status === 0) {
      const n = Number(String(hist.stdout).trim());
      checks.push(
        checkItem(
          "prisma_migration_table",
          true,
          "ok",
          n > 0
            ? "_prisma_migrations table present (existing deployment)"
            : "_prisma_migrations absent (fresh database — migrate deploy will initialize)",
        ),
      );
    }
  }

  const errors = checks.filter((c) => c.level === "error" && !c.ok);
  return {
    ok: errors.length === 0,
    checks,
    parsed: {
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      user: parsed.user,
      // password intentionally omitted
    },
    generatedAt: nowIso(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.home) {
    console.error("[db-safety] ERROR: --home required");
    process.exit(1);
  }
  const result = await validateDatabaseSafety({
    home: args.home,
    createIfMissing: args.createDb,
    allowDevDatabase: args.allowDevDb,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("[db-safety] FT-DEP-001 Milestone 3 Phase C");
    for (const c of result.checks) {
      const tag = c.level === "ok" ? "OK  " : c.level === "warn" ? "WARN" : "FAIL";
      console.log(`  [${tag}] ${c.id}: ${c.detail}`);
      if (!c.ok && c.corrective) console.log(`         → ${c.corrective}`);
    }
    console.log(result.ok ? "[db-safety] PASSED" : "[db-safety] FAILED — migrate deploy blocked");
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[db-safety] FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

module.exports = {
  validateDatabaseSafety,
  parseDatabaseUrl,
  MIN_MYSQL_MAJOR,
};
