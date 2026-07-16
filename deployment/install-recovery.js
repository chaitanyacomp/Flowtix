/**
 * FT-DEP-001 Milestone 3 Phase E — installation transaction / recovery markers.
 *
 * Tracks install stages under logs/install/. On failure, rolls back installation
 * files placed in this session (app/web/prisma active copies) when a pre-install
 * snapshot exists. NEVER touches MySQL / shared/.env / backups customer data.
 *
 * Usage (library + CLI):
 *   node deployment/install-recovery.js begin --home <home> --source <release>
 *   node deployment/install-recovery.js abort --home <home> --reason "..."
 *   node deployment/install-recovery.js commit --home <home>
 *   node deployment/install-recovery.js status --home <home>
 */
const fs = require("fs");
const path = require("path");
const { nowIso, writeJsonSafe, redactSecrets } = require("./install-common");

const STATE_FILE = "INSTALL_TRANSACTION.json";

function statePath(home) {
  return path.join(home, "logs", "install", STATE_FILE);
}

function ensureInstallLogDir(home) {
  const dir = path.join(home, "logs", "install");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadState(home) {
  const p = statePath(home);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function saveState(home, state) {
  ensureInstallLogDir(home);
  writeJsonSafe(statePath(home), state);
  return statePath(home);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(from, to);
    else if (ent.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
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
  fs.mkdirSync(destDir, { recursive: true });
  removeDirContents(destDir);
  if (fs.existsSync(srcDir)) copyDirRecursive(srcDir, destDir);
}

/**
 * Begin transaction: snapshot existing app/web/prisma if present.
 */
function beginTransaction(home, meta = {}) {
  ensureInstallLogDir(home);
  const id = `tx-${Date.now()}`;
  const snapRoot = path.join(home, "logs", "install", "snapshots", id);
  fs.mkdirSync(snapRoot, { recursive: true });

  const snapshotted = [];
  for (const part of ["app", "web", "prisma"]) {
    const src = path.join(home, part);
    if (fs.existsSync(src)) {
      const dest = path.join(snapRoot, part);
      copyDirRecursive(src, dest);
      snapshotted.push(part);
    }
  }
  const versionSrc = path.join(home, "VERSION.txt");
  if (fs.existsSync(versionSrc)) {
    fs.copyFileSync(versionSrc, path.join(snapRoot, "VERSION.txt"));
    snapshotted.push("VERSION.txt");
  }

  const state = {
    id,
    status: "in_progress",
    startedAt: nowIso(),
    home,
    source: meta.source || null,
    snapRoot,
    snapshotted,
    stages: [{ name: "begin", at: nowIso(), ok: true }],
    meta: {
      productVersion: meta.productVersion || null,
    },
  };
  saveState(home, state);
  return state;
}

function markStage(home, name, ok, detail) {
  const state = loadState(home);
  if (!state || state.status !== "in_progress") return null;
  state.stages.push({
    name,
    at: nowIso(),
    ok: !!ok,
    detail: detail ? redactSecrets(String(detail)).slice(0, 500) : null,
  });
  saveState(home, state);
  return state;
}

/**
 * Abort: restore snapshotted app/web/prisma; leave shared/backups/logs intact.
 */
function abortTransaction(home, reason) {
  const state = loadState(home);
  if (!state) {
    return { ok: false, detail: "No install transaction to abort" };
  }
  if (state.status === "committed") {
    return { ok: false, detail: "Transaction already committed — use rollback-flowtix for app/web" };
  }

  const restored = [];
  const hadFileSnapshots = state.snapshotted.some((s) =>
    ["app", "web", "prisma", "VERSION.txt"].includes(s),
  );
  if (hadFileSnapshots && state.snapRoot && fs.existsSync(state.snapRoot)) {
    for (const part of ["app", "web", "prisma"]) {
      const snap = path.join(state.snapRoot, part);
      if (fs.existsSync(snap)) {
        replaceTree(snap, path.join(home, part));
        restored.push(part);
      } else if (state.snapshotted.includes(part)) {
        // was empty before — remove partial
        const dest = path.join(home, part);
        if (fs.existsSync(dest)) {
          removeDirContents(dest);
          restored.push(`${part}:cleared`);
        }
      }
    }
    const verSnap = path.join(state.snapRoot, "VERSION.txt");
    if (fs.existsSync(verSnap)) {
      fs.copyFileSync(verSnap, path.join(home, "VERSION.txt"));
      restored.push("VERSION.txt");
    }
  } else {
    // Fresh install failed (empty snapshot) — remove partial app/web/prisma only
    for (const part of ["app", "web", "prisma"]) {
      const dest = path.join(home, part);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
        restored.push(`${part}:removed-partial`);
      }
    }
    const ver = path.join(home, "VERSION.txt");
    if (fs.existsSync(ver) && !state.snapshotted.includes("VERSION.txt")) {
      fs.unlinkSync(ver);
      restored.push("VERSION.txt:removed-partial");
    }
  }

  state.status = "aborted";
  state.abortedAt = nowIso();
  state.abortReason = redactSecrets(reason || "unspecified");
  state.restored = restored;
  state.stages.push({ name: "abort", at: nowIso(), ok: true, detail: state.abortReason });
  saveState(home, state);

  return {
    ok: true,
    detail: `Install aborted. Restored installation files: ${restored.join(", ") || "(none)"}. Database and shared\\.env were NOT modified.`,
    state,
  };
}

function commitTransaction(home) {
  const state = loadState(home);
  if (!state) return { ok: false, detail: "No transaction" };
  state.status = "committed";
  state.committedAt = nowIso();
  state.stages.push({ name: "commit", at: nowIso(), ok: true });
  saveState(home, state);
  return { ok: true, detail: "Install transaction committed", state };
}

function statusTransaction(home) {
  return loadState(home);
}

function parseArgs(argv) {
  const out = { action: "status", home: null, source: null, reason: null };
  if (argv[0] && !argv[0].startsWith("-")) out.action = argv.shift();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--source" && argv[i + 1]) out.source = path.resolve(argv[++i]);
    else if (a === "--reason" && argv[i + 1]) out.reason = argv[++i];
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.home) {
    console.error("[install-recovery] ERROR: --home required");
    process.exit(1);
  }
  let result;
  if (args.action === "begin") {
    result = beginTransaction(args.home, { source: args.source });
    console.log(`[install-recovery] BEGIN id=${result.id} snapshotted=${result.snapshotted.join(",") || "(fresh)"}`);
  } else if (args.action === "abort") {
    result = abortTransaction(args.home, args.reason);
    console.log(`[install-recovery] ABORT ok=${result.ok} ${result.detail}`);
  } else if (args.action === "commit") {
    result = commitTransaction(args.home);
    console.log(`[install-recovery] COMMIT ok=${result.ok} ${result.detail}`);
  } else {
    result = statusTransaction(args.home);
    console.log(JSON.stringify(result, null, 2));
  }
  process.exit(result && result.ok === false ? 2 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  beginTransaction,
  markStage,
  abortTransaction,
  commitTransaction,
  statusTransaction,
  loadState,
  statePath,
};
