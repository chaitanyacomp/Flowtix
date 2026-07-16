/**
 * FT-DEP-001 Batch 9 — client setup / bootstrap (not MSI, not update, not DB wipe).
 *
 * Default Path A: folders → env validate → place app/web → backup → migrate → baseline backup
 * Path B: --skip-migrate (folders + env + place app/web only)
 *
 * Never overwrites existing shared/.env.
 * Never wipes/recreates production DB.
 * Service install remains optional.
 *
 * Usage:
 *   node deployment/setup-flowtix.js --home <FT_ERP_HOME> --source <releaseDir> [--yes]
 *        [--skip-migrate] [--install-service] [--skip-service]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { runPrerequisiteChecks } = require("./check-prereqs");
const { initFolders } = require("./init-folders");
const {
  installService,
  startServiceIfPresent,
  verifyServiceHealth,
  isAdmin,
} = require("./service-control");

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
  const out = {
    yes: false,
    home: null,
    source: null,
    skipMigrate: false,
    installService: false,
    skipService: false,
    configureFirewall: false,
    skipFirewall: false,
    force: false,
    skipValidate: false,
    createDb: false,
    allowDevDb: false,
    collectDiagnostics: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--source" && argv[i + 1]) out.source = path.resolve(argv[++i]);
    else if (a === "--skip-migrate") out.skipMigrate = true;
    else if (a === "--install-service") out.installService = true;
    else if (a === "--skip-service") out.skipService = true;
    else if (a === "--configure-firewall") out.configureFirewall = true;
    else if (a === "--skip-firewall") out.skipFirewall = true;
    else if (a === "--force") out.force = true;
    else if (a === "--skip-validate") out.skipValidate = true;
    else if (a === "--create-db") out.createDb = true;
    else if (a === "--allow-dev-db") out.allowDevDb = true;
    else if (a === "--skip-diagnostics") out.collectDiagnostics = false;
  }
  if (process.env.SETUP_CONFIRM === "1" || process.env.UPDATE_CONFIRM === "1") out.yes = true;
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  if (process.env.SETUP_SOURCE && !out.source) {
    out.source = path.resolve(String(process.env.SETUP_SOURCE).trim());
  }
  if (process.env.SETUP_SKIP_MIGRATE === "1") out.skipMigrate = true;
  if (process.env.SETUP_CONFIGURE_FIREWALL === "1") out.configureFirewall = true;
  if (process.env.SETUP_CREATE_DB === "1") out.createDb = true;
  return out;
}

function resolveSourceRelease(cliSource) {
  if (cliSource) return path.resolve(cliSource);
  const here = scriptDir();
  if (path.basename(here) === "tools") return path.resolve(here, "..");
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

function readVersionFile(filePath) {
  const meta = { productVersion: null, gitCommit: null, buildDate: null };
  if (!filePath || !fs.existsSync(filePath)) return meta;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k === "productVersion") meta.productVersion = v;
    else if (k === "gitCommit") meta.gitCommit = v;
    else if (k === "buildDate") meta.buildDate = v;
  }
  return meta;
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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function appendSetupLog(logPath, lines) {
  ensureDir(path.dirname(logPath));
  const block = [`----- ${nowIso()} -----`, ...lines.map((l) => redactSecrets(String(l))), ""].join(
    "\n",
  );
  fs.appendFileSync(logPath, block, "utf8");
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(from, to);
    else if (ent.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

function removeDirContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function replaceTree(srcDir, destDir) {
  ensureDir(destDir);
  removeDirContents(destDir);
  copyDirRecursive(srcDir, destDir);
}

function loadEnvFile(filePath, { override = false } = {}) {
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
    if (override || process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
  return true;
}

/**
 * Validate shared/.env without printing secret values.
 */
function validateEnvFile(envPath) {
  const issues = [];
  if (!fs.existsSync(envPath)) {
    return {
      ok: false,
      exists: false,
      issues: [`Missing ${envPath}`],
    };
  }
  loadEnvFile(envPath, { override: true });
  const required = ["DATABASE_URL"];
  for (const k of required) {
    const v = process.env[k];
    if (v == null || String(v).trim() === "") {
      issues.push(`${k} is missing`);
    }
  }
  const db = process.env.DATABASE_URL || "";
  if (db) {
    if (!/^mysql:\/\//i.test(db)) issues.push("DATABASE_URL must be mysql://...");
    if (/CHANGE_ME/i.test(db)) issues.push("DATABASE_URL still contains CHANGE_ME placeholder");
    try {
      const u = new URL(db.replace(/^mysql:\/\//i, "http://"));
      if (!(u.pathname || "").replace(/^\//, "")) issues.push("DATABASE_URL missing database name");
    } catch {
      issues.push("DATABASE_URL could not be parsed");
    }
  }
  const nodeEnv = String(process.env.NODE_ENV || "production").trim();
  if (nodeEnv === "production") {
    const jwt = process.env.JWT_SECRET || "";
    if (!jwt || jwt.length < 16) issues.push("JWT_SECRET missing or shorter than 16 characters");
    if (/CHANGE_ME/i.test(jwt)) issues.push("JWT_SECRET still contains CHANGE_ME placeholder");
  }
  return { ok: issues.length === 0, exists: true, issues, nodeEnv };
}

function findEnvExample(sourceRelease) {
  const candidates = [
    path.join(sourceRelease, "shared", ".env.example"),
    path.join(scriptDir(), "production.env.example"),
    path.join(scriptDir(), "..", "deployment", "production.env.example"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function ensureEnvTemplate(home, sourceRelease) {
  const sharedEnv = path.join(home, "shared", ".env");
  const exampleDest = path.join(home, "shared", ".env.example");
  const exampleSrc = findEnvExample(sourceRelease);
  if (exampleSrc && !fs.existsSync(exampleDest)) {
    fs.copyFileSync(exampleSrc, exampleDest);
  }
  return {
    envPath: sharedEnv,
    exists: fs.existsSync(sharedEnv),
    examplePath: fs.existsSync(exampleDest) ? exampleDest : exampleSrc,
  };
}

function validateSourceRelease(source) {
  const errors = [];
  if (!source || !fs.existsSync(source)) {
    errors.push(`Release package not found: ${source || "(unset)"}`);
    return errors;
  }
  for (const rel of ["VERSION.txt", "app", "web", path.join("app", "server.js"), path.join("web", "index.html")]) {
    if (!fs.existsSync(path.join(source, rel))) errors.push(`Missing in release: ${rel}`);
  }
  return errors;
}

function runBat(batPath, env, cwd) {
  if (!fs.existsSync(batPath)) {
    return { status: 1, stdout: "", stderr: `Script not found: ${batPath}` };
  }
  const r = spawnSync("cmd.exe", ["/c", batPath], {
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

function copyToolsIntoHome(sourceRelease, home) {
  const srcTools = path.join(sourceRelease, "tools");
  const destTools = path.join(home, "tools");
  if (!fs.existsSync(srcTools)) return { copied: false };
  ensureDir(destTools);
  for (const name of fs.readdirSync(srcTools)) {
    const from = path.join(srcTools, name);
    const to = path.join(destTools, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
  // Ensure setup scripts from deployment are present when running from repo
  for (const name of [
    "setup-flowtix.js",
    "setup-flowtix.bat",
    "check-prereqs.js",
    "check-prereqs.bat",
    "init-folders.js",
    "init-folders.bat",
    "service-control.js",
    "backup-db.js",
    "backup-db.bat",
    "migrate-db.js",
    "migrate-db.bat",
    "install-common.js",
    "install-validate.js",
    "install-validate.bat",
    "configure-env.js",
    "configure-env.bat",
    "db-safety.js",
    "db-safety.bat",
    "install-recovery.js",
    "install-recovery.bat",
    "collect-diagnostics.js",
    "collect-diagnostics.bat",
    "certify-install.js",
    "certify-install.bat",
    "firewall-flowtix.js",
    "firewall-flowtix.bat",
    "verify-install.js",
    "verify-install.bat",
  ]) {
    const from = path.join(scriptDir(), name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(destTools, name));
  }
  return { copied: true };
}

function placeRelease(sourceRelease, home) {
  const meta = readVersionFile(path.join(sourceRelease, "VERSION.txt"));
  const version = meta.productVersion || "0.0.0";
  const releaseName = path.basename(sourceRelease) || `Flowtix-v${version}`;
  const archiveDir = path.join(home, "releases", releaseName);
  ensureDir(archiveDir);
  // Retain full package under releases\ (idempotent refresh of package copy)
  for (const part of ["app", "web", "prisma", "tools"]) {
    const src = path.join(sourceRelease, part);
    if (fs.existsSync(src)) replaceTree(src, path.join(archiveDir, part));
  }
  for (const f of ["VERSION.txt", "RELEASE_NOTES.md"]) {
    const src = path.join(sourceRelease, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(archiveDir, f));
  }
  // Active layout used by Batch 6/8
  replaceTree(path.join(sourceRelease, "app"), path.join(home, "app"));
  replaceTree(path.join(sourceRelease, "web"), path.join(home, "web"));
  if (fs.existsSync(path.join(sourceRelease, "prisma"))) {
    replaceTree(path.join(sourceRelease, "prisma"), path.join(home, "prisma"));
  }
  fs.copyFileSync(path.join(sourceRelease, "VERSION.txt"), path.join(home, "VERSION.txt"));
  return { version, archiveDir, meta };
}

/**
 * Batch 3 ships app/ without node_modules (esbuild externals). Install runtime deps on the server.
 * @returns {{ ok: boolean, detail: string }}
 */
function installAppDependencies(home) {
  const appDir = path.join(home, "app");
  const pkg = path.join(appDir, "package.json");
  if (!fs.existsSync(pkg)) {
    return { ok: false, detail: "app/package.json missing — cannot npm install" };
  }
  const r = spawnSync("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"], {
    cwd: appDir,
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    timeout: 600000,
    env: { ...process.env, npm_config_production: "true" },
  });
  const ok = r.status === 0;
  const tail = String(r.stderr || r.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-8)
    .join(" | ");
  return {
    ok,
    detail: ok
      ? `npm install --omit=dev OK in app\\ (${tail || "done"})`
      : `npm install failed (exit ${r.status}): ${tail || r.error || "unknown"}`,
  };
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

function httpGetJson(url, timeoutMs = 4000) {
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
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.on("error", (err) => resolve({ ok: false, error: String(err.message || err) }));
  });
}

async function verifyHealth(home) {
  const port = process.env.PORT || "4000";
  const url = process.env.HEALTH_URL || `http://127.0.0.1:${port}/health`;
  const httpResult = await httpGetJson(url);
  if (httpResult.ok) return { mode: "http", ok: true, url, detail: httpResult.json };
  const filesOk =
    fs.existsSync(path.join(home, "app", "server.js")) &&
    fs.existsSync(path.join(home, "web", "index.html")) &&
    fs.existsSync(path.join(home, "VERSION.txt"));
  return {
    mode: "files",
    ok: filesOk,
    url,
    detail: filesOk
      ? "HTTP /health unreachable; file layout OK — start server with: node app\\server.js"
      : "Missing app/web/VERSION after setup",
  };
}

function loadSetupManifest(filePath) {
  if (!fs.existsSync(filePath)) return { version: 1, updatedAt: null, setups: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || !Array.isArray(raw.setups)) return { version: 1, updatedAt: null, setups: [] };
    return raw;
  } catch {
    return { version: 1, updatedAt: null, setups: [] };
  }
}

function saveSetupManifest(filePath, manifest) {
  manifest.updatedAt = nowIso();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function looksLikeExistingInstall(home) {
  return (
    fs.existsSync(path.join(home, "shared", ".env")) &&
    fs.existsSync(path.join(home, "app", "server.js")) &&
    fs.existsSync(path.join(home, "web", "index.html"))
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const startedIso = nowIso();
  const logLines = [];

  const sourceRelease = resolveSourceRelease(args.source);
  const home = args.home;
  if (!home) {
    console.error("[setup-flowtix] ERROR: --home <FT_ERP_HOME> is required");
    process.exit(1);
  }

  const setupLogPath = path.join(home, "logs", "setup.log");
  const manifestPath = path.join(home, "logs", "SETUP_MANIFEST.json");
  const push = (msg) => {
    const line = `[setup-flowtix] ${msg}`;
    console.log(line);
    logLines.push(line);
  };

  push("FT-DEP-001 Batch 9 — client setup / bootstrap");
  push(`home=${home}`);
  push(`source=${sourceRelease}`);
  push(`path=${args.skipMigrate ? "B (--skip-migrate)" : "A (backup→migrate→baseline)"}`);

  const sourceErrors = validateSourceRelease(sourceRelease);
  if (sourceErrors.length) {
    console.error("[setup-flowtix] ERROR: invalid release package");
    for (const e of sourceErrors) console.error(`  - ${e}`);
    process.exit(2);
  }

  if (looksLikeExistingInstall(home) && !args.force) {
    console.error("");
    console.error("[setup-flowtix] ERROR: existing install detected (shared/.env + app + web)");
    console.error("  Refusing to re-bootstrap. Use update-flowtix.bat for upgrades.");
    console.error("  Or pass --force only for controlled repair (still will NOT overwrite .env).");
    console.error("");
    process.exit(3);
  }

  const targetMeta = readVersionFile(path.join(sourceRelease, "VERSION.txt"));
  console.log("");
  console.log("====================================================");
  console.log(" Flowtix ERP — Client Setup (Batch 9)");
  console.log("====================================================");
  console.log(` Target home     : ${home}`);
  console.log(` Package version : ${targetMeta.productVersion || "unknown"}`);
  console.log(` Git commit      : ${targetMeta.gitCommit || "unknown"}`);
  console.log(` Migrate path    : ${args.skipMigrate ? "B skip-migrate" : "A backup+migrate"}`);
  console.log(` Service         : ${args.skipService ? "skip" : args.installService ? "install" : "prompt/optional"}`);
  console.log("====================================================");
  console.log("");

  if (!args.yes) {
    const ok = await askConfirm("Continue with client setup? [y/N]: ");
    if (!ok) {
      push("Cancelled by operator");
      process.exit(0);
    }
  } else {
    push("Confirmation skipped (--yes)");
  }

  // --- 1. Environment validation (Milestone 3 Phase A) — abort before any mutation ---
  push("STAGE=install-validate");
  if (!args.skipValidate) {
    const { runInstallValidation } = require("./install-validate");
    const validation = await runInstallValidation({
      home,
      source: sourceRelease,
      allowExisting: !!args.force,
      skipMysql: true, // DB deep-check runs after env exists (Path A)
      skipMigratePath: !!args.skipMigrate,
    });
    for (const c of validation.checks) {
      push(`validate [${c.level}] ${c.id}: ${c.detail}`);
      if (!c.ok && c.corrective) push(`  → ${c.corrective}`);
    }
    if (!validation.ok) {
      console.error("");
      console.error("[setup-flowtix] ERROR: installation environment validation failed");
      console.error("  Fix the FAIL items above, then re-run setup. No files were placed.");
      console.error(`  Report: ${path.join(home, "logs", "install", "install-validation-report.txt")}`);
      console.error("");
      appendSetupLog(setupLogPath, [...logLines, "RESULT=failed", "STAGE=install-validate"]);
      process.exit(4);
    }
  } else {
    push("install-validate skipped (--skip-validate)");
    const prereq = await runPrerequisiteChecks({ home });
    for (const c of prereq.checks) push(`prereq [${c.level}] ${c.id}: ${c.detail}`);
    if (!prereq.ok) {
      console.error("[setup-flowtix] ERROR: prerequisite check failed");
      appendSetupLog(setupLogPath, [...logLines, "RESULT=failed", "STAGE=prereqs"]);
      process.exit(4);
    }
  }
  if (!args.skipMigrate) {
    const dumpCheck = await runPrerequisiteChecks({ home });
    const dump = dumpCheck.checks.find((c) => c.id === "mysqldump");
    if (dump && !dump.ok) {
      console.error("[setup-flowtix] ERROR: Path A requires mysqldump (or use --skip-migrate)");
      appendSetupLog(setupLogPath, [...logLines, "RESULT=failed", "STAGE=prereqs-mysqldump"]);
      process.exit(4);
    }
  }

  // --- 1b. Begin install transaction (Phase E) ---
  const recovery = require("./install-recovery");
  let tx = null;
  try {
    tx = recovery.beginTransaction(home, {
      source: sourceRelease,
      productVersion: targetMeta.productVersion,
    });
    push(`install-tx begin id=${tx.id} snapshotted=${tx.snapshotted.join(",") || "fresh"}`);
  } catch (e) {
    push(`install-tx begin warn: ${e instanceof Error ? e.message : String(e)}`);
  }

  const failSetup = (exitCode, stage, message) => {
    console.error(`[setup-flowtix] ERROR: ${message}`);
    if (tx) {
      try {
        const aborted = recovery.abortTransaction(home, `${stage}: ${message}`);
        push(`install-tx abort: ${aborted.detail}`);
      } catch (e) {
        push(`install-tx abort failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    appendSetupLog(setupLogPath, [...logLines, "RESULT=failed", `STAGE=${stage}`]);
    process.exit(exitCode);
  };

  // --- 2. Folders ---
  push("STAGE=folders");
  const folders = initFolders(home);
  push(`folders created=${folders.created.length}`);

  // --- 3. Env ---
  push("STAGE=env");
  const envInfo = ensureEnvTemplate(home, sourceRelease);
  if (!envInfo.exists) {
    console.error("");
    console.error("[setup-flowtix] ERROR: shared/.env is missing");
    console.error(`  Run: tools\\configure-env.bat --home "${home}"`);
    console.error(`  Template: ${envInfo.examplePath || "deployment/production.env.example"}`);
    console.error("  Set DATABASE_URL and JWT_SECRET (no CHANGE_ME). Setup will NOT invent secrets.");
    console.error("");
    failSetup(5, "env-missing", "shared/.env missing — run configure-env first");
  }
  // Never overwrite existing .env — only validate
  const envVal = validateEnvFile(envInfo.envPath);
  if (!envVal.ok) {
    console.error("[setup-flowtix] ERROR: shared/.env validation failed (values not printed)");
    for (const i of envVal.issues) console.error(`  - ${i}`);
    failSetup(5, "env-validate", envVal.issues.join("; "));
  }
  push("env OK (secrets not printed)");
  if (tx) recovery.markStage(home, "env-ok", true);

  // --- 4. Place release ---
  push("STAGE=place-release");
  copyToolsIntoHome(sourceRelease, home);
  const placed = placeRelease(sourceRelease, home);
  push(`placed version=${placed.version} archive=${placed.archiveDir}`);
  if (tx) recovery.markStage(home, "place-release", true, placed.version);
  if (!fs.existsSync(path.join(home, "app", "server.js"))) {
    failSetup(9, "place-release", "app\\server.js missing after place — package incomplete");
  }
  if (!fs.existsSync(path.join(home, "web", "index.html"))) {
    failSetup(9, "place-release", "web\\index.html missing after place — package incomplete");
  }

  push("STAGE=npm-install-app");
  const npmInst = installAppDependencies(home);
  push(npmInst.detail);
  if (!npmInst.ok) {
    failSetup(9, "npm-install-app", npmInst.detail);
  }
  if (tx) recovery.markStage(home, "npm-install", true);

  let backupFilename = null;
  let migrationStatus = args.skipMigrate ? "skipped" : null;
  let baselineBackup = null;

  // --- 5. Path A: db-safety → backup → migrate → baseline backup ---
  if (!args.skipMigrate) {
    push("STAGE=db-safety");
    try {
      const dbSafety = require("./db-safety");
      const dbReport = await dbSafety.validateDatabaseSafety({
        home,
        createIfMissing: !!args.createDb,
        allowDevDatabase: !!args.allowDevDb,
      });
      for (const c of dbReport.checks) {
        push(`db-safety [${c.level}] ${c.id}: ${c.detail}`);
        if (!c.ok && c.corrective) push(`  → ${c.corrective}`);
      }
      if (!dbReport.ok) {
        failSetup(7, "db-safety", "Database safety checks failed — migrate deploy blocked");
      }
      if (tx) recovery.markStage(home, "db-safety", true);
    } catch (e) {
      failSetup(7, "db-safety", e instanceof Error ? e.message : String(e));
    }

    push("STAGE=backup-pre-migrate");
    const backupBat = findTool(sourceRelease, home, "backup-db.bat");
    const backupDir = path.join(home, "backups", "db");
    const backupRun = runBat(
      backupBat,
      { FT_ERP_HOME: home, SHARED_DIR: path.join(home, "shared"), BACKUP_DIR: backupDir },
      path.dirname(backupBat),
    );
    if (backupRun.stdout) process.stdout.write(backupRun.stdout);
    if (backupRun.stderr) process.stderr.write(backupRun.stderr);
    if (backupRun.status !== 0) {
      failSetup(6, "backup-pre-migrate", "pre-migrate backup failed — DB not migrated");
    }
    const b1 = latestSuccessfulBackup(backupDir);
    backupFilename = b1 ? b1.filename : null;
    push(`pre-migrate backup OK: ${backupFilename}`);

    push("STAGE=migrate");
    const migrateBat = findTool(sourceRelease, home, "migrate-db.bat");
    const schemaPath = path.join(home, "prisma", "schema.prisma");
    const schemaAlt = path.join(sourceRelease, "prisma", "schema.prisma");
    const migrateRun = runBat(
      migrateBat,
      {
        FT_ERP_HOME: home,
        SHARED_DIR: path.join(home, "shared"),
        BACKUP_DIR: backupDir,
        PRISMA_SCHEMA_PATH: fs.existsSync(schemaPath)
          ? schemaPath
          : fs.existsSync(schemaAlt)
            ? schemaAlt
            : "",
        MIGRATE_BACKUP_MAX_AGE_MINUTES: "60",
      },
      path.dirname(migrateBat),
    );
    if (migrateRun.stdout) process.stdout.write(migrateRun.stdout);
    if (migrateRun.stderr) process.stderr.write(migrateRun.stderr);
    if (migrateRun.status !== 0) {
      migrationStatus = "failed";
      failSetup(
        7,
        "migrate",
        "prisma migrate deploy failed — installation files rolled back; database left unchanged (restore from backup if needed)",
      );
    }
    migrationStatus = "success";
    push("migrate OK");
    if (tx) recovery.markStage(home, "migrate", true);

    push("STAGE=backup-baseline");
    const backupRun2 = runBat(
      backupBat,
      { FT_ERP_HOME: home, SHARED_DIR: path.join(home, "shared"), BACKUP_DIR: backupDir },
      path.dirname(backupBat),
    );
    if (backupRun2.stdout) process.stdout.write(backupRun2.stdout);
    if (backupRun2.stderr) process.stderr.write(backupRun2.stderr);
    if (backupRun2.status !== 0) {
      console.error("[setup-flowtix] WARN: baseline backup failed (migrate already applied)");
    } else {
      const b2 = latestSuccessfulBackup(backupDir);
      baselineBackup = b2 ? b2.filename : null;
      push(`baseline backup OK: ${baselineBackup}`);
    }
  } else {
    push("STAGE=migrate skipped (--skip-migrate Path B)");
  }

  // --- 6. Optional service ---
  let serviceResult = { attempted: false, ok: true, detail: "skipped" };
  push("STAGE=service");
  let wantService = args.installService;
  if (!args.skipService && !args.installService && !args.yes) {
    wantService = await askConfirm("Install optional Windows Service now? [y/N]: ");
  }
  if (args.skipService) wantService = false;
  if (wantService) {
    if (!isAdmin()) {
      serviceResult = {
        attempted: true,
        ok: false,
        detail: "Administrator required for service-install — skipped; run service-install.bat later",
      };
      console.error(`[setup-flowtix] WARN: ${serviceResult.detail}`);
    } else {
      const inst = await installService(home);
      if (!inst.ok) {
        serviceResult = { attempted: true, ok: false, detail: inst.detail };
        console.error(`[setup-flowtix] WARN: service install failed: ${inst.detail}`);
      } else {
        const start = startServiceIfPresent(home);
        let healthDetail = "health skipped (service not running)";
        let healthOk = start.ok;
        if (start.ok) {
          const sh = await verifyServiceHealth(home, { attempts: 10, delayMs: 2000 });
          healthOk = sh.ok;
          healthDetail = sh.detail;
          if (!sh.ok) {
            console.error(`[setup-flowtix] WARN: service started but health check failed: ${sh.detail}`);
          }
        }
        serviceResult = {
          attempted: true,
          ok: healthOk,
          detail: `${inst.detail}; start: ${start.detail}; ${healthDetail}`,
        };
        push(`service: ${serviceResult.detail}`);
      }
    }
  } else {
    push("service install skipped (optional)");
  }

  // --- 7. Optional firewall (LAN inbound TCP for app PORT) ---
  let firewallResult = { attempted: false, ok: true, detail: "skipped" };
  push("STAGE=firewall");
  let wantFirewall = args.configureFirewall;
  if (!args.skipFirewall && !args.configureFirewall && !args.yes) {
    wantFirewall = await askConfirm(
      "Configure Windows Firewall inbound rule for Flowtix port (LAN clients)? [y/N]: ",
    );
  }
  if (args.skipFirewall) wantFirewall = false;
  if (wantFirewall) {
    try {
      const fw = require("./firewall-flowtix");
      const report = fw.addRule(fw.resolvePort(null, home));
      firewallResult = {
        attempted: true,
        ok: !!report.ok,
        detail: report.detail + (report.manual ? ` Manual: ${report.manual}` : ""),
      };
      push(`firewall: ${firewallResult.detail}`);
      if (!report.ok) {
        console.error(`[setup-flowtix] WARN: firewall: ${firewallResult.detail}`);
      }
    } catch (e) {
      firewallResult = {
        attempted: true,
        ok: false,
        detail: `firewall helper error: ${e instanceof Error ? e.message : String(e)}`,
      };
      console.error(`[setup-flowtix] WARN: ${firewallResult.detail}`);
    }
  } else {
    push("firewall skipped (optional; see tools\\firewall-flowtix.bat / Administrator Runbook)");
  }

  // --- 8. Health ---
  push("STAGE=verify");
  const health = await verifyHealth(home);
  push(`verify mode=${health.mode} ok=${health.ok} ${typeof health.detail === "string" ? health.detail : ""}`);

  const durationMs = Date.now() - started;
  const status = health.ok ? "success" : "partial";
  const entry = {
    timestamp: startedIso,
    finishedAt: nowIso(),
    home,
    sourceRelease,
    appVersion: placed.version,
    gitCommit: targetMeta.gitCommit,
    path: args.skipMigrate ? "B" : "A",
    migrationStatus,
    backupFilename,
    baselineBackupFilename: baselineBackup,
    serviceAttempted: serviceResult.attempted,
    serviceOk: serviceResult.ok,
    serviceDetail: serviceResult.detail,
    firewallAttempted: firewallResult.attempted,
    firewallOk: firewallResult.ok,
    firewallDetail: firewallResult.detail,
    verifyMode: health.mode,
    status,
    durationMs,
  };

  try {
    const man = loadSetupManifest(manifestPath);
    man.setups.push(entry);
    saveSetupManifest(manifestPath, man);
    push(`manifest updated: ${manifestPath}`);
  } catch (e) {
    console.error("[setup-flowtix] WARN: SETUP_MANIFEST write failed:", e instanceof Error ? e.message : String(e));
  }

  if (tx) {
    try {
      recovery.commitTransaction(home);
      push("install-tx committed");
    } catch (e) {
      push(`install-tx commit warn: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let diagnosticsDir = null;
  if (args.collectDiagnostics) {
    try {
      const { collectDiagnostics } = require("./collect-diagnostics");
      const diag = await collectDiagnostics({ home, skipHealth: !health.ok });
      diagnosticsDir = diag.outDir;
      push(`diagnostics: ${diagnosticsDir}`);
    } catch (e) {
      push(`diagnostics warn: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  appendSetupLog(setupLogPath, [
    ...logLines,
    `RESULT=${status}`,
    `VERSION=${placed.version}`,
    `PATH=${args.skipMigrate ? "B" : "A"}`,
    `MIGRATION=${migrationStatus}`,
    `BACKUP=${backupFilename || ""}`,
    `BASELINE_BACKUP=${baselineBackup || ""}`,
    `SERVICE=${serviceResult.detail}`,
    `FIREWALL=${firewallResult.detail}`,
    `VERIFY=${health.mode}`,
    `DIAGNOSTICS=${diagnosticsDir || ""}`,
    `ELAPSED_MS=${durationMs}`,
  ]);

  console.log("");
  console.log("====================================================");
  console.log(" Setup completed");
  console.log("====================================================");
  console.log(` Home             : ${home}`);
  console.log(` Version          : ${placed.version}`);
  console.log(` Path             : ${args.skipMigrate ? "B skip-migrate" : "A"}`);
  console.log(` Migration        : ${migrationStatus}`);
  console.log(` Backup           : ${backupFilename || "(n/a)"}`);
  console.log(` Baseline backup  : ${baselineBackup || "(n/a)"}`);
  console.log(` Service          : ${serviceResult.detail}`);
  console.log(` Firewall         : ${firewallResult.detail}`);
  console.log(` Verify           : ${health.mode} (${health.ok ? "ok" : "check manually"})`);
  console.log(` Diagnostics      : ${diagnosticsDir || "(skipped)"}`);
  console.log(` Setup log        : ${setupLogPath}`);
  console.log(` Manifest         : ${manifestPath}`);
  console.log("====================================================");
  console.log("");
  console.log(" Server URL (this PC):  http://127.0.0.1:<PORT>/   (PORT from shared\\.env, default 4000)");
  console.log(" LAN clients:           http://<server-hostname-or-IPv4>:<PORT>/");
  console.log(" Backend serves the packaged React UI from web\\ (static hosting).");
  console.log(" Recovery: tools\\install-recovery.bat status --home ...");
  console.log("");
  if (health.mode === "files") {
    console.log(" Start backend:  set FT_ERP_HOME=" + home);
    console.log("                 node app\\server.js");
    console.log(" Or:             tools\\service-start.bat  (if service installed)");
    console.log("");
  }

  process.exit(status === "success" ? 0 : 8);
}

main().catch((e) => {
  console.error("[setup-flowtix] FATAL:", redactSecrets(e instanceof Error ? e.message : String(e)));
  try {
    const home = process.env.FT_ERP_HOME;
    if (home) {
      const recovery = require("./install-recovery");
      const st = recovery.statusTransaction(home);
      if (st && st.status === "in_progress") {
        recovery.abortTransaction(home, e instanceof Error ? e.message : String(e));
        console.error("[setup-flowtix] Install transaction aborted after fatal error (DB untouched).");
      }
    }
  } catch {
    // ignore
  }
  process.exit(1);
});
