/**
 * FT-DEP-001 Milestone 3 Phase G — diagnostics bundle (ZIP-ready directory).
 *
 * Collects version/runtime/service/health/migration/log excerpts with secrets masked.
 *
 * Usage:
 *   node deployment/collect-diagnostics.js --home <FT_ERP_HOME> [--out <dir>] [--json]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawnSync } = require("child_process");
const {
  parseEnvFile,
  parseDatabaseUrl,
  redactSecrets,
  windowsVersion,
  findMysqlClient,
  nowIso,
  writeJsonSafe,
  isAdmin,
} = require("./install-common");

function parseArgs(argv) {
  const out = { home: null, out: null, json: false, skipHealth: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--out" && argv[i + 1]) out.out = path.resolve(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--skip-health") out.skipHealth = true;
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function safeRead(filePath, maxBytes = 256 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const buf = fs.readFileSync(filePath);
    const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    return redactSecrets(slice.toString("utf8"));
  } catch {
    return null;
  }
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text = safeRead(src);
  if (text == null) return false;
  fs.writeFileSync(dest, text, "utf8");
  return true;
}

function cmdVersion(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    timeout: 20000,
  });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || r.stderr || "").trim().split(/\r?\n/)[0] || null;
}

function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port, path: "/health", timeout: 4000 },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          if (body.length < 4096) body += c;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: redactSecrets(body) });
        });
      },
    );
    req.on("error", (e) => resolve({ error: e.code || e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout" });
    });
  });
}

function listDirSummary(dir) {
  if (!fs.existsSync(dir)) return { exists: false };
  const names = fs.readdirSync(dir);
  return { exists: true, entries: names.slice(0, 50), count: names.length };
}

function countMigrations(home) {
  const mig = path.join(home, "prisma", "migrations");
  if (!fs.existsSync(mig)) return { count: 0, path: null };
  const dirs = fs.readdirSync(mig, { withFileTypes: true }).filter((d) => d.isDirectory());
  return {
    count: dirs.length,
    path: mig,
    latest: dirs.map((d) => d.name).sort().slice(-1)[0] || null,
  };
}

async function collectDiagnostics(options = {}) {
  const home = path.resolve(options.home);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir =
    options.out || path.join(home, "logs", "diagnostics", `flowtix-diagnostics-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "manifests"), { recursive: true });

  const envPath = path.join(home, "shared", ".env");
  const env = parseEnvFile(envPath);
  const parsedDb = parseDatabaseUrl(env.DATABASE_URL || "");
  const port = Number(env.PORT) || 4000;

  const versionTxt = safeRead(path.join(home, "VERSION.txt")) || "";
  let productVersion = null;
  const m = versionTxt.match(/productVersion\s*=\s*(.+)/i);
  if (m) productVersion = m[1].trim();

  let service = { present: false };
  try {
    const sc = require("./service-control");
    service = sc.statusReport(home);
  } catch (e) {
    service = { error: String(e.message || e) };
  }

  const health = options.skipHealth ? { skipped: true } : await probeHealth(port);

  const mysqlExe = findMysqlClient();
  let mysqlVersion = null;
  if (mysqlExe) {
    mysqlVersion = cmdVersion(mysqlExe, ["--version"]);
  }

  const summary = {
    generatedAt: nowIso(),
    tool: "collect-diagnostics",
    milestone: "FT-DEP-001-M3-Phase-G",
    flowtixVersion: productVersion,
    installerVersion: productVersion,
    windowsVersion: windowsVersion().detail,
    nodeVersion: process.versions.node,
    npmVersion: cmdVersion("npm", ["--version"]),
    mysqlVersion,
    prismaVersion: cmdVersion("npx", ["--yes", "prisma@5.22.0", "-v"]),
    hostname: os.hostname(),
    isAdmin: isAdmin(),
    installationPath: home,
    configuredPort: port,
    backupPath: env.BACKUP_STORAGE_DIR || path.join(home, "backups", "db"),
    logPath: env.LOG_DIR || path.join(home, "logs"),
    database: parsedDb.ok
      ? {
          host: parsedDb.host,
          port: parsedDb.port,
          database: parsedDb.database,
          user: parsedDb.user,
          password: "***",
        }
      : { error: parsedDb.error || "unconfigured" },
    service,
    health,
    migrations: countMigrations(home),
    directories: {
      app: listDirSummary(path.join(home, "app")),
      web: listDirSummary(path.join(home, "web")),
      shared: listDirSummary(path.join(home, "shared")),
      backups: listDirSummary(path.join(home, "backups")),
      logs: listDirSummary(path.join(home, "logs")),
      prisma: listDirSummary(path.join(home, "prisma")),
      service: listDirSummary(path.join(home, "service")),
    },
    configurationSummary: {
      NODE_ENV: env.NODE_ENV || null,
      PORT: env.PORT || null,
      FT_ERP_HOME: env.FT_ERP_HOME || home,
      DATABASE_URL: parsedDb.ok
        ? `mysql://${parsedDb.user}:***@${parsedDb.host}:${parsedDb.port}/${parsedDb.database}`
        : "(invalid/missing)",
      JWT_SECRET: env.JWT_SECRET ? "***" : "(missing)",
    },
  };

  writeJsonSafe(path.join(outDir, "summary.json"), summary);
  fs.writeFileSync(
    path.join(outDir, "README.txt"),
    [
      "Flowtix ERP diagnostics bundle",
      `Generated: ${summary.generatedAt}`,
      "",
      "Contents are sanitized (passwords masked).",
      "Zip this folder and attach to support tickets.",
      "",
      "Files:",
      "  summary.json",
      "  VERSION.txt (copy)",
      "  logs/ (recent installer/setup/verify excerpts)",
      "  manifests/ (backup/migration/setup manifests if present)",
      "",
    ].join("\n"),
    "utf8",
  );

  copyIfExists(path.join(home, "VERSION.txt"), path.join(outDir, "VERSION.txt"));
  copyIfExists(path.join(home, "LAN-ACCESS.txt"), path.join(outDir, "LAN-ACCESS.txt"));

  const logFiles = [
    "setup.log",
    "verify-install.log",
    "installer-post.log",
    "update.log",
    "configure-env-summary.txt",
    path.join("install", "install-validation-report.txt"),
    path.join("install", "INSTALL_TRANSACTION.json"),
  ];
  for (const rel of logFiles) {
    copyIfExists(path.join(home, "logs", rel), path.join(outDir, "logs", rel.replace(/\\/g, "_")));
  }

  // WinSW service logs (tail)
  const svcLogDir = path.join(home, "logs", "service");
  if (fs.existsSync(svcLogDir)) {
    for (const name of fs.readdirSync(svcLogDir).slice(0, 10)) {
      copyIfExists(path.join(svcLogDir, name), path.join(outDir, "logs", `service_${name}`));
    }
  }

  const manifests = [
    path.join(home, "backups", "db", "BACKUP_MANIFEST.json"),
    path.join(home, "backups", "db", "MIGRATION_MANIFEST.json"),
    path.join(home, "logs", "SETUP_MANIFEST.json"),
  ];
  for (const mpath of manifests) {
    copyIfExists(mpath, path.join(outDir, "manifests", path.basename(mpath)));
  }

  // Optional verify-install JSON snapshot
  try {
    const verify = spawnSync(
      "node",
      [path.join(__dirname, "verify-install.js"), "--home", home, "--json", "--skip-service"],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    if (verify.stdout) {
      fs.writeFileSync(
        path.join(outDir, "verify-install.json"),
        redactSecrets(verify.stdout),
        "utf8",
      );
    }
  } catch {
    // ignore
  }

  return { ok: true, outDir, summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.home) {
    console.error("[collect-diagnostics] ERROR: --home required");
    process.exit(1);
  }
  const result = await collectDiagnostics({
    home: args.home,
    out: args.out,
    skipHealth: args.skipHealth,
  });
  if (args.json) {
    console.log(JSON.stringify({ outDir: result.outDir, summary: result.summary }, null, 2));
  } else {
    console.log(`[collect-diagnostics] Bundle written to:`);
    console.log(`  ${result.outDir}`);
    console.log(`[collect-diagnostics] Zip this folder for support.`);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[collect-diagnostics] FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

module.exports = { collectDiagnostics };
