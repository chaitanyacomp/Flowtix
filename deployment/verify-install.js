/**
 * FT-DEP-001 Batch 11 — read-only install verification helper.
 * Checks folder layout, VERSION.txt, shared/.env presence (not values),
 * optional GET /health, optional WinSW service status.
 * Never mutates install, DB, or .env. Never prints secrets.
 *
 * Usage:
 *   node deployment/verify-install.js [--home <FT_ERP_HOME>] [--port <n>] [--json] [--skip-health] [--skip-service]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

function parseArgs(argv) {
  const out = {
    home: null,
    port: null,
    json: false,
    skipHealth: false,
    skipService: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--skip-health") out.skipHealth = true;
    else if (a === "--skip-service") out.skipService = true;
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function resolveHome(cliHome) {
  if (cliHome) return cliHome;
  const here = __dirname;
  if (path.basename(here) === "tools") {
    const releaseDir = path.resolve(here, "..");
    const parent = path.resolve(releaseDir, "..");
    if (fs.existsSync(path.join(parent, "shared")) || fs.existsSync(path.join(parent, "releases"))) {
      return parent;
    }
    if (path.basename(parent) === "release") return path.resolve(parent, "..");
    return parent;
  }
  if (path.basename(here) === "deployment") return path.resolve(here, "..");
  return path.resolve(here, "..");
}

function check(id, ok, level, detail) {
  return { id, ok, level: level || (ok ? "ok" : "error"), detail };
}

function existsDir(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Read only PORT / NODE_ENV keys; never return or log other values. */
function readSafePortFromEnv(envPath) {
  if (!existsFile(envPath)) return null;
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

function readVersionSummary(versionPath) {
  if (!existsFile(versionPath)) return null;
  try {
    const text = fs.readFileSync(versionPath, "utf8");
    const map = {};
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i <= 0) continue;
      map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return {
      productVersion: map.productVersion || null,
      gitCommit: map.gitCommit || null,
      releaseFolder: map.releaseFolder || null,
    };
  } catch {
    return null;
  }
}

function probeHealth(port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/health",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          if (body.length < 4096) body += c;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
          const ok =
            res.statusCode === 200 &&
            parsed &&
            typeof parsed === "object" &&
            parsed.ok === true;
          resolve({
            ok,
            statusCode: res.statusCode,
            summary: ok
              ? `ok=true version=${parsed.version || "?"} database=${parsed.database || "?"}`
              : `HTTP ${res.statusCode} (body not a healthy /health JSON)`,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, statusCode: null, summary: `timeout after ${timeoutMs}ms` });
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        statusCode: null,
        summary: `unreachable (${err.code || err.message})`,
      });
    });
  });
}

function appendLog(home, lines) {
  const logDir = path.join(home, "logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    return;
  }
  const logPath = path.join(logDir, "verify-install.log");
  const stamp = new Date().toISOString();
  const block = [`--- ${stamp} ---`, ...lines, ""].join("\n");
  try {
    fs.appendFileSync(logPath, block, "utf8");
  } catch {
    // ignore log write failures (still report checks)
  }
  return logPath;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const home = resolveHome(args.home);
  const checks = [];

  checks.push(
    check("home", existsDir(home), existsDir(home) ? "ok" : "error", `FT_ERP_HOME=${home}`)
  );

  const requiredDirs = ["app", "web", "shared", "logs"];
  for (const d of requiredDirs) {
    const p = path.join(home, d);
    const ok = existsDir(p);
    checks.push(
      check(`dir:${d}`, ok, ok ? "ok" : "error", ok ? `present: ${d}\\` : `missing directory: ${d}\\`)
    );
  }

  const backupsDir = path.join(home, "backups");
  const backupsOk = existsDir(backupsDir);
  checks.push(
    check(
      "dir:backups",
      true,
      backupsOk ? "ok" : "warn",
      backupsOk
        ? "present: backups\\"
        : "backups\\ missing — expected after setup/init-folders; create before first backup"
    )
  )

  // prisma may live at home/prisma (release layout) or under a release package only
  const prismaDir = path.join(home, "prisma");
  const prismaOk = existsDir(prismaDir) || existsFile(path.join(home, "app", "prisma", "schema.prisma"));
  checks.push(
    check(
      "dir:prisma",
      prismaOk,
      prismaOk ? "ok" : "warn",
      prismaOk
        ? "prisma schema/migrations layout found"
        : "prisma\\ not found at home (may be OK if only release package holds migrations)"
    )
  );

  const serverJs = path.join(home, "app", "server.js");
  checks.push(
    check(
      "file:app/server.js",
      existsFile(serverJs),
      existsFile(serverJs) ? "ok" : "error",
      existsFile(serverJs) ? "app\\server.js present" : "app\\server.js missing"
    )
  );

  const indexHtml = path.join(home, "web", "index.html");
  checks.push(
    check(
      "file:web/index.html",
      existsFile(indexHtml),
      existsFile(indexHtml) ? "ok" : "error",
      existsFile(indexHtml) ? "web\\index.html present" : "web\\index.html missing"
    )
  );

  const versionPath = path.join(home, "VERSION.txt");
  const ver = readVersionSummary(versionPath);
  checks.push(
    check(
      "file:VERSION.txt",
      !!ver,
      ver ? "ok" : "warn",
      ver
        ? `productVersion=${ver.productVersion || "?"} gitCommit=${ver.gitCommit || "?"}`
        : "VERSION.txt missing at home (check active release folder)"
    )
  );

  const envPath = path.join(home, "shared", ".env");
  const envPresent = existsFile(envPath);
  checks.push(
    check(
      "file:shared/.env",
      envPresent,
      envPresent ? "ok" : "error",
      envPresent
        ? "shared\\.env present (contents not inspected)"
        : "shared\\.env missing — create from .env.example before start"
    )
  );

  // Never print env values; only use PORT for health probe
  let port = args.port;
  if (!port && envPresent) port = readSafePortFromEnv(envPath);
  if (!port) port = 4000;

  if (!args.skipHealth) {
    const health = await probeHealth(port);
    checks.push(
      check(
        "health",
        health.ok,
        health.ok ? "ok" : "warn",
        `GET http://127.0.0.1:${port}/health → ${health.summary}`
      )
    );
  } else {
    checks.push(check("health", true, "ok", "skipped (--skip-health)"));
  }

  if (!args.skipService) {
    try {
      const sc = require("./service-control");
      const s = sc.statusReport(home);
      checks.push(
        check(
          "service",
          true,
          "ok",
          s.present
            ? `WinSW ${s.serviceId} state=${s.state} (optional)`
            : `WinSW not installed (optional; state=${s.state})`
        )
      );
    } catch (err) {
      checks.push(
        check(
          "service",
          true,
          "warn",
          `service-control unavailable: ${err.message || err}`
        )
      );
    }
  } else {
    checks.push(check("service", true, "ok", "skipped (--skip-service)"));
  }

  const errors = checks.filter((c) => c.level === "error");
  const warns = checks.filter((c) => c.level === "warn");
  const ok = errors.length === 0;
  const exitCode = ok ? 0 : 1;

  const lines = [
    `[verify-install] FT-DEP-001 Batch 11 — read-only`,
    `[verify-install] home=${home}`,
    ...checks.map(
      (c) =>
        `[verify-install] ${c.level.toUpperCase()} ${c.id}: ${c.detail}`
    ),
    `[verify-install] result=${ok ? "PASS" : "FAIL"} errors=${errors.length} warns=${warns.length}`,
  ];

  const logPath = appendLog(home, lines);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok,
          home,
          exitCode,
          logPath: logPath || null,
          checks,
        },
        null,
        2
      )
    );
  } else {
    for (const line of lines) console.log(line);
    if (logPath) console.log(`[verify-install] log=${logPath}`);
  }

  process.exit(exitCode);
}

run().catch((err) => {
  console.error(`[verify-install] FATAL: ${err.message || err}`);
  process.exit(2);
});
