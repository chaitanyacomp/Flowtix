/**
 * FT-DEP-001 Milestone 2 — minimal Windows firewall helper (idempotent).
 *
 * Adds/verifies/removes a single inbound TCP rule for the Flowtix app port.
 * Never prints secrets. Requires Administrator for add/remove.
 *
 * Usage:
 *   node deployment/firewall-flowtix.js add [--port 4000] [--home <FT_ERP_HOME>]
 *   node deployment/firewall-flowtix.js verify [--port 4000]
 *   node deployment/firewall-flowtix.js remove
 *
 * Rule name (stable): Flowtix ERP Backend
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RULE_NAME = "Flowtix ERP Backend";
const DEFAULT_PORT = 4000;

function parseArgs(argv) {
  const out = {
    action: "verify",
    port: null,
    home: null,
    json: false,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) {
    out.action = String(rest.shift()).toLowerCase();
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--port" && rest[i + 1]) out.port = Number(rest[++i]);
    else if (a === "--home" && rest[i + 1]) out.home = path.resolve(rest[++i]);
    else if (a === "--json") out.json = true;
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function isAdmin() {
  if (process.platform !== "win32") return false;
  const r = spawnSync("net", ["session"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
  });
  return !r.error && r.status === 0;
}

function readPortFromEnv(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return null;
  try {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = /^PORT\s*=\s*(.*)$/i.exec(t);
      if (!m) continue;
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n < 65536) return n;
    }
  } catch {
    // ignore
  }
  return null;
}

function resolvePort(cliPort, home) {
  if (cliPort && Number.isFinite(cliPort)) return cliPort;
  if (process.env.PORT) {
    const n = Number(process.env.PORT);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (home) {
    const fromEnv = readPortFromEnv(path.join(home, "shared", ".env"));
    if (fromEnv) return fromEnv;
  }
  return DEFAULT_PORT;
}

function runNetsh(args) {
  const cmd = ["netsh", ...args];
  const r = spawnSync("netsh", args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 60000,
  });
  return {
    command: cmd.join(" "),
    status: typeof r.status === "number" ? r.status : 1,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim(),
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

function ruleExists() {
  const r = runNetsh(["advfirewall", "firewall", "show", "rule", `name=${RULE_NAME}`]);
  if (r.status !== 0) return { exists: false, result: r };
  const out = `${r.stdout}\n${r.stderr}`;
  if (/No rules match|not found|There are no rules/i.test(out)) {
    return { exists: false, result: r };
  }
  // netsh prints Rule Name: ... when found
  if (/Rule Name:/i.test(out) || new RegExp(RULE_NAME, "i").test(out)) {
    return { exists: true, result: r };
  }
  return { exists: r.status === 0 && out.length > 0, result: r };
}

function addRule(port) {
  const existing = ruleExists();
  if (existing.exists) {
    return {
      ok: true,
      action: "add",
      skipped: true,
      detail: `Rule already exists: "${RULE_NAME}" (no duplicate created).`,
      port,
      command: existing.result.command,
      result: existing.result.stdout || "exists",
    };
  }
  if (!isAdmin()) {
    return {
      ok: false,
      action: "add",
      detail: "Administrator privileges required to add firewall rule.",
      port,
      manual: manualAddCommand(port),
    };
  }
  const r = runNetsh([
    "advfirewall",
    "firewall",
    "add",
    "rule",
    `name=${RULE_NAME}`,
    "dir=in",
    "action=allow",
    "protocol=TCP",
    `localport=${port}`,
    "profile=private,domain",
    `description=Flowtix ERP LAN backend (TCP ${port})`,
  ]);
  return {
    ok: r.status === 0,
    action: "add",
    skipped: false,
    detail: r.status === 0 ? `Added inbound TCP rule for port ${port}.` : `Add failed: ${r.stderr || r.stdout || r.error}`,
    port,
    command: r.command,
    result: r.stdout || r.stderr || "",
    manual: r.status === 0 ? null : manualAddCommand(port),
  };
}

function verifyRule(port) {
  const existing = ruleExists();
  return {
    ok: existing.exists,
    action: "verify",
    detail: existing.exists
      ? `Rule "${RULE_NAME}" is present (expected port ${port}; confirm with Windows Firewall UI if needed).`
      : `Rule "${RULE_NAME}" not found. LAN clients may be blocked. Manual: ${manualAddCommand(port)}`,
    port,
    command: existing.result.command,
    result: existing.result.stdout || existing.result.stderr || "",
    manual: existing.exists ? null : manualAddCommand(port),
  };
}

function removeRule() {
  const existing = ruleExists();
  if (!existing.exists) {
    return {
      ok: true,
      action: "remove",
      skipped: true,
      detail: `Rule "${RULE_NAME}" not present — nothing to remove.`,
      command: existing.result.command,
    };
  }
  if (!isAdmin()) {
    return {
      ok: false,
      action: "remove",
      detail: "Administrator privileges required to remove firewall rule.",
      manual: `netsh advfirewall firewall delete rule name="${RULE_NAME}"`,
    };
  }
  const r = runNetsh(["advfirewall", "firewall", "delete", "rule", `name=${RULE_NAME}`]);
  return {
    ok: r.status === 0,
    action: "remove",
    skipped: false,
    detail: r.status === 0 ? `Removed rule "${RULE_NAME}".` : `Remove failed: ${r.stderr || r.stdout}`,
    command: r.command,
    result: r.stdout || r.stderr || "",
  };
}

function manualAddCommand(port) {
  return `netsh advfirewall firewall add rule name="${RULE_NAME}" dir=in action=allow protocol=TCP localport=${port} profile=private,domain`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = resolvePort(args.port, args.home);
  let report;
  if (args.action === "add" || args.action === "configure") {
    report = addRule(port);
  } else if (args.action === "remove" || args.action === "delete") {
    report = removeRule();
  } else {
    report = verifyRule(port);
  }

  if (args.json) {
    console.log(JSON.stringify({ ruleName: RULE_NAME, ...report }, null, 2));
  } else {
    console.log(`[firewall-flowtix] action=${report.action} ok=${report.ok}`);
    console.log(`[firewall-flowtix] ${report.detail}`);
    if (report.command) console.log(`[firewall-flowtix] command: ${report.command}`);
    if (report.manual) console.log(`[firewall-flowtix] manual fallback: ${report.manual}`);
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  RULE_NAME,
  DEFAULT_PORT,
  addRule,
  verifyRule,
  removeRule,
  resolvePort,
  ruleExists,
  manualAddCommand,
  isAdmin,
};
