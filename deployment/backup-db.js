/**
 * FT-DEP-001 Batch 4 — safe MySQL logical backup (mysqldump).
 *
 * - Reads DATABASE_URL from shared/.env (then .env fallback)
 * - Never prints passwords
 * - Never deletes old backups
 * - Never restores / migrates / modifies data
 *
 * Usage:
 *   node deployment/backup-db.js
 *   node tools/backup-db.js          (from release package)
 *
 * Env overrides:
 *   FT_ERP_HOME, SHARED_DIR, BACKUP_DIR, BACKUP_STORAGE_DIR, MYSQLDUMP_PATH, MYSQL_PATH,
 *   PRODUCT_VERSION, BACKUP_SOURCE=DEPLOYMENT|AUTOMATIC
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { pipeline } = require("stream/promises");
const { once } = require("events");

function scriptDir() {
  return __dirname;
}

/**
 * Detect install / repo home (FT_ERP_HOME override preserved).
 * Installed layout C:\FT-ERP\tools → C:\FT-ERP (not C:\).
 * Keep in sync with deployment/lib/resolveInstallHome.js.
 */
function resolveHome() {
  const { resolveInstallHome } = (() => {
    try {
      return require("./lib/resolveInstallHome");
    } catch {
      // Packaged tools/backup-db.js is flat — use inline twin of resolveInstallHome.
      return {
        resolveInstallHome(scriptDirectory, env = process.env) {
          if (env.FT_ERP_HOME && String(env.FT_ERP_HOME).trim()) {
            return path.resolve(String(env.FT_ERP_HOME).trim());
          }
          const here = path.resolve(scriptDirectory);
          const base = path.basename(here);
          if (base === "tools") {
            const toolsParent = path.resolve(here, "..");
            const grandParent = path.resolve(toolsParent, "..");
            if (
              fs.existsSync(path.join(toolsParent, "shared")) ||
              fs.existsSync(path.join(toolsParent, "releases")) ||
              fs.existsSync(path.join(toolsParent, "app"))
            ) {
              return toolsParent;
            }
            if (path.basename(grandParent) === "releases") {
              return path.resolve(grandParent, "..");
            }
            if (
              fs.existsSync(path.join(grandParent, "releases")) ||
              fs.existsSync(path.join(grandParent, "shared"))
            ) {
              return grandParent;
            }
            if (path.basename(grandParent) === "release") {
              return path.resolve(grandParent, "..");
            }
            if (fs.existsSync(path.join(grandParent, "backend"))) {
              return grandParent;
            }
            return toolsParent;
          }
          if (base === "deployment") return path.resolve(here, "..");
          return path.resolve(here, "..");
        },
      };
    }
  })();
  return resolveInstallHome(scriptDir(), process.env);
}

function resolveSharedDir(home) {
  if (process.env.SHARED_DIR && String(process.env.SHARED_DIR).trim()) {
    return path.resolve(String(process.env.SHARED_DIR).trim());
  }
  return path.join(home, "shared");
}

function resolveBackupDir(home) {
  try {
    const { resolveBackupStorageRoot } = require("./lib/backupStoragePaths");
    return resolveBackupStorageRoot(process.env, { homeDir: home });
  } catch {
    // Packaged tools without lib/ — same priority as backupStoragePaths.js
    if (process.env.BACKUP_STORAGE_DIR && String(process.env.BACKUP_STORAGE_DIR).trim()) {
      return path.resolve(String(process.env.BACKUP_STORAGE_DIR).trim());
    }
    if (process.env.BACKUP_DIR && String(process.env.BACKUP_DIR).trim()) {
      return path.resolve(String(process.env.BACKUP_DIR).trim());
    }
    return path.join(home, "backups", "db");
  }
}

/**
 * CLI catalog source: DEPLOYMENT (default) or AUTOMATIC (scheduler / BACKUP_SOURCE).
 * @returns {"DEPLOYMENT"|"AUTOMATIC"}
 */
function resolveCliBackupType() {
  const raw = String(process.env.BACKUP_SOURCE || "").trim().toUpperCase();
  if (raw === "AUTOMATIC") return "AUTOMATIC";
  if (process.argv.includes("--automatic")) return "AUTOMATIC";
  return "DEPLOYMENT";
}

/**
 * Load .env file into process.env without override of existing keys.
 * Does not log values.
 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
  return true;
}

function parseDatabaseUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) {
    throw Object.assign(new Error("DATABASE_URL is not set."), { code: "CONFIG" });
  }
  if (!/^mysql:\/\//i.test(s)) {
    throw Object.assign(new Error("DATABASE_URL must be a mysql:// connection string."), {
      code: "CONFIG",
    });
  }
  let u;
  try {
    u = new URL(s.replace(/^mysql:\/\//i, "http://"));
  } catch {
    throw Object.assign(new Error("DATABASE_URL could not be parsed."), { code: "CONFIG" });
  }
  const dbPath = (u.pathname || "").replace(/^\//, "").split("?")[0];
  if (!dbPath) {
    throw Object.assign(new Error("DATABASE_URL must include a database name in the path."), {
      code: "CONFIG",
    });
  }
  return {
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    host: u.hostname || "127.0.0.1",
    port: u.port ? String(u.port) : "3306",
    database: decodeURIComponent(dbPath),
  };
}

function findMysqldump() {
  if (process.env.MYSQLDUMP_PATH && String(process.env.MYSQLDUMP_PATH).trim()) {
    const p = String(process.env.MYSQLDUMP_PATH).trim();
    if (!fs.existsSync(p)) {
      throw Object.assign(
        new Error(
          `MYSQLDUMP_PATH is set but file was not found: ${p}. Install MySQL client tools or fix MYSQLDUMP_PATH.`,
        ),
        { code: "MYSQLDUMP_MISSING" },
      );
    }
    return p;
  }
  const candidates =
    process.platform === "win32"
      ? [
          "mysqldump.exe",
          "mysqldump",
          "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe",
          "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe",
          "C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe",
          "C:\\xampp\\mysql\\bin\\mysqldump.exe",
        ]
      : ["mysqldump"];

  for (const exe of candidates) {
    if (path.isAbsolute(exe)) {
      if (fs.existsSync(exe)) return exe;
      continue;
    }
    const probe = spawnSync(exe, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

function readAppVersion(home) {
  if (process.env.PRODUCT_VERSION && String(process.env.PRODUCT_VERSION).trim()) {
    return String(process.env.PRODUCT_VERSION).trim();
  }
  const versionCandidates = [
    path.join(home, "VERSION.txt"),
    path.join(home, "current", "VERSION.txt"),
    path.join(scriptDir(), "..", "VERSION.txt"),
    path.join(home, "backend", "package.json"),
    path.join(home, "package.json"),
  ];
  for (const f of versionCandidates) {
    if (!fs.existsSync(f)) continue;
    if (f.endsWith("VERSION.txt")) {
      const text = fs.readFileSync(f, "utf8");
      const m = text.match(/productVersion\s*=\s*(.+)/i);
      if (m) return m[1].trim();
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
        if (pkg.version) return String(pkg.version);
      } catch {
        // ignore
      }
    }
  }
  return "0.0.0";
}

function readGitCommit(home) {
  try {
    const r = spawnSync("git", ["-C", home, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    });
    if (!r.error && r.status === 0) return String(r.stdout || "").trim() || null;
  } catch {
    // ignore
  }
  const versionFile = path.join(scriptDir(), "..", "VERSION.txt");
  if (fs.existsSync(versionFile)) {
    const text = fs.readFileSync(versionFile, "utf8");
    const m = text.match(/gitCommit\s*=\s*(.+)/i);
    if (m && m[1].trim() && m[1].trim() !== "unknown") return m[1].trim();
  }
  return null;
}

function stampLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function writeMysqlClientCnf(conn) {
  const tmp = path.join(os.tmpdir(), `flowtix-mysql-cnf-${crypto.randomBytes(8).toString("hex")}.cnf`);
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

function redactSecrets(text) {
  return String(text || "")
    .replace(/password\s*=\s*.+/gi, "password=***")
    .replace(/mysql:\/\/([^:]+):([^@]+)@/gi, "mysql://$1:***@");
}

async function runMysqldump(exe, args, outFileAbs) {
  await fs.promises.mkdir(path.dirname(outFileAbs), { recursive: true });
  const ws = fs.createWriteStream(outFileAbs);
  const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  let code = 1;
  try {
    code = await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const ok = (c) => {
        if (settled) return;
        settled = true;
        resolve(typeof c === "number" ? c : 1);
      };

      child.on("error", (err) => {
        fail(
          Object.assign(
            new Error(
              err && err.code === "ENOENT"
                ? `Could not start mysqldump (${exe}). Install MySQL client tools or set MYSQLDUMP_PATH.`
                : String(err?.message || err),
            ),
            { code: "MYSQLDUMP" },
          ),
        );
      });

      // Register close before piping so we never miss a fast-exit close event.
      let exitCode = null;
      child.on("close", (c) => {
        exitCode = typeof c === "number" ? c : 1;
      });

      pipeline(child.stdout, ws)
        .then(async () => {
          // Wait for close if it has not fired yet (avoid once() race after early close).
          if (exitCode === null) {
            await once(child, "close").then(([c]) => {
              exitCode = typeof c === "number" ? c : 1;
            });
          }
          ok(exitCode);
        })
        .catch(fail);
    });
  } catch (e) {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    try {
      await fs.promises.unlink(outFileAbs);
    } catch {
      // ignore
    }
    throw e;
  }

  const stderrText = redactSecrets(stderr.trim());
  // Treat stderr "Got error:" / Access denied as failure even if exit code is odd on some builds.
  const stderrFatal =
    /access denied|unknown database|got error:|doesn't exist|cannot connect/i.test(stderrText);

  if (code !== 0 || stderrFatal) {
    try {
      await fs.promises.unlink(outFileAbs);
    } catch {
      // ignore
    }
    throw Object.assign(
      new Error(
        stderrText ||
          `mysqldump failed (exit ${code}). Check MySQL is running and credentials in shared/.env.`,
      ),
      { code: "MYSQLDUMP" },
    );
  }
}

function exitWith(code) {
  process.exitCode = code;
  process.exit(code);
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, updatedAt: null, backups: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!raw || !Array.isArray(raw.backups)) {
      return { version: 1, updatedAt: null, backups: [] };
    }
    return raw;
  } catch {
    return { version: 1, updatedAt: null, backups: [] };
  }
}

function saveManifest(manifestPath, manifest) {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function main() {
  const home = resolveHome();
  const sharedDir = resolveSharedDir(home);
  const backupDir = resolveBackupDir(home);
  const manifestPath = path.join(backupDir, "BACKUP_MANIFEST.json");

  console.log("[backup-db] FT-DEP-001 Batch 4 — database backup");
  console.log(`[backup-db] home=${home}`);
  console.log(`[backup-db] backupDir=${backupDir}`);

  const envLoaded = [];
  if (loadEnvFile(path.join(sharedDir, ".env"))) envLoaded.push(path.join(sharedDir, ".env"));
  // Fallbacks (dev / package-local) — never log contents
  const fallbacks = [
    path.join(home, ".env"),
    path.join(home, "backend", ".env"),
    path.join(scriptDir(), "..", "app", ".env"),
    path.join(scriptDir(), "..", ".env"),
  ];
  for (const f of fallbacks) {
    if (loadEnvFile(f)) envLoaded.push(f);
  }
  if (envLoaded.length) {
    console.log(`[backup-db] env loaded from: ${envLoaded.length} file(s) (paths only; secrets not printed)`);
  } else {
    console.log("[backup-db] env: using process environment only");
  }

  let db;
  try {
    db = parseDatabaseUrl(process.env.DATABASE_URL);
  } catch (e) {
    console.error("");
    console.error("[backup-db] ERROR: configuration");
    console.error(`  ${e.message}`);
    console.error("  Place DATABASE_URL in shared/.env (see deployment/production.env.example).");
    console.error("");
    process.exit(2);
  }

  console.log(`[backup-db] database=${db.database} host=${db.host} port=${db.port} user=${db.user}`);

  let exe;
  try {
    exe = findMysqldump();
  } catch (e) {
    console.error("");
    console.error("[backup-db] ERROR: mysqldump not available");
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    console.error("");
    process.exit(3);
  }
  if (!exe) {
    console.error("");
    console.error("[backup-db] ERROR: mysqldump not found");
    console.error("  Install MySQL client tools, or set MYSQLDUMP_PATH to the mysqldump executable.");
    console.error("  Example: MYSQLDUMP_PATH=C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe");
    console.error("");
    process.exit(3);
  }
  console.log(`[backup-db] mysqldump=${exe}`);

  const version = readAppVersion(home);
  const gitCommit = readGitCommit(home);
  const stamp = stampLocal();
  const fileName = `flowtix-db-backup-v${version}-${stamp}.sql`;
  const outAbs = path.join(backupDir, fileName);
  const backupType = resolveCliBackupType();

  fs.mkdirSync(backupDir, { recursive: true });

  let catalogHelpers = null;
  try {
    catalogHelpers = require("./lib/backupCatalogRegister");
  } catch {
    catalogHelpers = null;
  }
  let validationHelpers = null;
  try {
    validationHelpers = require("./lib/backupValidation");
  } catch {
    validationHelpers = null;
  }

  let userCounts = { userCount: null, activeAdminCount: null };
  if (catalogHelpers) {
    try {
      userCounts = await catalogHelpers.queryUserCounts(db, process.env.MYSQL_PATH);
    } catch {
      userCounts = { userCount: null, activeAdminCount: null };
    }
  }

  const cnf = await writeMysqlClientCnf(db);
  const dumpArgs = [
    `--defaults-extra-file=${cnf}`,
    "--single-transaction",
    "--routines",
    "--triggers",
    "--set-gtid-purged=OFF",
    "--column-statistics=0",
    "--default-character-set=utf8mb4",
    db.database,
  ];

  const startedAt = new Date().toISOString();
  let status = "failed";
  let fileSize = 0;
  let checksumSha256 = null;
  let errorMessage = null;
  let validationWarnings = [];

  try {
    console.log(`[backup-db] writing ${fileName} (source=${backupType}) ...`);
    await runMysqldump(exe, dumpArgs, outAbs);
    if (validationHelpers) {
      const hashed = await validationHelpers.hashBackupFileSha256(outAbs);
      fileSize = hashed.sizeBytes;
      checksumSha256 = hashed.checksumSha256;
      validationWarnings = validationHelpers.buildValidationWarnings({
        userCount: userCounts.userCount ?? 0,
        activeAdminCount: userCounts.activeAdminCount ?? 0,
      });
    } else {
      const st = fs.statSync(outAbs);
      fileSize = st.size;
      if (!fileSize || fileSize <= 0) {
        try {
          fs.unlinkSync(outAbs);
        } catch {
          // ignore
        }
        throw Object.assign(new Error("Backup file is empty (0 bytes). Dump rejected."), {
          code: "EMPTY",
        });
      }
    }
    status = "success";
    console.log(`[backup-db] OK size=${fileSize} bytes sha256=${checksumSha256 ? checksumSha256.slice(0, 12) + "…" : "n/a"}`);
    if (validationWarnings.length) {
      console.log(`[backup-db] WARN validation: ${validationWarnings.join(", ")}`);
    }
    console.log(`[backup-db] file=${outAbs}`);
  } catch (e) {
    status = "failed";
    errorMessage = redactSecrets(e instanceof Error ? e.message : String(e));
    console.error("");
    console.error("[backup-db] ERROR: backup failed");
    console.error(`  ${errorMessage}`);
    console.error("");
  } finally {
    try {
      fs.unlinkSync(cnf);
    } catch {
      // ignore
    }
  }

  if (catalogHelpers) {
    try {
      const cat = await catalogHelpers.registerDbBackupCatalog({
        conn: db,
        fileName,
        filePath: outAbs,
        fileSizeBytes: status === "success" ? fileSize : 0,
        checksumSha256: status === "success" ? checksumSha256 : null,
        userCount: userCounts.userCount,
        activeAdminCount: userCounts.activeAdminCount,
        validationWarnings:
          status === "success"
            ? validationWarnings
            : validationHelpers
              ? validationHelpers.buildValidationWarnings({
                  userCount: userCounts.userCount ?? 0,
                  activeAdminCount: userCounts.activeAdminCount ?? 0,
                })
              : [],
        backupType,
        status: status === "success" ? "CREATED" : "FAILED",
        remarks:
          status === "success"
            ? `CLI ${backupType} backup (manifest)`
            : `CLI ${backupType} backup FAILED: ${errorMessage || "unknown"}`.slice(0, 4000),
        mysqlExe: process.env.MYSQL_PATH,
      });
      if (cat.ok) {
        console.log(`[backup-db] catalog DbBackup id=${cat.id ?? "?"} (${backupType}/${status === "success" ? "CREATED" : "FAILED"})`);
      } else if (cat.skipped) {
        console.log(`[backup-db] catalog skipped: ${cat.reason || "unavailable"}`);
      }
    } catch (e) {
      console.log(
        `[backup-db] catalog register failed (non-fatal): ${redactSecrets(e instanceof Error ? e.message : String(e))}`,
      );
    }
  }

  const entry = {
    filename: fileName,
    path: outAbs,
    timestamp: startedAt,
    appVersion: version,
    gitCommit: gitCommit,
    databaseName: db.database,
    host: db.host,
    fileSizeBytes: fileSize,
    checksumSha256: checksumSha256,
    backupSource: backupType,
    userCount: userCounts.userCount,
    activeAdminCount: userCounts.activeAdminCount,
    validationWarnings: validationWarnings,
    status,
    ...(errorMessage ? { error: errorMessage } : {}),
  };

  try {
    const manifest = loadManifest(manifestPath);
    // Append only — never delete prior entries or backup files (Batch 4 safety).
    manifest.backups.push(entry);
    saveManifest(manifestPath, manifest);
    console.log(`[backup-db] manifest updated: ${manifestPath}`);
  } catch (e) {
    console.error(
      "[backup-db] ERROR: could not update BACKUP_MANIFEST.json:",
      e instanceof Error ? e.message : String(e),
    );
    if (status === "success") status = "failed";
    errorMessage = errorMessage || "manifest write failed";
  }

  if (status !== "success") {
    exitWith(1);
    return;
  }
  exitWith(0);
}

main().catch((e) => {
  console.error("[backup-db] FATAL:", redactSecrets(e instanceof Error ? e.message : String(e)));
  exitWith(1);
});
