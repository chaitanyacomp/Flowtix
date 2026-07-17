/**
 * FT-DEP-001 Milestone 3 Phase A — installation environment validation.
 *
 * Runs BEFORE any install mutation. Structured report; hard errors abort setup.
 * Never prints secrets.
 *
 * Usage:
 *   node deployment/install-validate.js --home <FT_ERP_HOME> [--source <release>] [--port N]
 *        [--json] [--allow-existing] [--skip-mysql] [--skip-migrate-path]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const { spawnSync } = require("child_process");
const { runPrerequisiteChecks, MIN_FREE_MB } = require("./check-prereqs");
const {
  isAdmin,
  parseEnvFile,
  parseDatabaseUrl,
  windowsVersion,
  findMysqlClient,
  checkItem,
  writeJsonSafe,
  nowIso,
  redactSecrets,
  DEV_DB_NAMES,
} = require("./install-common");

function parseArgs(argv) {
  const out = {
    home: null,
    source: null,
    port: null,
    json: false,
    allowExisting: false,
    skipMysql: false,
    skipMigratePath: false,
    reportDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--source" && argv[i + 1]) out.source = path.resolve(argv[++i]);
    else if (a === "--port" && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--allow-existing") out.allowExisting = true;
    else if (a === "--skip-mysql") out.skipMysql = true;
    else if (a === "--skip-migrate-path") out.skipMigratePath = true;
    else if (a === "--report-dir" && argv[i + 1]) out.reportDir = path.resolve(argv[++i]);
  }
  if (process.env.FT_ERP_HOME && !out.home) {
    out.home = path.resolve(String(process.env.FT_ERP_HOME).trim());
  }
  return out;
}

function checkAdmin(requireAdmin) {
  const ok = isAdmin();
  if (ok) {
    return checkItem("administrator", true, "ok", "Running with Administrator privileges");
  }
  // Service/firewall install needs elevation; Path B / file-only bootstrap may run without it.
  if (requireAdmin) {
    return checkItem(
      "administrator",
      false,
      "error",
      "Administrator privileges required for service/firewall install",
      "Re-run this command from an elevated (Administrator) Command Prompt or PowerShell",
    );
  }
  return checkItem(
    "administrator",
    true,
    "warn",
    "Not elevated — OK for file-only setup; elevate before --install-service / --configure-firewall",
    "Re-run elevated if installing Windows Service or firewall rule",
  );
}

function checkNpm() {
  const r = spawnSync("npm", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    timeout: 15000,
  });
  const ver = String(r.stdout || "").trim();
  const ok = !r.error && r.status === 0 && !!ver;
  return checkItem(
    "npm",
    ok,
    ok ? "ok" : "error",
    ok ? `npm ${ver}` : "npm not found on PATH",
    ok ? null : "Install Node.js LTS which includes npm, then reopen the terminal",
  );
}

function checkWinVersion() {
  const w = windowsVersion();
  const detail = w.detail || "unknown";
  // Soft-require Windows 10+ when detectable
  const looksOld = /Windows (7|8|Vista|XP)/i.test(detail);
  return checkItem(
    "windows",
    !looksOld,
    looksOld ? "error" : "ok",
    detail,
    looksOld ? "Upgrade to Windows 10/11 or Windows Server 2016+ for LAN deployment" : null,
  );
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(
        checkItem(
          "port",
          false,
          "error",
          `Port ${port} is already in use`,
          `Stop the process using port ${port}, or set a free PORT in shared\\.env`,
        ),
      );
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(checkItem("port", true, "ok", `Port ${port} is available`));
      });
    });
    server.listen(port, "0.0.0.0");
  });
}

function checkWinswIntegrity(source) {
  try {
    const validate = require("./validate-winsw");
    // Prefer release tools vendor, else deployment vendor
    const candidates = [];
    if (source) {
      candidates.push(path.join(source, "tools", "vendor", "winsw"));
    }
    candidates.push(path.join(__dirname, "vendor", "winsw"));
    let last = null;
    for (const dir of candidates) {
      const bin = path.join(dir, "WinSW-x64.exe");
      const man = path.join(dir, "winsw-manifest.json");
      if (!fs.existsSync(bin) || !fs.existsSync(man)) continue;
      const m = JSON.parse(fs.readFileSync(man, "utf8"));
      const expected = m.sha256 ? String(m.sha256).toLowerCase() : null;
      if (!expected) {
        last = checkItem(
          "winsw",
          false,
          "error",
          "WinSW manifest sha256 unset",
          "Run node deployment/validate-winsw.js and restore vendor binary",
        );
        continue;
      }
      const actual = validate.sha256File(bin);
      if (actual !== expected) {
        last = checkItem(
          "winsw",
          false,
          "error",
          `WinSW checksum mismatch`,
          "Replace WinSW-x64.exe per deployment/vendor/winsw/README.txt",
        );
        continue;
      }
      return checkItem("winsw", true, "ok", `WinSW ${m.version || "?"} checksum OK`);
    }
    return (
      last ||
      checkItem(
        "winsw",
        false,
        "error",
        "WinSW-x64.exe missing (offline service package)",
        "Restore deployment/vendor/winsw/WinSW-x64.exe and rebuild release",
      )
    );
  } catch (e) {
    return checkItem(
      "winsw",
      false,
      "warn",
      `WinSW check skipped: ${e.message || e}`,
      "Ensure validate-winsw.js and vendor binary are present",
    );
  }
}

function checkReleasePackage(source) {
  if (!source) {
    return checkItem(
      "release",
      false,
      "warn",
      "No --source release provided (skipped package file checks)",
      "Pass --source <releaseDir> for full validation",
    );
  }
  const required = [
    "VERSION.txt",
    path.join("app", "server.js"),
    path.join("web", "index.html"),
    path.join("prisma", "schema.prisma"),
  ];
  const missing = required.filter((r) => !fs.existsSync(path.join(source, r)));
  if (missing.length) {
    return checkItem(
      "release",
      false,
      "error",
      `Release incomplete: missing ${missing.join(", ")}`,
      "Rebuild with deployment\\create-release.bat",
    );
  }
  let ver = "?";
  try {
    const text = fs.readFileSync(path.join(source, "VERSION.txt"), "utf8");
    const m = text.match(/productVersion\s*=\s*(.+)/i);
    if (m) ver = m[1].trim();
  } catch {
    // ignore
  }
  return checkItem("release", true, "ok", `Release package OK (productVersion=${ver})`);
}

function checkExistingInstall(home, allowExisting) {
  if (!home || !fs.existsSync(home)) {
    return checkItem("existing_install", true, "ok", "No existing FT_ERP_HOME tree (fresh install)");
  }
  const hasApp = fs.existsSync(path.join(home, "app", "server.js"));
  const hasWeb = fs.existsSync(path.join(home, "web", "index.html"));
  const hasEnv = fs.existsSync(path.join(home, "shared", ".env"));
  // Align with post-install.bat: complete install = env + live app + live web.
  // shared\.env alone is normal for first-time Path A (configure-env before setup).
  if (hasApp && hasWeb && hasEnv) {
    if (allowExisting) {
      return checkItem(
        "existing_install",
        true,
        "warn",
        "Existing install detected (env + app + web) — --allow-existing set",
        "Use update-flowtix for upgrades; --force only for intentional re-bootstrap",
      );
    }
    return checkItem(
      "existing_install",
      false,
      "error",
      "Existing Flowtix installation detected",
      "Use tools\\update-flowtix.bat for upgrades, or pass --force / --allow-existing for intentional re-setup",
    );
  }
  if (hasApp || hasWeb) {
    return checkItem(
      "existing_install",
      true,
      "warn",
      "Partial runtime present (app/web incomplete) — setup may repair/promote",
      "If this is an upgrade of a complete install, use update-flowtix instead",
    );
  }
  if (hasEnv) {
    return checkItem(
      "existing_install",
      true,
      "ok",
      "shared\\.env present (first-time bootstrap OK; live app/web not yet placed)",
    );
  }
  return checkItem("existing_install", true, "ok", "Home exists but no prior Flowtix install markers");
}

function checkServiceState() {
  try {
    const sc = require("./service-control");
    const state = sc.queryServiceState();
    if (state === "not_installed") {
      return checkItem("windows_service", true, "ok", "FlowtixERP service not installed");
    }
    return checkItem(
      "windows_service",
      true,
      "warn",
      `FlowtixERP service present (state=${state})`,
      "Stop/uninstall service before destructive re-install if required",
    );
  } catch (e) {
    return checkItem("windows_service", true, "warn", `Service probe skipped: ${e.message || e}`);
  }
}

function checkHomeLayout(home) {
  if (!home) {
    return checkItem("home", false, "error", "FT_ERP_HOME not set", "Pass --home C:\\FT-ERP");
  }
  const items = [];
  items.push(
    checkItem("home_path", true, "ok", `FT_ERP_HOME=${home}`),
  );
  const shared = path.join(home, "shared");
  const envPath = path.join(shared, ".env");
  items.push(
    checkItem(
      "shared_folder",
      true,
      fs.existsSync(shared) ? "ok" : "warn",
      fs.existsSync(shared) ? "shared\\ present" : "shared\\ will be created",
    ),
  );
  items.push(
    checkItem(
      "shared_env",
      true,
      fs.existsSync(envPath) ? "ok" : "warn",
      fs.existsSync(envPath)
        ? "shared\\.env present (contents not printed)"
        : "shared\\.env missing — run configure-env or copy production.env.example",
      fs.existsSync(envPath) ? null : "node deployment/configure-env.js --home <home>",
    ),
  );
  items.push(
    checkItem(
      "backups_folder",
      true,
      fs.existsSync(path.join(home, "backups")) ? "ok" : "warn",
      fs.existsSync(path.join(home, "backups")) ? "backups\\ present" : "backups\\ will be created",
    ),
  );
  items.push(
    checkItem(
      "logs_folder",
      true,
      fs.existsSync(path.join(home, "logs")) ? "ok" : "warn",
      fs.existsSync(path.join(home, "logs")) ? "logs\\ present" : "logs\\ will be created",
    ),
  );
  if (fs.existsSync(path.join(home, "VERSION.txt"))) {
    try {
      const text = fs.readFileSync(path.join(home, "VERSION.txt"), "utf8");
      const m = text.match(/productVersion\s*=\s*(.+)/i);
      items.push(
        checkItem(
          "installed_version",
          true,
          "ok",
          `Installed VERSION.txt productVersion=${m ? m[1].trim() : "?"}`,
        ),
      );
    } catch {
      items.push(checkItem("installed_version", true, "warn", "VERSION.txt unreadable"));
    }
  } else {
    items.push(checkItem("installed_version", true, "ok", "No installed VERSION.txt (fresh)"));
  }
  return items;
}

function checkEnvDatabaseHints(home, skipMigratePath) {
  const envPath = path.join(home || "", "shared", ".env");
  if (!home || !fs.existsSync(envPath)) {
    return [
      checkItem(
        "database_url",
        skipMigratePath,
        skipMigratePath ? "warn" : "error",
        "Cannot validate DATABASE_URL — shared\\.env missing",
        "Create configuration with configure-env.js before Path A migrate",
      ),
    ];
  }
  const env = parseEnvFile(envPath);
  const parsed = parseDatabaseUrl(env.DATABASE_URL || "");
  const items = [];
  if (!parsed.ok) {
    items.push(
      checkItem(
        "database_url",
        false,
        "error",
        parsed.error || "Invalid DATABASE_URL",
        "Fix DATABASE_URL in shared\\.env (mysql://user:***@host:port/db)",
      ),
    );
    return items;
  }
  items.push(
    checkItem(
      "database_url",
      true,
      "ok",
      `DATABASE_URL host=${parsed.host} port=${parsed.port} database=${parsed.database} user=${parsed.user}`,
    ),
  );
  if (DEV_DB_NAMES.has(String(parsed.database).toLowerCase())) {
    items.push(
      checkItem(
        "database_name_policy",
        false,
        "error",
        `Database name "${parsed.database}" looks like a development database`,
        "Use a production database name (e.g. flowtix_erp), not mini_erp / test",
      ),
    );
  } else {
    items.push(
      checkItem("database_name_policy", true, "ok", `Database name "${parsed.database}" accepted`),
    );
  }
  if (/CHANGE_ME/i.test(env.DATABASE_URL || "") || /CHANGE_ME/i.test(env.JWT_SECRET || "")) {
    items.push(
      checkItem(
        "placeholders",
        false,
        "error",
        "shared\\.env still contains CHANGE_ME placeholders",
        "Run configure-env.js and replace placeholders before install",
      ),
    );
  } else {
    items.push(checkItem("placeholders", true, "ok", "No CHANGE_ME placeholders detected"));
  }
  return items;
}

/**
 * Full validation. @returns {{ ok: boolean, checks: object[], report: object }}
 */
async function runInstallValidation(options = {}) {
  const home = options.home ? path.resolve(options.home) : null;
  const source = options.source ? path.resolve(options.source) : null;
  const port =
    options.port ||
    (() => {
      if (home && fs.existsSync(path.join(home, "shared", ".env"))) {
        const env = parseEnvFile(path.join(home, "shared", ".env"));
        const n = Number(env.PORT);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 4000;
    })();

  const base = await runPrerequisiteChecks({ home, port });
  // Remap base port check: we will add a stricter port check
  const checks = [];
  const requireAdmin = options.requireAdmin === true;
  checks.push(checkWinVersion());
  checks.push(checkAdmin(requireAdmin));
  for (const c of base.checks) {
    if (c.id === "port") continue; // replaced below
    if (c.id === "platform") {
      checks.push(
        checkItem(
          "platform",
          c.ok,
          c.level === "error" ? "error" : c.ok ? "ok" : "warn",
          c.detail,
          c.ok ? null : "Deploy on Windows Server / Windows 10+ for LAN product installs",
        ),
      );
      continue;
    }
    if (c.id === "disk" && !c.ok) {
      checks.push(
        checkItem(
          "disk",
          false,
          "error",
          c.detail,
          `Free at least ${MIN_FREE_MB} MB on the install volume`,
        ),
      );
      continue;
    }
    checks.push({
      ...c,
      corrective:
        c.id === "node"
          ? "Install Node.js 18+ LTS and reopen the terminal"
          : c.id === "mysqldump"
            ? "Install MySQL client tools (mysqldump) for Path A backup/migrate"
            : c.id === "writable"
              ? "Choose a writable FT_ERP_HOME or run as Administrator"
              : null,
    });
  }
  checks.push(checkNpm());
  checks.push(await checkPortFree(port));
  checks.push(checkReleasePackage(source));
  checks.push(checkWinswIntegrity(source));
  checks.push(...checkHomeLayout(home));
  checks.push(checkExistingInstall(home, !!options.allowExisting));
  checks.push(checkServiceState());
  checks.push(...checkEnvDatabaseHints(home, !!options.skipMigratePath));

  if (!options.skipMysql && home && fs.existsSync(path.join(home, "shared", ".env"))) {
    try {
      const dbSafety = require("./db-safety");
      const dbReport = await dbSafety.validateDatabaseSafety({
        home,
        createIfMissing: false,
        allowDevDatabase: false,
      });
      for (const c of dbReport.checks) checks.push(c);
    } catch (e) {
      checks.push(
        checkItem(
          "mysql",
          false,
          "warn",
          `MySQL safety probe deferred: ${e.message || e}`,
          "Ensure MySQL is installed and shared\\.env is valid",
        ),
      );
    }
  } else if (!options.skipMysql) {
    const mysql = findMysqlClient();
    checks.push(
      checkItem(
        "mysql_client",
        !!mysql,
        mysql ? "ok" : "warn",
        mysql ? `mysql client: ${mysql}` : "mysql client not found on PATH",
        mysql ? null : "Install MySQL Server / client tools before Path A",
      ),
    );
  }

  // Prisma CLI availability (npx / local)
  const prismaProbe = spawnSync("npx", ["--yes", "prisma@5.22.0", "-v"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
    timeout: 60000,
  });
  const prismaOk = !prismaProbe.error && prismaProbe.status === 0;
  checks.push(
    checkItem(
      "prisma",
      prismaOk,
      prismaOk ? "ok" : "warn",
      prismaOk
        ? `Prisma CLI reachable via npx prisma@5.22.0`
        : "Prisma CLI probe failed (npx may download on first migrate)",
      prismaOk ? null : "Ensure network access for npx prisma@5.22.0 or vendor Prisma locally",
    ),
  );

  const errors = checks.filter((c) => c.level === "error" && !c.ok);
  const warns = checks.filter((c) => c.level === "warn");
  const ok = errors.length === 0;

  const report = {
    generatedAt: nowIso(),
    tool: "install-validate",
    milestone: "FT-DEP-001-M3-Phase-A",
    home,
    source,
    port,
    hostname: os.hostname(),
    ok,
    errorCount: errors.length,
    warnCount: warns.length,
    checks: checks.map((c) => ({
      id: c.id,
      ok: c.ok,
      level: c.level,
      detail: redactSecrets(c.detail),
      corrective: c.corrective,
    })),
  };

  return { ok, checks, report, errors, warns };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.home) {
    console.error("[install-validate] ERROR: --home <FT_ERP_HOME> is required");
    process.exit(1);
  }
  const result = await runInstallValidation({
    home: args.home,
    source: args.source,
    port: args.port,
    allowExisting: args.allowExisting,
    skipMysql: args.skipMysql,
    skipMigratePath: args.skipMigratePath,
  });

  const reportDir = args.reportDir || path.join(args.home, "logs", "install");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "install-validation-report.json");
  writeJsonSafe(reportPath, result.report);

  const textPath = path.join(reportDir, "install-validation-report.txt");
  const lines = [
    `Flowtix ERP — Installation Environment Validation`,
    `Generated: ${result.report.generatedAt}`,
    `Home: ${args.home}`,
    `Result: ${result.ok ? "PASS" : "FAIL"} errors=${result.errors.length} warns=${result.warns.length}`,
    "",
  ];
  for (const c of result.checks) {
    const tag = c.level === "ok" ? "OK  " : c.level === "warn" ? "WARN" : "FAIL";
    lines.push(`[${tag}] ${c.id}: ${redactSecrets(c.detail)}`);
    if (!c.ok && c.corrective) lines.push(`       → ${c.corrective}`);
  }
  fs.writeFileSync(textPath, lines.join("\n") + "\n", "utf8");

  if (args.json) {
    console.log(JSON.stringify({ ...result.report, reportPath, textPath }, null, 2));
  } else {
    for (const line of lines) console.log(line);
    console.log("");
    console.log(`[install-validate] report: ${reportPath}`);
    console.log(`[install-validate] text:   ${textPath}`);
    if (!result.ok) {
      console.log("[install-validate] FAILED — fix errors above before running setup-flowtix.");
    }
  }
  process.exit(result.ok ? 0 : 2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[install-validate] FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

module.exports = { runInstallValidation, parseArgs };
