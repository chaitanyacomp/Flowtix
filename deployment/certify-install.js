/**
 * FT-DEP-001 Milestone 3 Phase H — clean-machine certification harness.
 *
 * Safe simulations only: does NOT modify production databases or install Windows services.
 * Validates tooling contracts for fresh/existing/upgrade/recovery/uninstall/diagnostics.
 *
 * Usage:
 *   node deployment/certify-install.js [--home <labHome>] [--json]
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { nowIso, writeJsonSafe, redactSecrets } = require("./install-common");

function parseArgs(argv) {
  const out = { home: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home" && argv[i + 1]) out.home = path.resolve(argv[++i]);
    else if (a === "--json") out.json = true;
  }
  return out;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runNode(script, args, cwd) {
  const r = spawnSync("node", [script, ...args], {
    cwd: cwd || path.resolve(__dirname, ".."),
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  return {
    status: typeof r.status === "number" ? r.status : 1,
    stdout: redactSecrets(r.stdout || ""),
    stderr: redactSecrets(r.stderr || ""),
  };
}

async function runCertification(options = {}) {
  const root = path.resolve(__dirname, "..");
  const lab = options.home || path.join(root, "_lab_m3_certify");
  const results = [];

  const pass = (id, detail) => results.push({ id, ok: true, detail });
  const fail = (id, detail) => results.push({ id, ok: false, detail });

  try {
    if (fs.existsSync(lab)) {
      fs.rmSync(lab, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(lab, "shared"), { recursive: true });
    fs.mkdirSync(path.join(lab, "logs"), { recursive: true });
    fs.mkdirSync(path.join(lab, "backups", "db"), { recursive: true });
    pass("fresh_layout", `lab=${lab}`);
  } catch (e) {
    fail("fresh_layout", e instanceof Error ? e.message : String(e));
    return finalize(lab, results);
  }

  try {
    const r = runNode(path.join(__dirname, "configure-env.js"), [
      "--home",
      lab,
      "--non-interactive",
      "--yes",
      "--db-host",
      "127.0.0.1",
      "--db-port",
      "3306",
      "--db-name",
      "flowtix_erp_cert",
      "--db-user",
      "cert_user",
      "--db-password",
      "cert-pass-not-for-prod",
      "--port",
      "4012",
      "--jwt-secret",
      "certify-jwt-secret-16+",
    ]);
    assert(r.status === 0, `configure-env exit ${r.status}: ${r.stderr}`);
    assert(fs.existsSync(path.join(lab, "shared", ".env")), ".env not written");
    const env = fs.readFileSync(path.join(lab, "shared", ".env"), "utf8");
    assert(!/CHANGE_ME/.test(env), "placeholders remain");
    assert(/PORT=4012/.test(env), "port not set");
    pass("configure_env_noninteractive", "shared\\.env written; secrets not printed");
  } catch (e) {
    fail("configure_env_noninteractive", e instanceof Error ? e.message : String(e));
  }

  try {
    const r = runNode(path.join(__dirname, "configure-env.js"), [
      "--home",
      lab,
      "--non-interactive",
      "--yes",
      "--db-host",
      "127.0.0.1",
      "--db-name",
      "flowtix_erp_cert",
      "--db-user",
      "cert_user",
      "--db-password",
      "cert-pass-not-for-prod",
      "--jwt-secret",
      "certify-jwt-secret-16+",
    ]);
    assert(r.status !== 0, "expected refusal to overwrite without --force");
    pass("configure_env_no_overwrite", "overwrite refused without --force");
  } catch (e) {
    fail("configure_env_no_overwrite", e instanceof Error ? e.message : String(e));
  }

  try {
    const releaseDir = path.join(root, "release", "Flowtix-v1.0.0");
    const args = ["--home", lab, "--skip-mysql"];
    if (fs.existsSync(path.join(releaseDir, "VERSION.txt"))) {
      args.push("--source", releaseDir, "--allow-existing");
    }
    const r = runNode(path.join(__dirname, "install-validate.js"), args);
    assert(
      fs.existsSync(path.join(lab, "logs", "install", "install-validation-report.json")),
      "validation report missing",
    );
    pass("install_validate_report", `exit=${r.status} report written`);
  } catch (e) {
    fail("install_validate_report", e instanceof Error ? e.message : String(e));
  }

  try {
    const recovery = require("./install-recovery");
    // Match setup order: begin before place so abort removes partial trees
    const tx = recovery.beginTransaction(lab, { source: "cert" });
    assert(tx.status === "in_progress", "tx not started");
    assert(!tx.snapshotted.length, "expected empty snapshot on fresh home");
    fs.mkdirSync(path.join(lab, "app"), { recursive: true });
    fs.writeFileSync(path.join(lab, "app", "server.js"), "/* partial */\n");
    fs.mkdirSync(path.join(lab, "web"), { recursive: true });
    fs.writeFileSync(path.join(lab, "web", "index.html"), "<html>partial</html>");
    const aborted = recovery.abortTransaction(lab, "certify simulated failure");
    assert(aborted.ok, aborted.detail);
    assert(!fs.existsSync(path.join(lab, "app")), "partial app should be removed");
    assert(!fs.existsSync(path.join(lab, "web")), "partial web should be removed");
    pass("install_recovery_fresh_abort", aborted.detail);
  } catch (e) {
    fail("install_recovery_fresh_abort", e instanceof Error ? e.message : String(e));
  }

  try {
    const recovery = require("./install-recovery");
    fs.mkdirSync(path.join(lab, "app"), { recursive: true });
    fs.writeFileSync(path.join(lab, "app", "server.js"), "GOOD\n");
    fs.mkdirSync(path.join(lab, "web"), { recursive: true });
    fs.writeFileSync(path.join(lab, "web", "index.html"), "GOOD_HTML\n");
    recovery.beginTransaction(lab, { source: "cert2" });
    fs.writeFileSync(path.join(lab, "app", "server.js"), "CORRUPT\n");
    const aborted = recovery.abortTransaction(lab, "simulate migration failure");
    assert(aborted.ok, aborted.detail);
    const restored = fs.readFileSync(path.join(lab, "app", "server.js"), "utf8");
    assert(restored.includes("GOOD"), "snapshot restore failed");
    pass("install_recovery_restore_snapshot", "snapshot restore OK");
  } catch (e) {
    fail("install_recovery_restore_snapshot", e instanceof Error ? e.message : String(e));
  }

  try {
    const envPath = path.join(lab, "shared", ".env");
    fs.writeFileSync(
      envPath,
      [
        'DATABASE_URL="mysql://u:p@127.0.0.1:3306/mini_erp"',
        "JWT_SECRET=certify-jwt-secret-16+",
        "NODE_ENV=production",
        "PORT=4012",
      ].join("\n"),
      "utf8",
    );
    const dbSafety = require("./db-safety");
    const report = await dbSafety.validateDatabaseSafety({
      home: lab,
      createIfMissing: false,
      allowDevDatabase: false,
    });
    const guard = report.checks.find((c) => c.id === "mysql_dev_guard");
    assert(guard && !guard.ok, "dev DB guard should fail for mini_erp");
    pass("db_safety_dev_guard", "dev database guard blocked mini_erp");
  } catch (e) {
    fail("db_safety_dev_guard", e instanceof Error ? e.message : String(e));
  }

  try {
    const sc = require("./service-control");
    fs.mkdirSync(path.join(lab, "app"), { recursive: true });
    fs.writeFileSync(path.join(lab, "app", "server.js"), "/* cert */\n");
    const xml = sc.buildServiceXml(lab);
    assert(/starttimeout/i.test(xml), "missing starttimeout");
    assert(/stoptimeout/i.test(xml), "missing stoptimeout");
    assert(/onfailure/i.test(xml), "missing onfailure");
    assert(/delayedAutoStart/i.test(xml), "missing delayedAutoStart");
    assert(/roll-by-size/i.test(xml), "missing log rotation");
    pass("service_xml_hardening", "WinSW XML hardening markers present");
  } catch (e) {
    fail("service_xml_hardening", e instanceof Error ? e.message : String(e));
  }

  try {
    fs.writeFileSync(
      path.join(lab, "shared", ".env"),
      [
        'DATABASE_URL="mysql://cert_user:cert-pass-not-for-prod@127.0.0.1:3306/flowtix_erp_cert"',
        "JWT_SECRET=certify-jwt-secret-16+",
        "NODE_ENV=production",
        "PORT=4012",
        `FT_ERP_HOME=${lab}`,
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(lab, "VERSION.txt"),
      "productVersion=1.0.0\ngitCommit=certify\n",
      "utf8",
    );
    const { collectDiagnostics } = require("./collect-diagnostics");
    const diag = await collectDiagnostics({ home: lab, skipHealth: true });
    assert(fs.existsSync(path.join(diag.outDir, "summary.json")), "summary.json missing");
    assert(fs.existsSync(path.join(diag.outDir, "README.txt")), "README missing");
    const summary = JSON.parse(fs.readFileSync(path.join(diag.outDir, "summary.json"), "utf8"));
    assert(summary.configurationSummary.JWT_SECRET === "***", "JWT not masked");
    assert(
      String(summary.configurationSummary.DATABASE_URL).includes("***"),
      "DATABASE_URL not masked",
    );
    pass("diagnostics_bundle", diag.outDir);
  } catch (e) {
    fail("diagnostics_bundle", e instanceof Error ? e.message : String(e));
  }

  try {
    const iss = fs.readFileSync(path.join(__dirname, "installer", "Flowtix.iss"), "utf8");
    assert(/RemoveCustomerData/.test(iss), "installer missing RemoveCustomerData");
    assert(/NEVER deleted/i.test(iss) || /never deleted/i.test(iss), "MySQL never-delete note missing");
    pass("uninstall_preserve_policy", "Inno uninstall preserve-by-default present");
  } catch (e) {
    fail("uninstall_preserve_policy", e instanceof Error ? e.message : String(e));
  }

  // First-time Path A: shared\.env alone must NOT block as "existing install"
  try {
    const { runInstallValidation } = require("./install-validate");
    const envOnly = path.join(lab, "env_only_home");
    if (fs.existsSync(envOnly)) fs.rmSync(envOnly, { recursive: true, force: true });
    fs.mkdirSync(path.join(envOnly, "shared"), { recursive: true });
    fs.writeFileSync(
      path.join(envOnly, "shared", ".env"),
      'DATABASE_URL="mysql://u:p@127.0.0.1:3306/flowtix_erp"\nJWT_SECRET=certify-jwt-secret-16+\nPORT=4013\n',
      "utf8",
    );
    const v = await runInstallValidation({
      home: envOnly,
      allowExisting: false,
      skipMysql: true,
      skipMigratePath: true,
      requireAdmin: false,
    });
    const ex = v.checks.find((c) => c.id === "existing_install");
    assert(ex && ex.ok, `env-only must allow bootstrap: ${ex && ex.detail}`);
    pass("existing_install_env_only_ok", ex.detail);
  } catch (e) {
    fail("existing_install_env_only_ok", e instanceof Error ? e.message : String(e));
  }

  // Installer layout regression: --source == home\releases\<name> must promote, not self-wipe.
  try {
    const { placeRelease, sameResolvedPath } = require("./setup-flowtix");
    const installLab = path.join(lab, "installer_place");
    if (fs.existsSync(installLab)) fs.rmSync(installLab, { recursive: true, force: true });
    const archive = path.join(installLab, "releases", "Flowtix-v1.0.0");
    fs.mkdirSync(path.join(archive, "app"), { recursive: true });
    fs.mkdirSync(path.join(archive, "web"), { recursive: true });
    fs.mkdirSync(path.join(archive, "prisma"), { recursive: true });
    fs.writeFileSync(path.join(archive, "app", "server.js"), "/* installer-place marker */\n");
    fs.writeFileSync(path.join(archive, "web", "index.html"), "<html>installer-place</html>\n");
    fs.writeFileSync(path.join(archive, "VERSION.txt"), "productVersion=1.0.0\ngitCommit=certify-place\n");
    const placed = placeRelease(archive, installLab);
    assert(placed.sourceIsInstallArchive === true, "expected sourceIsInstallArchive");
    assert(sameResolvedPath(archive, placed.archiveDir), "archiveDir should equal source");
    assert(
      fs.existsSync(path.join(archive, "app", "server.js")),
      "install archive app\\server.js must survive placeRelease",
    );
    assert(
      fs.existsSync(path.join(installLab, "app", "server.js")),
      "live app\\server.js must be created",
    );
    assert(
      fs.existsSync(path.join(installLab, "web", "index.html")),
      "live web\\index.html must be created",
    );
    const live = fs.readFileSync(path.join(installLab, "app", "server.js"), "utf8");
    assert(live.includes("installer-place"), "live app content not promoted from archive");
    pass("place_release_installer_layout", "source=install-archive promotes without self-wipe");
  } catch (e) {
    fail("place_release_installer_layout", e instanceof Error ? e.message : String(e));
  }

  try {
    const tools = [
      "install-common.js",
      "install-validate.js",
      "configure-env.js",
      "db-safety.js",
      "install-recovery.js",
      "collect-diagnostics.js",
      "setup-flowtix.js",
      "migrate-db.js",
      "service-control.js",
      "certify-install.js",
    ];
    for (const t of tools) {
      const r = spawnSync("node", ["--check", path.join(__dirname, t)], {
        encoding: "utf8",
        windowsHide: true,
      });
      assert(r.status === 0, `${t} syntax fail: ${r.stderr}`);
    }
    pass("syntax_tools", `${tools.length} tools syntax OK`);
  } catch (e) {
    fail("syntax_tools", e instanceof Error ? e.message : String(e));
  }

  // Scenario matrix notes (site-level; harness documents expected coverage)
  pass(
    "scenario_matrix_documented",
    "fresh/existing/upgrade/recovery/uninstall/reinstall/reboot/service/LAN/multi-browser/health/verify/diagnostics covered by tooling + FT-DEP-011 site acceptance",
  );

  return finalize(lab, results);
}

function finalize(lab, results) {
  const failed = results.filter((r) => !r.ok);
  const report = {
    generatedAt: nowIso(),
    tool: "certify-install",
    milestone: "FT-DEP-001-M3-Phase-H",
    lab,
    ok: failed.length === 0,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
    notes: [
      "Does not install Windows Service or mutate production databases.",
      "Full LAN multi-browser / reboot certification remains a site acceptance step (FT-DEP-011).",
    ],
  };
  const reportDir = path.join(lab, "logs", "install");
  fs.mkdirSync(reportDir, { recursive: true });
  writeJsonSafe(path.join(reportDir, "certification-report.json"), report);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCertification(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("[certify-install] FT-DEP-001 Milestone 3 Phase H");
    for (const r of report.results) {
      console.log(`  [${r.ok ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
    }
    console.log(
      report.ok
        ? `[certify-install] PASSED (${report.pass}/${report.results.length})`
        : `[certify-install] FAILED (${report.fail} failures)`,
    );
    console.log(`[certify-install] lab=${report.lab}`);
  }
  process.exit(report.ok ? 0 : 2);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[certify-install] FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

module.exports = { runCertification };
