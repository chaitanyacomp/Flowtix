/**
 * FT-DEP-001 Batch 9 — idempotent FT_ERP_HOME folder initialization.
 *
 * Creates: shared, backups/db, logs/{app,deploy,service}, releases, service, tools (empty)
 * Never deletes existing content. Never writes secrets.
 *
 * Usage:
 *   node deployment/init-folders.js --home <FT_ERP_HOME>
 */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = { home: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
  }
  if (!out.home && process.env.FT_ERP_HOME) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function ensureDir(p, created) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    created.push(p);
    return "created";
  }
  return "exists";
}

/**
 * @param {string} home
 * @returns {{ home: string, created: string[], results: { path: string, status: string }[] }}
 */
function initFolders(home) {
  if (!home) throw new Error("home is required");
  const created = [];
  const results = [];
  const dirs = [
    home,
    path.join(home, "shared"),
    path.join(home, "shared", "uploads"),
    path.join(home, "backups"),
    path.join(home, "backups", "db"),
    path.join(home, "logs"),
    path.join(home, "logs", "app"),
    path.join(home, "logs", "deploy"),
    path.join(home, "logs", "service"),
    path.join(home, "releases"),
    path.join(home, "service"),
    path.join(home, "tools"),
    path.join(home, "app"),
    path.join(home, "web"),
  ];
  for (const d of dirs) {
    const status = ensureDir(d, created);
    results.push({ path: d, status });
  }
  return { home, created, results };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.home) {
    console.error("Usage: init-folders.js --home <FT_ERP_HOME>");
    process.exit(1);
  }
  console.log("[init-folders] FT-DEP-001 Batch 9");
  console.log(`[init-folders] home=${args.home}`);
  const r = initFolders(args.home);
  for (const row of r.results) {
    console.log(`  [${row.status}] ${row.path}`);
  }
  console.log(`[init-folders] created=${r.created.length}`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { initFolders };
