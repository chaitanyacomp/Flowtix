/**
 * FT-DEP-001 Batch 11 / Milestone 2 — read-only install verification.
 *
 * Checks folder layout, VERSION.txt, shared/.env presence (not values),
 * GET /health, root UI HTML (SPA shell markers), optional WinSW status.
 * Never mutates install, DB, or .env. Never prints secrets. No auth required.
 *
 * Exit codes:
 *   0 — PASS
 *   1 — missing deployment files / layout errors
 *   2 — backend unavailable (health unreachable)
 *   3 — API healthy but frontend unavailable / not HTML
 *   4 — version metadata mismatch / missing when required
 *   5 — other failure
 *
 * Usage:
 *   node deployment/verify-install.js [--home <FT_ERP_HOME>] [--port <n>] [--json]
 *        [--skip-health] [--skip-ui] [--skip-service] [--expect-version <x.y.z>]
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const EXIT = {
  PASS: 0,
  MISSING_FILES: 1,
  BACKEND_UNAVAILABLE: 2,
  FRONTEND_UNAVAILABLE: 3,
  VERSION_MISMATCH: 4,
  OTHER: 5,
};

const UI_MARKERS = ["Flowtix ERP", "ft-erp-splash", 'id="root"', "id='root'"];

function parseArgs(argv) {
  const out = {
    home: null,
    port: null,
    json: false,
    skipHealth: false,
    skipUi: false,
    skipService: false,
    expectVersion: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--skip-health") out.skipHealth = true;
    else if (a === "--skip-ui") out.skipUi = true;
    else if (a === "--skip-service") out.skipService = true;
    else if (a === "--expect-version" && argv[i + 1]) out.expectVersion = String(argv[++i]).trim();
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  if (process.env.VERIFY_EXPECT_VERSION && !out.expectVersion) {
    out.expectVersion = String(process.env.VERIFY_EXPECT_VERSION).trim();
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

function check(id, ok, level, detail, codeHint) {
  return { id, ok, level: level || (ok ? "ok" : "error"), detail, codeHint: codeHint || null };
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

/** Read only PORT key; never return or log other values. */
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

function httpGet(port, urlPath, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        timeout: timeoutMs,
        headers: { Accept: "*/*" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          if (body.length < 65536) body += c;
        });
        res.on("end", () => {
          resolve({
            ok: true,
            statusCode: res.statusCode,
            contentType: String(res.headers["content-type"] || ""),
            body,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: `unreachable (${err.code || err.message})` });
    });
  });
}

function probeHealth(port) {
  return httpGet(port, "/health").then((res) => {
    if (!res.ok) {
      return { ok: false, statusCode: null, summary: res.error, version: null };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = null;
    }
    const healthy =
      res.statusCode === 200 &&
      parsed &&
      typeof parsed === "object" &&
      parsed.ok === true;
    return {
      ok: healthy,
      statusCode: res.statusCode,
      version: parsed && parsed.version ? String(parsed.version) : null,
      summary: healthy
        ? `ok=true version=${parsed.version || "?"} database=${parsed.database || "?"}`
        : `HTTP ${res.statusCode} (body not a healthy /health JSON)`,
      unreachable: false,
    };
  });
}

function probeUi(port) {
  return httpGet(port, "/").then((res) => {
    if (!res.ok) {
      return {
        ok: false,
        summary: res.error,
        isHtml: false,
        hasMarker: false,
      };
    }
    const ct = res.contentType.toLowerCase();
    const isHtml = ct.includes("text/html") || /^\s*</.test(res.body);
    const hasMarker = UI_MARKERS.some((m) => res.body.includes(m));
    const looksLikeApiJson =
      ct.includes("application/json") || /Mini ERP Backend Running/.test(res.body);
    const ok = res.statusCode === 200 && isHtml && hasMarker && !looksLikeApiJson;
    return {
      ok,
      statusCode: res.statusCode,
      isHtml,
      hasMarker,
      looksLikeApiJson,
      summary: ok
        ? "HTML SPA shell OK (Flowtix markers present)"
        : looksLikeApiJson
          ? "root returned API JSON — static hosting not active or web/ missing"
          : `HTTP ${res.statusCode} html=${isHtml} marker=${hasMarker}`,
    };
  });
}

function appendLog(home, lines) {
  const logDir = path.join(home, "logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    return null;
  }
  const logPath = path.join(logDir, "verify-install.log");
  const stamp = new Date().toISOString();
  const block = [`--- ${stamp} ---`, ...lines, ""].join("\n");
  try {
    fs.appendFileSync(logPath, block, "utf8");
  } catch {
    return null;
  }
  return logPath;
}

function resolveExitCode(checks, healthState, uiState) {
  const errors = checks.filter((c) => c.level === "error");
  if (errors.length === 0) return EXIT.PASS;

  if (errors.some((c) => c.codeHint === "VERSION_MISMATCH")) return EXIT.VERSION_MISMATCH;
  if (healthState === "unreachable") return EXIT.BACKEND_UNAVAILABLE;
  if (healthState === "ok" && uiState === "fail") return EXIT.FRONTEND_UNAVAILABLE;
  if (errors.some((c) => String(c.id).startsWith("dir:") || String(c.id).startsWith("file:"))) {
    return EXIT.MISSING_FILES;
  }
  if (healthState === "fail") return EXIT.BACKEND_UNAVAILABLE;
  if (uiState === "fail") return EXIT.FRONTEND_UNAVAILABLE;
  return EXIT.OTHER;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const home = resolveHome(args.home);
  const checks = [];
  let healthState = "skipped";
  let uiState = "skipped";

  checks.push(
    check("home", existsDir(home), existsDir(home) ? "ok" : "error", `FT_ERP_HOME=${home}`, "MISSING_FILES")
  );

  const requiredDirs = ["app", "web", "shared", "logs"];
  for (const d of requiredDirs) {
    const p = path.join(home, d);
    const ok = existsDir(p);
    checks.push(
      check(
        `dir:${d}`,
        ok,
        ok ? "ok" : "error",
        ok ? `present: ${d}\\` : `missing directory: ${d}\\`,
        "MISSING_FILES"
      )
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
  );

  const prismaDir = path.join(home, "prisma");
  const prismaOk =
    existsDir(prismaDir) || existsFile(path.join(home, "app", "prisma", "schema.prisma"));
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
      existsFile(serverJs) ? "app\\server.js present" : "app\\server.js missing",
      "MISSING_FILES"
    )
  );

  const indexHtml = path.join(home, "web", "index.html");
  checks.push(
    check(
      "file:web/index.html",
      existsFile(indexHtml),
      existsFile(indexHtml) ? "ok" : "error",
      existsFile(indexHtml) ? "web\\index.html present" : "web\\index.html missing",
      "MISSING_FILES"
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

  if (args.expectVersion) {
    const match = !!(ver && ver.productVersion === args.expectVersion);
    checks.push(
      check(
        "version:expect",
        match,
        match ? "ok" : "error",
        match
          ? `version matches expected ${args.expectVersion}`
          : `version mismatch: expected=${args.expectVersion} actual=${(ver && ver.productVersion) || "missing"}`,
        "VERSION_MISMATCH"
      )
    );
  }

  const envPath = path.join(home, "shared", ".env");
  const envPresent = existsFile(envPath);
  checks.push(
    check(
      "file:shared/.env",
      envPresent,
      envPresent ? "ok" : "error",
      envPresent
        ? "shared\\.env present (contents not inspected)"
        : "shared\\.env missing — create from .env.example before start",
      "MISSING_FILES"
    )
  );

  let port = args.port;
  if (!port && envPresent) port = readSafePortFromEnv(envPath);
  if (!port) port = 4000;

  if (!args.skipHealth) {
    const health = await probeHealth(port);
    if (!health.ok && /unreachable|timeout/i.test(health.summary || "")) {
      healthState = "unreachable";
      checks.push(
        check(
          "health",
          false,
          "error",
          `GET http://127.0.0.1:${port}/health → ${health.summary}`,
          "BACKEND_UNAVAILABLE"
        )
      );
    } else if (!health.ok) {
      healthState = "fail";
      checks.push(
        check(
          "health",
          false,
          "error",
          `GET http://127.0.0.1:${port}/health → ${health.summary}`,
          "BACKEND_UNAVAILABLE"
        )
      );
    } else {
      healthState = "ok";
      checks.push(
        check("health", true, "ok", `GET http://127.0.0.1:${port}/health → ${health.summary}`)
      );
      if (args.expectVersion && health.version && health.version !== args.expectVersion) {
        checks.push(
          check(
            "health:version",
            false,
            "error",
            `health version=${health.version} expected=${args.expectVersion}`,
            "VERSION_MISMATCH"
          )
        );
      }
    }
  } else {
    checks.push(check("health", true, "ok", "skipped (--skip-health)"));
  }

  if (!args.skipUi) {
    if (healthState === "unreachable") {
      uiState = "fail";
      checks.push(
        check(
          "ui:root",
          false,
          "error",
          "skipped UI probe — backend unreachable",
          "FRONTEND_UNAVAILABLE"
        )
      );
    } else {
      const ui = await probeUi(port);
      uiState = ui.ok ? "ok" : "fail";
      checks.push(
        check(
          "ui:root",
          ui.ok,
          ui.ok ? "ok" : "error",
          `GET http://127.0.0.1:${port}/ → ${ui.summary}`,
          ui.ok ? null : "FRONTEND_UNAVAILABLE"
        )
      );
    }
  } else {
    checks.push(check("ui:root", true, "ok", "skipped (--skip-ui)"));
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
        check("service", true, "warn", `service-control unavailable: ${err.message || err}`)
      );
    }
  } else {
    checks.push(check("service", true, "ok", "skipped (--skip-service)"));
  }

  const errors = checks.filter((c) => c.level === "error");
  const warns = checks.filter((c) => c.level === "warn");
  const exitCode = resolveExitCode(checks, healthState, uiState);
  const ok = exitCode === EXIT.PASS;

  const lines = [
    `[verify-install] FT-DEP-001 Batch 11 / Milestone 2 — read-only`,
    `[verify-install] home=${home} port=${port}`,
    ...checks.map((c) => `[verify-install] ${c.level.toUpperCase()} ${c.id}: ${c.detail}`),
    `[verify-install] result=${ok ? "PASS" : "FAIL"} exitCode=${exitCode} errors=${errors.length} warns=${warns.length}`,
    `[verify-install] exitCodes: 0=PASS 1=MISSING_FILES 2=BACKEND_UNAVAILABLE 3=FRONTEND_UNAVAILABLE 4=VERSION_MISMATCH 5=OTHER`,
  ];

  const logPath = appendLog(home, lines);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok,
          home,
          port,
          exitCode,
          healthState,
          uiState,
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
  process.exit(EXIT.OTHER);
});
