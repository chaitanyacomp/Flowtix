/**
 * FT-DEP-001 Batch 6 — one-click update orchestrator (not rollback / service / installer).
 *
 * Sequence:
 *   1. Validate source release + install home
 *   2. Display versions; require confirmation
 *   3. backup-db.bat
 *   4. migrate-db.bat
 *   5. Replace only app/ + web/ (archive prior into releases/; never touch shared/logs/backups)
 *   6. Verify GET /health (or file-level equivalent if server down)
 *   7. Summary + logs/update.log
 *
 * Usage:
 *   node deployment/update-flowtix.js [--yes] [--source <releaseDir>] [--home <FT_ERP_HOME>]
 *   tools\update-flowtix.bat
 *
 * Env:
 *   FT_ERP_HOME, UPDATE_SOURCE, UPDATE_CONFIRM=1, HEALTH_URL, PORT
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");
const { spawnSync } = require("child_process");

const PROTECTED_TOP = new Set(["shared", "logs", "backups"]);

function scriptDir() {
  return __dirname;
}

function nowIso() {
  return new Date().toISOString();
}

function redactSecrets(text) {
  return String(text || "")
    .replace(/password\s*=\s*.+/gi, "password=***")
    .replace(/mysql:\/\/([^:]+):([^@]+)@/gi, "mysql://$1:***@");
}

function parseArgs(argv) {
  const out = { yes: false, source: null, home: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--source" && argv[i + 1]) out.source = path.resolve(argv[++i]);
    else if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
  }
  if (process.env.UPDATE_CONFIRM === "1" || /^y(es)?$/i.test(String(process.env.UPDATE_CONFIRM || ""))) {
    out.yes = true;
  }
  if (process.env.UPDATE_SOURCE && String(process.env.UPDATE_SOURCE).trim()) {
    out.source = path.resolve(String(process.env.UPDATE_SOURCE).trim());
  }
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim() && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function resolveSourceRelease(cliSource) {
  if (cliSource) return path.resolve(cliSource);

  const here = scriptDir();
  if (path.basename(here) === "tools") {
    return path.resolve(here, "..");
  }

  // Dev: prefer newest release/Flowtix-v* under repo
  const repo = path.resolve(here, "..");
  const releaseRoot = path.join(repo, "release");
  if (fs.existsSync(releaseRoot)) {
    const dirs = fs
      .readdirSync(releaseRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^Flowtix-v/i.test(d.name))
      .map((d) => d.name)
      .sort();
    if (dirs.length) return path.join(releaseRoot, dirs[dirs.length - 1]);
  }
  return null;
}

function resolveInstallHome(cliHome, sourceRelease) {
  if (cliHome) return path.resolve(cliHome);
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim()) {
    return path.resolve(String(process.env.FT_ERP_HOME).trim());
  }

  // Production layout: .../releases/Flowtix-vX/tools → home is parent of releases/
  if (sourceRelease) {
    const parent = path.resolve(sourceRelease, "..");
    if (path.basename(parent) === "releases" || path.basename(parent) === "release") {
      const home = path.resolve(parent, "..");
      if (fs.existsSync(path.join(home, "shared")) || fs.existsSync(path.join(home, "backups"))) {
        return home;
      }
    }
    // Dev: source under repo/release/Flowtix-v* → install home = repo (lab)
    if (path.basename(parent) === "release" && fs.existsSync(path.join(path.resolve(parent, ".."), "backend"))) {
      return path.resolve(parent, "..");
    }
  }

  const here = scriptDir();
  if (path.basename(here) === "deployment") return path.resolve(here, "..");
  return path.resolve(here, "..");
}

/**
 * Active deploy root: prefer <home>/current if it has app|web, else <home>.
 */
function resolveActiveRoot(home) {
  const current = path.join(home, "current");
  if (fs.existsSync(path.join(current, "app")) || fs.existsSync(path.join(current, "web"))) {
    return current;
  }
  return home;
}

function readVersionFile(filePath) {
  const meta = {
    productVersion: null,
    gitCommit: null,
    buildDate: null,
    productName: null,
    rawPath: filePath,
  };
  if (!filePath || !fs.existsSync(filePath)) return meta;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k === "productVersion") meta.productVersion = v;
    else if (k === "gitCommit") meta.gitCommit = v;
    else if (k === "buildDate") meta.buildDate = v;
    else if (k === "productName") meta.productName = v;
  }
  return meta;
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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function appendUpdateLog(logPath, lines) {
  ensureDir(path.dirname(logPath));
  const block = [`----- ${nowIso()} -----`, ...lines.map((l) => redactSecrets(l)), ""].join("\n");
  fs.appendFileSync(logPath, block, "utf8");
}

function logLine(updateLog, msg) {
  const line = `[update-flowtix] ${msg}`;
  console.log(line);
  return line;
}

function validateSourceRelease(source) {
  const errors = [];
  if (!source || !fs.existsSync(source)) {
    errors.push(`Release package not found: ${source || "(unset)"}`);
    return errors;
  }
  if (!fs.existsSync(path.join(source, "VERSION.txt"))) {
    errors.push(`VERSION.txt missing in release: ${source}`);
  }
  if (!fs.existsSync(path.join(source, "app"))) {
    errors.push(`app/ missing in release: ${source}`);
  }
  if (!fs.existsSync(path.join(source, "web"))) {
    errors.push(`web/ missing in release: ${source}`);
  }
  if (!fs.existsSync(path.join(source, "app", "server.js")) && !fs.existsSync(path.join(source, "app", "package.json"))) {
    errors.push(`app/ does not look like a Flowtix backend package: ${path.join(source, "app")}`);
  }
  if (!fs.existsSync(path.join(source, "web", "index.html"))) {
    errors.push(`web/index.html missing in release: ${source}`);
  }
  return errors;
}

function validateInstallHome(home, activeRoot) {
  const errors = [];
  if (!home || !fs.existsSync(home)) {
    errors.push(`Install home not found: ${home || "(unset)"}`);
    return errors;
  }
  const sharedEnv = path.join(home, "shared", ".env");
  if (!fs.existsSync(sharedEnv)) {
    errors.push(`shared/.env missing at ${sharedEnv}`);
  }
  // Active app/web may be missing on first install — Batch 6 is update of existing install.
  if (!fs.existsSync(path.join(activeRoot, "app"))) {
    errors.push(`Active app/ missing at ${path.join(activeRoot, "app")} (existing install required)`);
  }
  if (!fs.existsSync(path.join(activeRoot, "web"))) {
    errors.push(`Active web/ missing at ${path.join(activeRoot, "web")} (existing install required)`);
  }
  return errors;
}

function askConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer || "").trim()));
    });
  });
}

function runBat(batPath, args, env, cwd) {
  if (!fs.existsSync(batPath)) {
    return { status: 1, stdout: "", stderr: `Script not found: ${batPath}` };
  }
  const r = spawnSync("cmd.exe", ["/c", batPath, ...args], {
    cwd: cwd || path.dirname(batPath),
    env: { ...process.env, ...env },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: redactSecrets(r.stdout || ""),
    stderr: redactSecrets(r.stderr || ""),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (ent.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

/**
 * Replace destDir contents with srcDir. Never touches siblings (shared/logs/backups).
 */
function replaceTree(srcDir, destDir) {
  ensureDir(destDir);
  removeDirContents(destDir);
  copyDirRecursive(srcDir, destDir);
}

function archivePriorRelease(home, activeRoot, oldMeta) {
  const version = oldMeta.productVersion || "unknown";
  const stamp = nowIso().replace(/[:.]/g, "-");
  const archiveName = `Flowtix-v${version}-pre-update-${stamp}`;
  const archiveRoot = path.join(home, "releases", archiveName);
  ensureDir(archiveRoot);
  if (fs.existsSync(path.join(activeRoot, "app"))) {
    copyDirRecursive(path.join(activeRoot, "app"), path.join(archiveRoot, "app"));
  }
  if (fs.existsSync(path.join(activeRoot, "web"))) {
    copyDirRecursive(path.join(activeRoot, "web"), path.join(archiveRoot, "web"));
  }
  const verSrc = path.join(activeRoot, "VERSION.txt");
  if (fs.existsSync(verSrc)) {
    fs.copyFileSync(verSrc, path.join(archiveRoot, "VERSION.txt"));
  }
  return archiveRoot;
}

function assertProtectedUntouched(home, snapshots) {
  for (const name of PROTECTED_TOP) {
    const p = path.join(home, name);
    if (!snapshots[name]) continue;
    if (!fs.existsSync(p)) {
      throw new Error(`Protected folder disappeared during update: ${p}`);
    }
  }
  // shared/.env must still exist and match pre-update content hash if we snapshotted it
  if (snapshots.sharedEnvPath && snapshots.sharedEnvHash) {
    if (!fs.existsSync(snapshots.sharedEnvPath)) {
      throw new Error("shared/.env was removed during update — aborting safety check.");
    }
    const cur = fs.readFileSync(snapshots.sharedEnvPath);
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(cur).digest("hex");
    if (hash !== snapshots.sharedEnvHash) {
      throw new Error("shared/.env content changed during update — unexpected overwrite.");
    }
  }
}

function snapshotProtected(home) {
  const crypto = require("crypto");
  const sharedEnvPath = path.join(home, "shared", ".env");
  const snap = {
    shared: fs.existsSync(path.join(home, "shared")),
    logs: fs.existsSync(path.join(home, "logs")),
    backups: fs.existsSync(path.join(home, "backups")),
    sharedEnvPath: fs.existsSync(sharedEnvPath) ? sharedEnvPath : null,
    sharedEnvHash: null,
  };
  if (snap.sharedEnvPath) {
    snap.sharedEnvHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(snap.sharedEnvPath))
      .digest("hex");
  }
  return snap;
}

function latestSuccessfulBackup(backupDir) {
  const manifestPath = path.join(backupDir, "BACKUP_MANIFEST.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const list = Array.isArray(m.backups) ? m.backups : [];
    const ok = list.filter((e) => e && e.status === "success");
    return ok.length ? ok[ok.length - 1] : null;
  } catch {
    return null;
  }
}

function latestMigration(backupDir) {
  const manifestPath = path.join(backupDir, "MIGRATION_MANIFEST.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const list = Array.isArray(m.migrations) ? m.migrations : [];
    return list.length ? list[list.length - 1] : null;
  } catch {
    return null;
  }
}

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json, body });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, error: "timeout" });
    });
    req.on("error", (err) => {
      resolve({ ok: false, statusCode: 0, error: String(err.message || err) });
    });
  });
}

async function verifyHealth(activeRoot) {
  const port = process.env.PORT || "4000";
  const url =
    (process.env.HEALTH_URL && String(process.env.HEALTH_URL).trim()) ||
    `http://127.0.0.1:${port}/health`;

  const httpResult = await httpGetJson(url, 4000);
  if (httpResult.ok) {
    return {
      mode: "http",
      ok: true,
      url,
      detail: httpResult.json || { statusCode: httpResult.statusCode },
    };
  }

  // Equivalent startup verification when process is not listening (Batch 6 — no service control).
  const checks = [
    { name: "app/server.js", path: path.join(activeRoot, "app", "server.js") },
    { name: "web/index.html", path: path.join(activeRoot, "web", "index.html") },
    { name: "VERSION.txt", path: path.join(activeRoot, "VERSION.txt") },
  ];
  const missing = checks.filter((c) => !fs.existsSync(c.path)).map((c) => c.name);
  if (missing.length) {
    return {
      mode: "files",
      ok: false,
      url,
      httpError: httpResult.error || `HTTP ${httpResult.statusCode}`,
      detail: `Missing after deploy: ${missing.join(", ")}`,
    };
  }
  return {
    mode: "files",
    ok: true,
    url,
    httpError: httpResult.error || "connection refused",
    detail: "HTTP /health unreachable; file layout verification passed (start server separately).",
  };
}

function findTool(sourceRelease, home, name) {
  const candidates = [
    path.join(sourceRelease, "tools", name),
    path.join(scriptDir(), name),
    path.join(home, "tools", name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const logLines = [];

  const sourceRelease = resolveSourceRelease(args.source);
  const home = resolveInstallHome(args.home, sourceRelease);
  const activeRoot = resolveActiveRoot(home);
  const backupDir = path.join(home, "backups", "db");
  const updateLogPath = path.join(home, "logs", "update.log");

  const push = (msg) => {
    logLines.push(logLine(updateLogPath, msg));
  };

  push("FT-DEP-001 Batch 6 — update orchestrator");
  push(`source=${sourceRelease}`);
  push(`home=${home}`);
  push(`activeRoot=${activeRoot}`);

  // --- 1. Validate ---
  const sourceErrors = validateSourceRelease(sourceRelease);
  const homeErrors = validateInstallHome(home, activeRoot);
  const allErrors = [...sourceErrors, ...homeErrors];
  if (allErrors.length) {
    console.error("");
    console.error("[update-flowtix] ERROR: validation failed — update aborted");
    for (const e of allErrors) console.error(`  - ${e}`);
    console.error("");
    appendUpdateLog(updateLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=validate",
      ...allErrors.map((e) => `ERROR=${e}`),
    ]);
    process.exit(2);
  }

  loadEnvFile(path.join(home, "shared", ".env"));

  const targetMeta = readVersionFile(path.join(sourceRelease, "VERSION.txt"));
  const currentMeta = readVersionFile(
    fs.existsSync(path.join(activeRoot, "VERSION.txt"))
      ? path.join(activeRoot, "VERSION.txt")
      : path.join(sourceRelease, "VERSION.txt"),
  );
  // Prefer active VERSION for "current"; if identical copy from prior archive note
  const oldVersion = currentMeta.productVersion || "unknown";
  const newVersion = targetMeta.productVersion || "unknown";

  // --- 2. Display + confirm ---
  console.log("");
  console.log("====================================================");
  console.log(" Flowtix ERP — Update");
  console.log("====================================================");
  console.log(` Current Version : ${oldVersion}`);
  console.log(` Target Version  : ${newVersion}`);
  console.log(` Git Commit      : ${targetMeta.gitCommit || "unknown"}`);
  console.log(` Build Date      : ${targetMeta.buildDate || "unknown"}`);
  console.log(` Source package  : ${sourceRelease}`);
  console.log(` Install home    : ${home}`);
  console.log("====================================================");
  console.log("");

  if (!args.yes) {
    const ok = await askConfirm("Continue with update? [y/N]: ");
    if (!ok) {
      push("Operator cancelled confirmation");
      appendUpdateLog(updateLogPath, [...logLines, "RESULT=cancelled", "STAGE=confirm"]);
      console.log("[update-flowtix] Cancelled.");
      process.exit(0);
    }
  } else {
    push("Confirmation skipped (--yes / UPDATE_CONFIRM)");
  }

  const protectedSnap = snapshotProtected(home);

  // --- 3. Backup ---
  push("STAGE=backup");
  const backupBat = findTool(sourceRelease, home, "backup-db.bat");
  if (!backupBat) {
    console.error("[update-flowtix] ERROR: backup-db.bat not found");
    appendUpdateLog(updateLogPath, [...logLines, "RESULT=failed", "STAGE=backup", "ERROR=backup-db.bat missing"]);
    process.exit(3);
  }
  console.log(`[update-flowtix] Running backup: ${backupBat}`);
  const backupRun = runBat(
    backupBat,
    [],
    { FT_ERP_HOME: home, SHARED_DIR: path.join(home, "shared"), BACKUP_DIR: backupDir },
    path.dirname(backupBat),
  );
  if (backupRun.stdout) process.stdout.write(backupRun.stdout);
  if (backupRun.stderr) process.stderr.write(backupRun.stderr);
  if (backupRun.status !== 0) {
    console.error("");
    console.error("[update-flowtix] ERROR: backup failed — update aborted (no deploy)");
    console.error(`  exit=${backupRun.status}`);
    console.error("");
    appendUpdateLog(updateLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=backup",
      `EXIT=${backupRun.status}`,
      backupRun.error ? `ERROR=${backupRun.error}` : null,
    ].filter(Boolean));
    process.exit(3);
  }
  const backupEntry = latestSuccessfulBackup(backupDir);
  const backupFilename = backupEntry ? backupEntry.filename : "(unknown)";
  push(`backup OK: ${backupFilename}`);

  // --- 4. Migrate ---
  push("STAGE=migrate");
  const migrateBat = findTool(sourceRelease, home, "migrate-db.bat");
  if (!migrateBat) {
    console.error("[update-flowtix] ERROR: migrate-db.bat not found");
    appendUpdateLog(updateLogPath, [...logLines, "RESULT=failed", "STAGE=migrate", "ERROR=migrate-db.bat missing"]);
    process.exit(4);
  }
  const schemaFromSource = path.join(sourceRelease, "prisma", "schema.prisma");
  // Prefer Prisma 5 CLI from adjacent repo backend when release app has no prisma package
  let prismaCwd = process.env.PRISMA_CWD || "";
  if (!prismaCwd) {
    const guess = [
      path.join(home, "backend"),
      path.resolve(sourceRelease, "..", "..", "backend"),
      path.resolve(scriptDir(), "..", "backend"),
    ];
    for (const g of guess) {
      if (fs.existsSync(path.join(g, "node_modules", "prisma"))) {
        prismaCwd = g;
        break;
      }
    }
  }
  console.log(`[update-flowtix] Running migrate: ${migrateBat}`);
  const migrateRun = runBat(
    migrateBat,
    [],
    {
      FT_ERP_HOME: home,
      SHARED_DIR: path.join(home, "shared"),
      BACKUP_DIR: backupDir,
      PRISMA_SCHEMA_PATH: fs.existsSync(schemaFromSource) ? schemaFromSource : "",
      PRISMA_CWD: prismaCwd,
      MIGRATE_BACKUP_MAX_AGE_MINUTES: process.env.MIGRATE_BACKUP_MAX_AGE_MINUTES || "60",
    },
    path.dirname(migrateBat),
  );
  if (migrateRun.stdout) process.stdout.write(migrateRun.stdout);
  if (migrateRun.stderr) process.stderr.write(migrateRun.stderr);
  if (migrateRun.status !== 0) {
    console.error("");
    console.error("[update-flowtix] ERROR: migration failed — update aborted (app/web not replaced)");
    console.error(`  exit=${migrateRun.status}`);
    console.error("");
    appendUpdateLog(updateLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=migrate",
      `EXIT=${migrateRun.status}`,
      `BACKUP=${backupFilename}`,
      migrateRun.error ? `ERROR=${migrateRun.error}` : null,
    ].filter(Boolean));
    process.exit(4);
  }
  const migEntry = latestMigration(backupDir);
  const migrationStatus = migEntry ? migEntry.status : "success";
  push(`migrate OK: status=${migrationStatus}`);

  // --- 5. Deploy app/ + web/ only ---
  push("STAGE=deploy");
  const srcApp = path.join(sourceRelease, "app");
  const destApp = path.join(activeRoot, "app");
  const srcWeb = path.join(sourceRelease, "web");
  const destWeb = path.join(activeRoot, "web");
  if (path.resolve(srcApp) === path.resolve(destApp) || path.resolve(srcWeb) === path.resolve(destWeb)) {
    console.error("");
    console.error("[update-flowtix] ERROR: source release is the same as the active install");
    console.error("  Extract the new package to a separate folder and pass --source <path>");
    console.error("  (or run tools\\update-flowtix.bat from the NEW package while FT_ERP_HOME points at the install).");
    console.error("");
    appendUpdateLog(updateLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=deploy",
      "ERROR=source equals active install",
    ]);
    process.exit(5);
  }

  let archivePath = null;
  try {
    archivePath = archivePriorRelease(home, activeRoot, currentMeta);
    push(`archived prior app/web → ${archivePath}`);

    console.log(`[update-flowtix] Replacing app/ from source → ${destApp}`);
    replaceTree(srcApp, destApp);
    console.log(`[update-flowtix] Replacing web/ from source → ${destWeb}`);
    replaceTree(srcWeb, destWeb);

    // Refresh VERSION.txt at active root (metadata only; not shared/logs/backups)
    const verSrc = path.join(sourceRelease, "VERSION.txt");
    if (fs.existsSync(verSrc)) {
      fs.copyFileSync(verSrc, path.join(activeRoot, "VERSION.txt"));
    }

    assertProtectedUntouched(home, protectedSnap);
    push("deploy OK: app/ + web/ replaced; shared/logs/backups preserved");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[update-flowtix] ERROR: deploy failed:", msg);
    appendUpdateLog(updateLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=deploy",
      `BACKUP=${backupFilename}`,
      `MIGRATION=${migrationStatus}`,
      `ERROR=${msg}`,
    ]);
    process.exit(5);
  }

  // --- 6. Verify ---
  push("STAGE=verify");
  const health = await verifyHealth(activeRoot);
  if (!health.ok) {
    console.error("[update-flowtix] ERROR: post-deploy verification failed");
    console.error(`  ${health.detail || health.httpError}`);
    appendUpdateLog(updateLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=verify",
      `BACKUP=${backupFilename}`,
      `MIGRATION=${migrationStatus}`,
      `ERROR=${health.detail || health.httpError}`,
    ]);
    process.exit(6);
  }
  push(`verify OK: mode=${health.mode} ${health.detail ? String(health.detail).slice(0, 120) : ""}`);

  // --- 7. Summary ---
  const elapsedMs = Date.now() - started;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  console.log("");
  console.log("====================================================");
  console.log(" Update completed");
  console.log("====================================================");
  console.log(` Old version       : ${oldVersion}`);
  console.log(` New version       : ${newVersion}`);
  console.log(` Migration status  : ${migrationStatus}`);
  console.log(` Backup filename   : ${backupFilename}`);
  console.log(` Archive folder    : ${archivePath}`);
  console.log(` Elapsed time      : ${elapsedSec}s`);
  console.log(` Update log        : ${updateLogPath}`);
  console.log("====================================================");
  console.log("");

  appendUpdateLog(updateLogPath, [
    ...logLines,
    "RESULT=success",
    `OLD_VERSION=${oldVersion}`,
    `NEW_VERSION=${newVersion}`,
    `GIT_COMMIT=${targetMeta.gitCommit || "unknown"}`,
    `BUILD_DATE=${targetMeta.buildDate || "unknown"}`,
    `BACKUP=${backupFilename}`,
    `MIGRATION=${migrationStatus}`,
    `ARCHIVE=${archivePath}`,
    `VERIFY_MODE=${health.mode}`,
    `ELAPSED_MS=${elapsedMs}`,
  ]);

  process.exit(0);
}

main().catch((e) => {
  console.error("[update-flowtix] FATAL:", redactSecrets(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
