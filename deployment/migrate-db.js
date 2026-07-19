/**
 * FT-DEP-001 Batch 5 — safe Prisma migrate deploy with mandatory backup gate.
 *
 * - Requires a recent successful entry in backups/db/BACKUP_MANIFEST.json
 * - Runs only: npx prisma migrate deploy
 * - Never: db push, migrate dev, seed, reset, restore, or auto-delete backups
 * - Never prints passwords
 *
 * Usage:
 *   node deployment/migrate-db.js
 *   node tools/migrate-db.js          (from release package)
 *
 * Env overrides:
 *   FT_ERP_HOME, SHARED_DIR, BACKUP_DIR, PRODUCT_VERSION
 *   MIGRATE_BACKUP_MAX_AGE_MINUTES (default 60)
 *   PRISMA_SCHEMA_PATH (absolute path to schema.prisma)
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const MIGRATION_COMMAND = "prisma migrate deploy";
const PRISMA_CLI_PIN = "prisma@5.22.0";
const DEFAULT_BACKUP_MAX_AGE_MIN = 60;

function scriptDir() {
  return __dirname;
}

/**
 * Detect install / repo home (FT_ERP_HOME override preserved).
 * Keep in sync with deployment/lib/resolveInstallHome.js.
 */
function resolveHome() {
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim()) {
    return path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  const here = scriptDir();
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
 * Prisma schema location:
 * - release package: <release>/prisma/schema.prisma (sibling of tools/)
 * - repo: <home>/backend/prisma/schema.prisma
 */
function resolveSchemaPath(home) {
  if (process.env.PRISMA_SCHEMA_PATH && String(process.env.PRISMA_SCHEMA_PATH).trim()) {
    return path.resolve(String(process.env.PRISMA_SCHEMA_PATH).trim());
  }

  const here = scriptDir();
  const base = path.basename(here);

  if (base === "tools") {
    const releaseSchema = path.join(here, "..", "prisma", "schema.prisma");
    if (fs.existsSync(releaseSchema)) return path.resolve(releaseSchema);
  }

  const candidates = [
    path.join(home, "backend", "prisma", "schema.prisma"),
    path.join(home, "prisma", "schema.prisma"),
    path.join(here, "..", "prisma", "schema.prisma"),
    path.join(here, "..", "backend", "prisma", "schema.prisma"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return null;
}

/**
 * Working directory for prisma CLI (prefer a tree that already has prisma@5.x).
 */
function resolvePrismaCwd(home, schemaPath) {
  if (process.env.PRISMA_CWD && String(process.env.PRISMA_CWD).trim()) {
    return path.resolve(String(process.env.PRISMA_CWD).trim());
  }

  const here = scriptDir();
  const candidates = [];
  if (path.basename(here) === "tools") {
    // Dev: release/Flowtix-v*/tools → repo/backend
    candidates.push(path.resolve(here, "..", "..", "..", "backend"));
    candidates.push(path.resolve(here, "..", "app"));
    candidates.push(path.resolve(here, ".."));
  }
  candidates.push(path.join(home, "backend"));
  candidates.push(home);
  if (schemaPath) {
    // .../release/Flowtix-vX/prisma/schema → .../backend
    candidates.push(path.resolve(path.dirname(schemaPath), "..", "..", "..", "backend"));
    candidates.push(path.resolve(path.dirname(schemaPath), "..", "app"));
    candidates.push(path.dirname(path.dirname(schemaPath)));
    candidates.push(path.dirname(schemaPath));
  }

  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    if (
      fs.existsSync(path.join(c, "node_modules", "prisma")) ||
      fs.existsSync(path.join(c, "node_modules", ".bin", "prisma")) ||
      fs.existsSync(path.join(c, "node_modules", ".bin", "prisma.cmd"))
    ) {
      return c;
    }
  }
  // Last resort: backend with package.json (npx will use pinned prisma@5.22.0)
  if (fs.existsSync(path.join(home, "backend", "package.json"))) {
    return path.join(home, "backend");
  }
  if (path.basename(here) === "tools") {
    const repoBackend = path.resolve(here, "..", "..", "..", "backend");
    if (fs.existsSync(path.join(repoBackend, "package.json"))) return repoBackend;
    const releaseApp = path.resolve(here, "..", "app");
    if (fs.existsSync(path.join(releaseApp, "package.json"))) return releaseApp;
  }
  return home;
}

function findLocalPrismaBin(cwd) {
  const bins =
    process.platform === "win32"
      ? [
          path.join(cwd, "node_modules", ".bin", "prisma.cmd"),
          path.join(cwd, "node_modules", "prisma", "build", "index.js"),
        ]
      : [
          path.join(cwd, "node_modules", ".bin", "prisma"),
          path.join(cwd, "node_modules", "prisma", "build", "index.js"),
        ];
  for (const b of bins) {
    if (fs.existsSync(b)) return b;
  }
  return null;
}

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
    host: u.hostname || "127.0.0.1",
    port: u.port ? String(u.port) : "3306",
    database: decodeURIComponent(dbPath),
  };
}

function redactSecrets(text) {
  return String(text || "")
    .replace(/password\s*=\s*.+/gi, "password=***")
    .replace(/mysql:\/\/([^:]+):([^@]+)@/gi, "mysql://$1:***@");
}

function readAppVersion(home) {
  if (process.env.PRODUCT_VERSION && String(process.env.PRODUCT_VERSION).trim()) {
    return String(process.env.PRODUCT_VERSION).trim();
  }
  const versionCandidates = [
    path.join(home, "VERSION.txt"),
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

function backupMaxAgeMs() {
  const raw = process.env.MIGRATE_BACKUP_MAX_AGE_MINUTES;
  const n = raw != null && String(raw).trim() !== "" ? Number(raw) : DEFAULT_BACKUP_MAX_AGE_MIN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_BACKUP_MAX_AGE_MIN * 60 * 1000;
  return n * 60 * 1000;
}

function loadJsonManifest(filePath, emptyShape) {
  if (!fs.existsSync(filePath)) return emptyShape;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || !Array.isArray(raw.migrations || raw.backups)) {
      return emptyShape;
    }
    return raw;
  } catch {
    return emptyShape;
  }
}

function saveMigrationManifest(manifestPath, manifest) {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/**
 * Latest successful backup that still exists on disk with size > 0 and is recent enough.
 */
function requireFreshBackup(backupDir) {
  const manifestPath = path.join(backupDir, "BACKUP_MANIFEST.json");
  const abortHint = 'Run backup-db.bat before migrate-db.bat';

  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(
      new Error(
        `BACKUP_MANIFEST.json not found at ${manifestPath}.\n  ${abortHint}`,
      ),
      { code: "BACKUP_GATE" },
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw Object.assign(
      new Error(`BACKUP_MANIFEST.json is unreadable.\n  ${abortHint}`),
      { code: "BACKUP_GATE" },
    );
  }

  const entries = Array.isArray(manifest.backups) ? manifest.backups : [];
  const successes = entries.filter((e) => e && e.status === "success");
  if (!successes.length) {
    throw Object.assign(
      new Error(`No successful backup entry in BACKUP_MANIFEST.json.\n  ${abortHint}`),
      { code: "BACKUP_GATE" },
    );
  }

  // Prefer last successful entry in append-only list (latest attempt that succeeded).
  const latest = successes[successes.length - 1];
  const fileName = latest.filename || path.basename(String(latest.path || ""));
  if (!fileName) {
    throw Object.assign(
      new Error(`Latest successful backup has no filename.\n  ${abortHint}`),
      { code: "BACKUP_GATE" },
    );
  }

  const fileAbs = latest.path && fs.existsSync(latest.path)
    ? latest.path
    : path.join(backupDir, fileName);

  if (!fs.existsSync(fileAbs)) {
    throw Object.assign(
      new Error(`Backup file missing on disk: ${fileAbs}.\n  ${abortHint}`),
      { code: "BACKUP_GATE" },
    );
  }

  let size = 0;
  try {
    size = fs.statSync(fileAbs).size;
  } catch {
    size = 0;
  }
  if (!size || size <= 0) {
    throw Object.assign(
      new Error(`Backup file is empty (0 bytes): ${fileAbs}.\n  ${abortHint}`),
      { code: "BACKUP_GATE" },
    );
  }

  const ts = latest.timestamp ? Date.parse(latest.timestamp) : NaN;
  if (!Number.isFinite(ts)) {
    throw Object.assign(
      new Error(`Latest successful backup has invalid timestamp.\n  ${abortHint}`),
      { code: "BACKUP_GATE" },
    );
  }

  const maxAge = backupMaxAgeMs();
  const ageMs = Date.now() - ts;
  if (ageMs < 0) {
    // Clock skew — allow but warn
    console.log("[migrate-db] WARN: backup timestamp is in the future; accepting.");
  } else if (ageMs > maxAge) {
    const ageMin = Math.round(ageMs / 60000);
    const maxMin = Math.round(maxAge / 60000);
    throw Object.assign(
      new Error(
        `Latest successful backup is too old (${ageMin} min; max ${maxMin} min).\n` +
          `  Backup: ${fileName}\n` +
          `  ${abortHint}`,
      ),
      { code: "BACKUP_GATE" },
    );
  }

  return {
    filename: fileName,
    path: fileAbs,
    timestamp: latest.timestamp,
    fileSizeBytes: size,
    ageMinutes: Math.max(0, Math.round(ageMs / 60000)),
    maxAgeMinutes: Math.round(maxAge / 60000),
  };
}

function runMigrateDeploy(cwd, schemaPath) {
  const localBin = findLocalPrismaBin(cwd);
  let cmd;
  let args;
  let useShell = false;

  if (localBin && localBin.endsWith(".js")) {
    cmd = process.execPath;
    args = [localBin, "migrate", "deploy", `--schema=${schemaPath}`];
  } else if (localBin) {
    cmd = localBin;
    args = ["migrate", "deploy", `--schema=${schemaPath}`];
    useShell = process.platform === "win32";
  } else {
    // Pin Prisma 5.x — bare `npx prisma` may resolve Prisma 7 which rejects schema url=.
    cmd = "npx";
    args = ["--yes", PRISMA_CLI_PIN, "migrate", "deploy", `--schema=${schemaPath}`];
    useShell = true;
  }

  console.log(`[migrate-db] command: ${cmd} ${args.join(" ")}`);
  console.log(`[migrate-db] cwd=${cwd}`);

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      shell: useShell,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = String(d);
      stdout += s;
      process.stdout.write(redactSecrets(s));
    });
    child.stderr.on("data", (d) => {
      const s = String(d);
      stderr += s;
      process.stderr.write(redactSecrets(s));
    });
    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(String(err?.message || err) + "\n" + stderr),
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
      });
    });
  });
}

function summarizeError(stdout, stderr, exitCode) {
  const blob = redactSecrets(`${stderr}\n${stdout}`.trim());
  if (!blob) return exitCode === 0 ? null : `migrate deploy exited ${exitCode}`;
  const lines = blob
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const interesting = lines.filter((l) =>
    /error|failed|p100|p300|p301|migrate/i.test(l),
  );
  const pick = (interesting.length ? interesting : lines).slice(-6).join(" | ");
  return pick.slice(0, 800);
}

async function main() {
  const home = resolveHome();
  const sharedDir = resolveSharedDir(home);
  const backupDir = resolveBackupDir(home);
  const migrationManifestPath = path.join(backupDir, "MIGRATION_MANIFEST.json");

  console.log("[migrate-db] FT-DEP-001 Batch 5 — Prisma migrate deploy (backup-gated)");
  console.log(`[migrate-db] home=${home}`);
  console.log(`[migrate-db] backupDir=${backupDir}`);

  const envLoaded = [];
  if (loadEnvFile(path.join(sharedDir, ".env"))) envLoaded.push(path.join(sharedDir, ".env"));
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
    console.log(
      `[migrate-db] env loaded from: ${envLoaded.length} file(s) (paths only; secrets not printed)`,
    );
  } else {
    console.log("[migrate-db] env: using process environment only");
  }

  let db;
  try {
    db = parseDatabaseUrl(process.env.DATABASE_URL);
  } catch (e) {
    console.error("");
    console.error("[migrate-db] ERROR: configuration");
    console.error(`  ${e.message}`);
    console.error("  Place DATABASE_URL in shared/.env (see deployment/production.env.example).");
    console.error("");
    process.exit(2);
  }
  console.log(`[migrate-db] database=${db.database} host=${db.host} port=${db.port} user=${db.user}`);

  // Milestone 3 Phase C — database safety (never db push / migrate reset)
  try {
    const dbSafety = require("./db-safety");
    const allowDev = process.env.DB_SAFETY_ALLOW_DEV === "1";
    const createDb = process.env.DB_SAFETY_CREATE_DB === "1";
    const safety = await dbSafety.validateDatabaseSafety({
      home,
      createIfMissing: createDb,
      allowDevDatabase: allowDev,
    });
    for (const c of safety.checks) {
      const tag = c.level === "ok" ? "OK" : c.level === "warn" ? "WARN" : "FAIL";
      console.log(`[migrate-db] db-safety [${tag}] ${c.id}: ${c.detail}`);
    }
    if (!safety.ok) {
      console.error("");
      console.error("[migrate-db] ERROR: database safety checks failed — migrate deploy blocked");
      console.error("  Fix MySQL connectivity/credentials/database name, then retry.");
      console.error("  Never use prisma db push or prisma migrate reset on production.");
      console.error("");
      process.exit(2);
    }
  } catch (e) {
    console.error("[migrate-db] ERROR: database safety probe failed:", e instanceof Error ? e.message : String(e));
    process.exit(2);
  }

  let backupGate;
  try {
    backupGate = requireFreshBackup(backupDir);
  } catch (e) {
    console.error("");
    console.error("[migrate-db] ERROR: backup gate failed — migration aborted");
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    console.error("");
    process.exit(4);
  }
  console.log(
    `[migrate-db] backup gate OK: ${backupGate.filename} (${backupGate.fileSizeBytes} bytes, age≈${backupGate.ageMinutes} min, max=${backupGate.maxAgeMinutes} min)`,
  );

  const schemaPath = resolveSchemaPath(home);
  if (!schemaPath || !fs.existsSync(schemaPath)) {
    console.error("");
    console.error("[migrate-db] ERROR: schema.prisma not found");
    console.error("  Expected release/prisma/schema.prisma or backend/prisma/schema.prisma");
    console.error("  Or set PRISMA_SCHEMA_PATH.");
    console.error("");
    process.exit(2);
  }
  console.log(`[migrate-db] schema=${schemaPath}`);

  const cwd = resolvePrismaCwd(home, schemaPath);
  const version = readAppVersion(home);
  const gitCommit = readGitCommit(home);
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();

  fs.mkdirSync(backupDir, { recursive: true });

  const result = await runMigrateDeploy(cwd, schemaPath);
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const status = result.exitCode === 0 ? "success" : "failed";
  const errorSummary =
    status === "failed" ? summarizeError(result.stdout, result.stderr, result.exitCode) : null;

  const entry = {
    timestamp: startedIso,
    finishedAt: endedAt.toISOString(),
    appVersion: version,
    gitCommit,
    databaseName: db.database,
    host: db.host,
    backupFilename: backupGate.filename,
    backupTimestamp: backupGate.timestamp,
    backupFileSizeBytes: backupGate.fileSizeBytes,
    migrationCommand: `${MIGRATION_COMMAND} --schema=${schemaPath}`,
    schemaPath,
    status,
    exitCode: result.exitCode,
    durationMs,
    ...(errorSummary ? { error: errorSummary } : {}),
  };

  try {
    const empty = { version: 1, updatedAt: null, migrations: [] };
    const manifest = loadJsonManifest(migrationManifestPath, empty);
    if (!Array.isArray(manifest.migrations)) manifest.migrations = [];
    manifest.version = manifest.version || 1;
    // Append only — never delete prior entries or backup files.
    manifest.migrations.push(entry);
    saveMigrationManifest(migrationManifestPath, manifest);
    console.log(`[migrate-db] manifest updated: ${migrationManifestPath}`);
  } catch (e) {
    console.error(
      "[migrate-db] ERROR: could not update MIGRATION_MANIFEST.json:",
      e instanceof Error ? e.message : String(e),
    );
    if (status === "success") {
      process.exit(1);
    }
  }

  if (status !== "success") {
    console.error("");
    console.error("[migrate-db] ERROR: migration failed");
    if (errorSummary) console.error(`  ${errorSummary}`);
    console.error("  Backup files were not deleted. Restore automation is deferred.");
    console.error("");
    process.exit(result.exitCode || 1);
  }

  console.log(`[migrate-db] OK durationMs=${durationMs}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[migrate-db] FATAL:", redactSecrets(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
