/**
 * FT-DEP-001 Batch 7 — safe app/web rollback (not DB restore / service / installer).
 *
 * Restores active app/ + web/ from a prior Batch 6 archive under releases/.
 * Never modifies shared/, backups/, or runs Prisma. Never restores MySQL automatically.
 *
 * Usage:
 *   node deployment/rollback-flowtix.js [--yes] [--home <FT_ERP_HOME>] [--archive <path>]
 *   tools\rollback-flowtix.bat
 *
 * Env:
 *   FT_ERP_HOME, ROLLBACK_ARCHIVE, UPDATE_CONFIRM / ROLLBACK_CONFIRM=1
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const {
  stopServiceIfPresent,
  startServiceIfPresent,
  writeServiceXml,
  isServicePresent,
} = require("./service-control");

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
  const out = { yes: false, home: null, archive: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--archive" && argv[i + 1]) out.archive = path.resolve(argv[++i]);
  }
  if (
    process.env.ROLLBACK_CONFIRM === "1" ||
    process.env.UPDATE_CONFIRM === "1" ||
    /^y(es)?$/i.test(String(process.env.ROLLBACK_CONFIRM || ""))
  ) {
    out.yes = true;
  }
  if (process.env.ROLLBACK_ARCHIVE && String(process.env.ROLLBACK_ARCHIVE).trim()) {
    out.archive = path.resolve(String(process.env.ROLLBACK_ARCHIVE).trim());
  }
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim() && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function resolveInstallHome(cliHome) {
  if (cliHome) return path.resolve(cliHome);
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim()) {
    return path.resolve(String(process.env.FT_ERP_HOME).trim());
  }

  const here = scriptDir();
  if (path.basename(here) === "tools") {
    const releaseDir = path.resolve(here, "..");
    const parent = path.resolve(releaseDir, "..");
    if (fs.existsSync(path.join(parent, "releases")) || fs.existsSync(path.join(parent, "shared"))) {
      return parent;
    }
    if (path.basename(parent) === "release") {
      return path.resolve(parent, "..");
    }
    if (fs.existsSync(path.join(parent, "backend"))) {
      return parent;
    }
    return parent;
  }
  if (path.basename(here) === "deployment") {
    return path.resolve(here, "..");
  }
  return path.resolve(here, "..");
}

function resolveActiveRoot(home) {
  const current = path.join(home, "current");
  if (fs.existsSync(path.join(current, "app")) || fs.existsSync(path.join(current, "web"))) {
    return current;
  }
  return home;
}

function readVersionFile(filePath) {
  const meta = { productVersion: null, gitCommit: null, buildDate: null };
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
  }
  return meta;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function appendRollbackLog(logPath, lines) {
  ensureDir(path.dirname(logPath));
  const block = [`----- ${nowIso()} -----`, ...lines.map((l) => redactSecrets(String(l))), ""].join(
    "\n",
  );
  fs.appendFileSync(logPath, block, "utf8");
}

function logLine(msg) {
  const line = `[rollback-flowtix] ${msg}`;
  console.log(line);
  return line;
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
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function replaceTree(srcDir, destDir) {
  ensureDir(destDir);
  removeDirContents(destDir);
  copyDirRecursive(srcDir, destDir);
}

function snapshotProtected(home) {
  const sharedEnvPath = path.join(home, "shared", ".env");
  const snap = {
    shared: fs.existsSync(path.join(home, "shared")),
    logs: fs.existsSync(path.join(home, "logs")),
    backups: fs.existsSync(path.join(home, "backups")),
    sharedEnvPath: fs.existsSync(sharedEnvPath) ? sharedEnvPath : null,
    sharedEnvHash: null,
    backupNames: null,
  };
  if (snap.sharedEnvPath) {
    snap.sharedEnvHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(snap.sharedEnvPath))
      .digest("hex");
  }
  const backupDb = path.join(home, "backups", "db");
  if (fs.existsSync(backupDb)) {
    snap.backupNames = fs
      .readdirSync(backupDb)
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .join("|");
  }
  return snap;
}

function assertProtectedUntouched(home, snapshots) {
  for (const name of PROTECTED_TOP) {
    const p = path.join(home, name);
    if (!snapshots[name]) continue;
    if (!fs.existsSync(p)) {
      throw new Error(`Protected folder disappeared during rollback: ${p}`);
    }
  }
  if (snapshots.sharedEnvPath && snapshots.sharedEnvHash) {
    if (!fs.existsSync(snapshots.sharedEnvPath)) {
      throw new Error("shared/.env was removed during rollback.");
    }
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(snapshots.sharedEnvPath))
      .digest("hex");
    if (hash !== snapshots.sharedEnvHash) {
      throw new Error("shared/.env content changed during rollback — unexpected overwrite.");
    }
  }
  if (snapshots.backupNames != null) {
    const backupDb = path.join(home, "backups", "db");
    const now = fs.existsSync(backupDb)
      ? fs
          .readdirSync(backupDb)
          .filter((n) => n.endsWith(".sql"))
          .sort()
          .join("|")
      : "";
    if (now !== snapshots.backupNames) {
      throw new Error("backups/db SQL set changed during rollback — unexpected mutation.");
    }
  }
}

/**
 * Prefer newest Flowtix-v*-pre-update-* archive under releases/.
 */
function findLatestPreUpdateArchive(home, explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw Object.assign(new Error(`Archive not found: ${explicit}`), { code: "ARCHIVE_MISSING" });
    }
    return path.resolve(explicit);
  }

  const releasesDir = path.join(home, "releases");
  if (!fs.existsSync(releasesDir)) {
    throw Object.assign(
      new Error(
        `No releases/ folder at ${releasesDir}.\n` +
          `  Previous release archive is missing — cannot rollback.\n` +
          `  Run an update that archives app/web first, or pass --archive <path>.`,
      ),
      { code: "ARCHIVE_MISSING" },
    );
  }

  const dirs = fs
    .readdirSync(releasesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /pre-update/i.test(d.name))
    .map((d) => {
      const full = path.join(releasesDir, d.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { name: d.name, full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (!dirs.length) {
    throw Object.assign(
      new Error(
        `No pre-update archive found under ${releasesDir}.\n` +
          `  Expected folders named like Flowtix-vX.Y.Z-pre-update-<timestamp>.\n` +
          `  Previous release archive is missing — cannot rollback.`,
      ),
      { code: "ARCHIVE_MISSING" },
    );
  }
  return dirs[0].full;
}

function validateArchive(archivePath) {
  const errors = [];
  if (!fs.existsSync(archivePath)) {
    errors.push(`Archive path missing: ${archivePath}`);
    return errors;
  }
  const appDir = path.join(archivePath, "app");
  const webDir = path.join(archivePath, "web");
  if (!fs.existsSync(appDir)) {
    errors.push(`Archive app/ missing: ${appDir}`);
  } else if (!fs.existsSync(path.join(appDir, "server.js")) && !fs.existsSync(path.join(appDir, "package.json"))) {
    errors.push(`Archive app/ does not look like a Flowtix backend package`);
  }
  if (!fs.existsSync(webDir)) {
    errors.push(`Archive web/ missing: ${webDir}`);
  } else if (!fs.existsSync(path.join(webDir, "index.html"))) {
    errors.push(`Archive web/index.html missing`);
  }
  return errors;
}

function relatedBackupFilename(home) {
  // Prefer last successful update.log BACKUP=
  const updateLog = path.join(home, "logs", "update.log");
  if (fs.existsSync(updateLog)) {
    const text = fs.readFileSync(updateLog, "utf8");
    const matches = [...text.matchAll(/^BACKUP=(.+)$/gm)];
    if (matches.length) {
      return matches[matches.length - 1][1].trim();
    }
  }
  const manifestPath = path.join(home, "backups", "db", "BACKUP_MANIFEST.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const list = Array.isArray(m.backups) ? m.backups : [];
      const ok = list.filter((e) => e && e.status === "success");
      if (ok.length) return ok[ok.length - 1].filename || null;
    } catch {
      // ignore
    }
  }
  return null;
}

function loadRollbackManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: null, rollbacks: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || !Array.isArray(raw.rollbacks)) {
      return { version: 1, updatedAt: null, rollbacks: [] };
    }
    return raw;
  } catch {
    return { version: 1, updatedAt: null, rollbacks: [] };
  }
}

function saveRollbackManifest(filePath, manifest) {
  manifest.updatedAt = nowIso();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const startedIso = nowIso();
  const logLines = [];

  const home = resolveInstallHome(args.home);
  const activeRoot = resolveActiveRoot(home);
  const rollbackLogPath = path.join(home, "logs", "rollback.log");
  const manifestPath = path.join(home, "logs", "ROLLBACK_MANIFEST.json");

  const push = (msg) => {
    logLines.push(logLine(msg));
  };

  push("FT-DEP-001 Batch 7 — app/web rollback");
  push(`home=${home}`);
  push(`activeRoot=${activeRoot}`);

  let archivePath;
  try {
    archivePath = findLatestPreUpdateArchive(home, args.archive);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("");
    console.error("[rollback-flowtix] ERROR: previous release archive missing — rollback aborted");
    console.error(`  ${msg}`);
    console.error("");
    appendRollbackLog(rollbackLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=locate-archive",
      `ERROR=${msg}`,
    ]);
    const entry = {
      timestamp: startedIso,
      fromVersion: null,
      toVersion: null,
      restoredAppPath: null,
      restoredWebPath: null,
      relatedBackupFilename: relatedBackupFilename(home),
      archivePath: args.archive || null,
      status: "failed",
      durationMs: Date.now() - started,
      error: redactSecrets(msg).slice(0, 800),
    };
    try {
      const man = loadRollbackManifest(manifestPath);
      man.rollbacks.push(entry);
      saveRollbackManifest(manifestPath, man);
    } catch {
      // ignore
    }
    process.exit(2);
  }

  push(`archive=${archivePath}`);

  const archiveErrors = validateArchive(archivePath);
  if (archiveErrors.length) {
    console.error("");
    console.error("[rollback-flowtix] ERROR: archive incomplete — rollback aborted");
    for (const e of archiveErrors) console.error(`  - ${e}`);
    console.error("");
    appendRollbackLog(rollbackLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=validate-archive",
      ...archiveErrors.map((e) => `ERROR=${e}`),
    ]);
    const entry = {
      timestamp: startedIso,
      fromVersion: null,
      toVersion: null,
      restoredAppPath: null,
      restoredWebPath: null,
      relatedBackupFilename: relatedBackupFilename(home),
      archivePath,
      status: "failed",
      durationMs: Date.now() - started,
      error: archiveErrors.join("; ").slice(0, 800),
    };
    try {
      const man = loadRollbackManifest(manifestPath);
      man.rollbacks.push(entry);
      saveRollbackManifest(manifestPath, man);
    } catch {
      // ignore
    }
    process.exit(3);
  }

  const currentMeta = readVersionFile(path.join(activeRoot, "VERSION.txt"));
  const archiveMeta = readVersionFile(path.join(archivePath, "VERSION.txt"));
  const fromVersion = currentMeta.productVersion || "unknown";
  const toVersion = archiveMeta.productVersion || "unknown";
  const relatedBackup = relatedBackupFilename(home);

  console.log("");
  console.log("====================================================");
  console.log(" Flowtix ERP — Rollback (app/web only)");
  console.log("====================================================");
  console.log(` Current (from)  : ${fromVersion}`);
  console.log(` Restore (to)    : ${toVersion}`);
  console.log(` Archive         : ${archivePath}`);
  console.log(` Related backup  : ${relatedBackup || "(none recorded)"}`);
  console.log("====================================================");
  console.log("");
  console.log(" NOTE: Database is NOT restored automatically (Batch 7).");
  if (relatedBackup) {
    console.log(` If schema/data rollback is required, restore manually from:`);
    console.log(`   backups\\db\\${relatedBackup}`);
  } else {
    console.log(" If schema/data rollback is required, choose a verified dump under backups\\db\\");
  }
  console.log(" Automated DB restore is deferred to a later batch.");
  console.log("");

  if (!args.yes) {
    const ok = await askConfirm("Continue with app/web rollback? [y/N]: ");
    if (!ok) {
      push("Operator cancelled confirmation");
      appendRollbackLog(rollbackLogPath, [...logLines, "RESULT=cancelled", "STAGE=confirm"]);
      console.log("[rollback-flowtix] Cancelled.");
      process.exit(0);
    }
  } else {
    push("Confirmation skipped (--yes / ROLLBACK_CONFIRM)");
  }

  // Optional Windows Service stop (Batch 8)
  push("STAGE=service-stop");
  const stopSvc = stopServiceIfPresent(home);
  push(`service stop: ${stopSvc.detail}`);
  if (stopSvc.present && !stopSvc.ok) {
    console.error("");
    console.error("[rollback-flowtix] ERROR: could not stop Windows Service — rollback aborted");
    console.error(`  ${stopSvc.detail}`);
    console.error("");
    appendRollbackLog(rollbackLogPath, [
      ...logLines,
      "RESULT=failed",
      "STAGE=service-stop",
      `ERROR=${stopSvc.detail}`,
    ]);
    process.exit(7);
  }

  const protectedSnap = snapshotProtected(home);
  const srcApp = path.join(archivePath, "app");
  const srcWeb = path.join(archivePath, "web");
  const destApp = path.join(activeRoot, "app");
  const destWeb = path.join(activeRoot, "web");

  let status = "failed";
  let errorSummary = null;
  let startSvc = { present: false, ok: true, state: "not_installed", detail: "n/a" };

  try {
    push("STAGE=restore-app-web");
    // Never delete the archive — only copy from it into active app/web.
    console.log(`[rollback-flowtix] Restoring app/ ← ${srcApp}`);
    replaceTree(srcApp, destApp);
    console.log(`[rollback-flowtix] Restoring web/ ← ${srcWeb}`);
    replaceTree(srcWeb, destWeb);

    const verSrc = path.join(archivePath, "VERSION.txt");
    if (fs.existsSync(verSrc)) {
      fs.copyFileSync(verSrc, path.join(activeRoot, "VERSION.txt"));
      push("VERSION.txt restored from archive");
    }

    assertProtectedUntouched(home, protectedSnap);
    status = "success";
    push("restore OK: app/ + web/ restored; shared/logs/backups preserved; no Prisma");

    // Optional Windows Service start (Batch 8) — still no DB restore
    push("STAGE=service-start");
    if (isServicePresent()) {
      try {
        writeServiceXml(home);
        push("service XML refreshed for active app path");
      } catch (e) {
        push(`service XML refresh skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    startSvc = startServiceIfPresent(home);
    push(`service start: ${startSvc.detail}`);
    if (startSvc.present && !startSvc.ok) {
      status = "failed";
      errorSummary = `app/web restored but service start failed: ${startSvc.detail}`;
      console.error("[rollback-flowtix] ERROR:", errorSummary);
    }
  } catch (e) {
    status = "failed";
    errorSummary = redactSecrets(e instanceof Error ? e.message : String(e));
    console.error("[rollback-flowtix] ERROR: restore failed:", errorSummary);
  }

  const durationMs = Date.now() - started;
  const entry = {
    timestamp: startedIso,
    finishedAt: nowIso(),
    fromVersion,
    toVersion,
    restoredAppPath: destApp,
    restoredWebPath: destWeb,
    archivePath,
    relatedBackupFilename: relatedBackup,
    servicePresent: Boolean(startSvc && startSvc.present),
    serviceState: startSvc && startSvc.state ? startSvc.state : "not_installed",
    status,
    durationMs,
    ...(errorSummary ? { error: errorSummary.slice(0, 800) } : {}),
  };

  try {
    const man = loadRollbackManifest(manifestPath);
    man.rollbacks.push(entry);
    saveRollbackManifest(manifestPath, man);
    push(`manifest updated: ${manifestPath}`);
  } catch (e) {
    console.error(
      "[rollback-flowtix] ERROR: could not update ROLLBACK_MANIFEST.json:",
      e instanceof Error ? e.message : String(e),
    );
    if (status === "success") status = "failed";
  }

  appendRollbackLog(rollbackLogPath, [
    ...logLines,
    `RESULT=${status}`,
    `FROM_VERSION=${fromVersion}`,
    `TO_VERSION=${toVersion}`,
    `ARCHIVE=${archivePath}`,
    `RESTORED_APP=${destApp}`,
    `RESTORED_WEB=${destWeb}`,
    `RELATED_BACKUP=${relatedBackup || ""}`,
    `DURATION_MS=${durationMs}`,
    errorSummary ? `ERROR=${errorSummary}` : null,
  ].filter(Boolean));

  if (status !== "success") {
    console.error("");
    console.error("[rollback-flowtix] Rollback failed.");
    console.error("");
    process.exit(5);
  }

  console.log("");
  console.log("====================================================");
  console.log(" Rollback completed (app/web)");
  console.log("====================================================");
  console.log(` From version     : ${fromVersion}`);
  console.log(` To version       : ${toVersion}`);
  console.log(` Restored app     : ${destApp}`);
  console.log(` Restored web     : ${destWeb}`);
  console.log(` Related backup   : ${relatedBackup || "(none)"}`);
  console.log(` Elapsed          : ${(durationMs / 1000).toFixed(1)}s`);
  console.log(` Rollback log     : ${rollbackLogPath}`);
  console.log(` Manifest         : ${manifestPath}`);
  console.log("====================================================");
  console.log("");
  console.log(" DB restore was NOT performed. If migrations were applied and");
  console.log(" data must match the prior app, restore the related SQL dump manually.");
  console.log("");

  process.exit(0);
}

main().catch((e) => {
  console.error(
    "[rollback-flowtix] FATAL:",
    redactSecrets(e instanceof Error ? e.message : String(e)),
  );
  process.exit(1);
});
