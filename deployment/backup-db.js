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
 *   FT_ERP_HOME, SHARED_DIR, BACKUP_DIR, MYSQLDUMP_PATH, PRODUCT_VERSION
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
 * Detect install / repo home:
 * - tools/ under release → release parent → FT home (parent of release) or release itself
 * - deployment/ under repo → repo root
 */
function resolveHome() {
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim()) {
    return path.resolve(String(process.env.FT_ERP_HOME).trim());
  }

  const here = scriptDir();
  const base = path.basename(here);

  // release/.../tools
  if (base === "tools") {
    const releaseDir = path.resolve(here, "..");
    const parent = path.resolve(releaseDir, "..");
    // Prefer FT-ERP home (parent of releases/) when structure matches
    if (fs.existsSync(path.join(parent, "releases")) || fs.existsSync(path.join(parent, "shared"))) {
      return parent;
    }
    // Dev layout: repo/release/Flowtix-vX/tools → repo root
    if (path.basename(parent) === "release") {
      return path.resolve(parent, "..");
    }
    if (fs.existsSync(path.join(parent, "backend"))) {
      return parent;
    }
    return parent;
  }

  // deployment/ under repo
  if (base === "deployment") {
    return path.resolve(here, "..");
  }

  return path.resolve(here, "..");
}

function resolveSharedDir(home) {
  if (process.env.SHARED_DIR && String(process.env.SHARED_DIR).trim()) {
    return path.resolve(String(process.env.SHARED_DIR).trim());
  }
  return path.join(home, "shared");
}

function resolveBackupDir(home) {
  if (process.env.BACKUP_DIR && String(process.env.BACKUP_DIR).trim()) {
    return path.resolve(String(process.env.BACKUP_DIR).trim());
  }
  if (process.env.BACKUP_STORAGE_DIR && String(process.env.BACKUP_STORAGE_DIR).trim()) {
    return path.resolve(String(process.env.BACKUP_STORAGE_DIR).trim());
  }
  return path.join(home, "backups", "db");
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

  fs.mkdirSync(backupDir, { recursive: true });

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
  let errorMessage = null;

  try {
    console.log(`[backup-db] writing ${fileName} ...`);
    await runMysqldump(exe, dumpArgs, outAbs);
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
    status = "success";
    console.log(`[backup-db] OK size=${fileSize} bytes`);
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

  const entry = {
    filename: fileName,
    path: outAbs,
    timestamp: startedAt,
    appVersion: version,
    gitCommit: gitCommit,
    databaseName: db.database,
    host: db.host,
    fileSizeBytes: fileSize,
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
