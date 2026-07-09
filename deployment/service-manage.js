/**
 * FT-DEP-001 Batch 8 — CLI for Windows Service management.
 *
 * Usage:
 *   node deployment/service-manage.js <install|uninstall|start|stop|restart|status> [--home <path>]
 */
const path = require("path");
const {
  installService,
  uninstallService,
  stopServiceIfPresent,
  startServiceIfPresent,
  restartServiceIfPresent,
  statusReport,
  SERVICE_ID,
} = require("./service-control");

function parseArgs(argv) {
  const out = { cmd: null, home: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else rest.push(a);
  }
  out.cmd = (rest[0] || "").toLowerCase();
  return out;
}

function resolveHome(cliHome) {
  if (cliHome) return cliHome;
  if (process.env.FT_ERP_HOME && String(process.env.FT_ERP_HOME).trim()) {
    return path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  const here = __dirname;
  if (path.basename(here) === "tools") {
    const releaseDir = path.resolve(here, "..");
    const parent = path.resolve(releaseDir, "..");
    if (
      require("fs").existsSync(path.join(parent, "shared")) ||
      require("fs").existsSync(path.join(parent, "releases"))
    ) {
      return parent;
    }
    if (path.basename(parent) === "release") return path.resolve(parent, "..");
    return parent;
  }
  if (path.basename(here) === "deployment") return path.resolve(here, "..");
  return path.resolve(here, "..");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const home = resolveHome(args.home);

  console.log(`[service] FT-DEP-001 Batch 8 — ${SERVICE_ID}`);
  console.log(`[service] home=${home}`);
  console.log(`[service] command=${args.cmd || "(none)"}`);

  if (!args.cmd) {
    console.error("Usage: service-manage.js <install|uninstall|start|stop|restart|status> [--home <path>]");
    process.exit(1);
  }

  if (args.cmd === "status") {
    const s = statusReport(home);
    console.log(`[service] id=${s.serviceId}`);
    console.log(`[service] state=${s.state}`);
    console.log(`[service] present=${s.present}`);
    console.log(`[service] wrapper=${s.wrapperExists ? s.exePath : "(missing)"}`);
    console.log(`[service] xml=${s.xmlExists ? s.xmlPath : "(missing)"}`);
    console.log(`[service] appDir=${s.appDir}`);
    console.log(`[service] logDir=${s.logDir}`);
    console.log(`[service] admin=${s.admin}`);
    process.exit(0);
  }

  if (args.cmd === "install") {
    const r = await installService(home);
    console.log(r.ok ? `[service] OK: ${r.detail}` : `[service] ERROR: ${r.detail}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.cmd === "uninstall") {
    const r = uninstallService(home);
    console.log(r.ok ? `[service] OK: ${r.detail}` : `[service] ERROR: ${r.detail}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.cmd === "stop") {
    const r = stopServiceIfPresent(home);
    console.log(`[service] ${r.detail}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.cmd === "start") {
    const r = startServiceIfPresent(home);
    console.log(`[service] ${r.detail}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.cmd === "restart") {
    const r = restartServiceIfPresent(home);
    console.log(`[service] ${r.detail}`);
    process.exit(r.ok ? 0 : 1);
  }

  console.error(`[service] Unknown command: ${args.cmd}`);
  process.exit(1);
}

main().catch((e) => {
  console.error("[service] FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
