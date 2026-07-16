/**
 * Milestone 3 — installation hardening unit tests (deployment helpers).
 * Does not touch production databases.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const deployRoot = path.resolve(__dirname, "../../../deployment");
const {
  redactSecrets,
  maskValue,
  parseDatabaseUrl,
  buildDatabaseUrl,
  DEV_DB_NAMES,
} = require(path.join(deployRoot, "install-common.js"));
const { validateConfig } = require(path.join(deployRoot, "configure-env.js"));
const recovery = require(path.join(deployRoot, "install-recovery.js"));
const { buildServiceXml } = require(path.join(deployRoot, "service-control.js"));

describe("install-common redaction", () => {
  it("masks DATABASE_URL passwords", () => {
    const raw = "DATABASE_URL=mysql://u:secretpass@127.0.0.1:3306/flowtix_erp";
    const out = redactSecrets(raw);
    assert.ok(!out.includes("secretpass"));
    assert.ok(out.includes("***"));
  });

  it("masks JWT_SECRET lines", () => {
    assert.ok(!redactSecrets("JWT_SECRET=super-secret-value").includes("super-secret"));
  });

  it("maskValue hides middle of secrets", () => {
    const m = maskValue("abcdefghij");
    assert.ok(m.includes("****"));
    assert.notEqual(m, "abcdefghij");
  });
});

describe("parseDatabaseUrl", () => {
  it("parses mysql URL", () => {
    const p = parseDatabaseUrl("mysql://erp:p%40ss@db.local:3307/flowtix_erp");
    assert.equal(p.ok, true);
    assert.equal(p.host, "db.local");
    assert.equal(p.port, 3307);
    assert.equal(p.database, "flowtix_erp");
    assert.equal(p.user, "erp");
    assert.equal(p.password, "p@ss");
  });

  it("rejects non-mysql schemes", () => {
    const p = parseDatabaseUrl("postgres://x");
    assert.equal(p.ok, false);
  });

  it("round-trips via buildDatabaseUrl", () => {
    const url = buildDatabaseUrl({
      user: "u",
      password: "p:ss",
      host: "127.0.0.1",
      port: 3306,
      database: "flowtix_erp",
    });
    const p = parseDatabaseUrl(url);
    assert.equal(p.ok, true);
    assert.equal(p.password, "p:ss");
    assert.equal(p.database, "flowtix_erp");
  });

  it("lists known development database names", () => {
    assert.ok(DEV_DB_NAMES.has("mini_erp"));
  });
});

describe("configure-env validateConfig", () => {
  it("requires port, db fields, and jwt", () => {
    const issues = validateConfig({
      hostname: "srv",
      ipv4: "10.0.0.1",
      port: 0,
      dbHost: "",
      dbPort: 3306,
      dbName: "flowtix_erp",
      dbUser: "u",
      dbPassword: "x",
      jwtSecret: "short",
      ftErpHome: "C:\\FT-ERP",
      backupDir: "C:\\FT-ERP\\backups\\db",
      logDir: "C:\\FT-ERP\\logs",
    });
    assert.ok(issues.length > 0);
  });

  it("accepts a complete production-shaped config", () => {
    const issues = validateConfig({
      hostname: "srv",
      ipv4: "10.0.0.1",
      port: 4000,
      dbHost: "127.0.0.1",
      dbPort: 3306,
      dbName: "flowtix_erp",
      dbUser: "erp_user",
      dbPassword: "strong-pass",
      jwtSecret: "sixteen-chars-min",
      ftErpHome: "C:\\FT-ERP",
      backupDir: "C:\\FT-ERP\\backups\\db",
      logDir: "C:\\FT-ERP\\logs",
    });
    assert.deepEqual(issues, []);
  });
});

describe("install-recovery", () => {
  it("restores snapshotted app files and never requires DB", () => {
    const lab = fs.mkdtempSync(path.join(os.tmpdir(), "ft-m3-rec-"));
    try {
      fs.mkdirSync(path.join(lab, "app"), { recursive: true });
      fs.writeFileSync(path.join(lab, "app", "server.js"), "ORIGINAL\n");
      const tx = recovery.beginTransaction(lab, { source: "unit" });
      assert.equal(tx.status, "in_progress");
      fs.writeFileSync(path.join(lab, "app", "server.js"), "BROKEN\n");
      const aborted = recovery.abortTransaction(lab, "unit test");
      assert.equal(aborted.ok, true);
      assert.ok(fs.readFileSync(path.join(lab, "app", "server.js"), "utf8").includes("ORIGINAL"));
    } finally {
      fs.rmSync(lab, { recursive: true, force: true });
    }
  });
});

describe("service-control WinSW XML hardening", () => {
  it("includes restart policy, timeouts, and log rotation", () => {
    const lab = fs.mkdtempSync(path.join(os.tmpdir(), "ft-m3-svc-"));
    try {
      fs.mkdirSync(path.join(lab, "app"), { recursive: true });
      fs.writeFileSync(path.join(lab, "app", "server.js"), "/* test */\n");
      const xml = buildServiceXml(lab);
      assert.match(xml, /starttimeout/i);
      assert.match(xml, /stoptimeout/i);
      assert.match(xml, /onfailure/i);
      assert.match(xml, /delayedAutoStart/i);
      assert.match(xml, /roll-by-size/i);
      assert.ok(!/password/i.test(xml) || !/secret/i.test(xml));
    } finally {
      fs.rmSync(lab, { recursive: true, force: true });
    }
  });
});
