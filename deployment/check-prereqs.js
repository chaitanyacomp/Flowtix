/**
 * FT-DEP-001 Batch 9 — client machine prerequisite checker.
 * No secrets printed. No business logic.
 *
 * Usage:
 *   node deployment/check-prereqs.js [--home <FT_ERP_HOME>] [--json]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const net = require("net");

const MIN_NODE_MAJOR = 18;
const MIN_FREE_MB = 512;

function parseArgs(argv) {
  const out = { home: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--json") out.json = true;
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function checkNode() {
  const ver = process.versions.node;
  const major = Number(String(ver).split(".")[0]);
  const ok = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  return {
    id: "node",
    ok,
    level: ok ? "ok" : "error",
    detail: ok
      ? `Node.js ${ver} (>= ${MIN_NODE_MAJOR} required)`
      : `Node.js ${ver} is below required major ${MIN_NODE_MAJOR}`,
  };
}

function checkPlatform() {
  const ok = process.platform === "win32";
  return {
    id: "platform",
    ok,
    level: ok ? "ok" : "warn",
    detail: ok
      ? `Platform ${process.platform} (LAN Windows target)`
      : `Platform ${process.platform} — FT-DEP-001 LAN SOP targets Windows; continue at own risk`,
  };
}

function checkDisk(home) {
  const target = home || process.cwd();
  try {
    // Node 18+ diskSpace may not exist on all builds — fall back to free estimate via dir
    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(target);
      const freeMb = Math.floor((Number(s.bavail) * Number(s.bsize)) / (1024 * 1024));
      const ok = freeMb >= MIN_FREE_MB;
      return {
        id: "disk",
        ok,
        level: ok ? "ok" : "error",
        detail: `Free space ≈ ${freeMb} MB at ${target} (min ${MIN_FREE_MB} MB)`,
      };
    }
  } catch {
    // ignore
  }
  return {
    id: "disk",
    ok: true,
    level: "warn",
    detail: `Could not measure free disk at ${target}; ensure ≥ ${MIN_FREE_MB} MB free`,
  };
}

function checkWritable(home) {
  const target = home || path.join(os.tmpdir(), "flowtix-prereq-probe");
  try {
    fs.mkdirSync(target, { recursive: true });
    const probe = path.join(target, `.flowtix-write-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return {
      id: "writable",
      ok: true,
      level: "ok",
      detail: `Writable: ${target}`,
    };
  } catch (e) {
    return {
      id: "writable",
      ok: false,
      level: "error",
      detail: `Not writable: ${target} (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

function checkMysqldump() {
  if (process.env.MYSQLDUMP_PATH && fs.existsSync(process.env.MYSQLDUMP_PATH)) {
    return {
      id: "mysqldump",
      ok: true,
      level: "ok",
      detail: `mysqldump via MYSQLDUMP_PATH`,
    };
  }
  const candidates =
    process.platform === "win32"
      ? [
          "mysqldump",
          "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe",
          "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe",
        ]
      : ["mysqldump"];
  for (const exe of candidates) {
    if (path.isAbsolute(exe) && fs.existsSync(exe)) {
      return { id: "mysqldump", ok: true, level: "ok", detail: `Found ${exe}` };
    }
    const r = spawnSync(exe, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
      shell: true,
    });
    if (!r.error && r.status === 0) {
      return { id: "mysqldump", ok: true, level: "ok", detail: `mysqldump on PATH` };
    }
  }
  return {
    id: "mysqldump",
    ok: false,
    level: "warn",
    detail: "mysqldump not found — required for Path A backup/migrate; install MySQL client tools",
  };
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve({
        id: "port",
        ok: true,
        level: "warn",
        detail: `Port ${port} appears in use — choose another PORT in shared/.env or stop the process`,
      });
    });
    server.once("listening", () => {
      server.close(() => {
        resolve({
          id: "port",
          ok: true,
          level: "ok",
          detail: `Port ${port} appears free`,
        });
      });
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * @returns {Promise<{ ok: boolean, checks: object[] }>}
 */
async function runPrerequisiteChecks(options = {}) {
  const home = options.home || null;
  const port = Number(options.port || process.env.PORT || 4000) || 4000;
  const checks = [
    checkPlatform(),
    checkNode(),
    checkDisk(home),
    checkWritable(home || path.join(os.tmpdir(), "flowtix-setup")),
    checkMysqldump(),
    await checkPort(port),
  ];
  const hardFail = checks.some((c) => c.level === "error" && !c.ok);
  return { ok: !hardFail, checks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPrerequisiteChecks({ home: args.home });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("[check-prereqs] FT-DEP-001 Batch 9");
    for (const c of result.checks) {
      const tag = c.level === "ok" ? "OK  " : c.level === "warn" ? "WARN" : "FAIL";
      console.log(`  [${tag}] ${c.id}: ${c.detail}`);
    }
    console.log(result.ok ? "[check-prereqs] PASSED (warnings allowed)" : "[check-prereqs] FAILED");
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[check-prereqs] FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

module.exports = { runPrerequisiteChecks, MIN_NODE_MAJOR, MIN_FREE_MB };
