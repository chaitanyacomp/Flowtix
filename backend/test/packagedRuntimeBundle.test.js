/**
 * Packaged-runtime regression (FT-DEP-001 Batch 3):
 * Build production esbuild bundle and prove:
 * 1) Tally preview does not require.resolve("./mapLedgerToParty") at runtime
 * 2) Decimal construction works via generated client-v2 (Control Tower path)
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const BUNDLE_SCRIPT = path.join(ROOT, "deployment", "bundle-backend.js");

describe("packagedRuntimeBundle (esbuild production)", () => {
  /** @type {string} */
  let appDir;
  /** @type {string} */
  let serverJs;

  before(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowtix-packaged-runtime-"));
    const r = spawnSync(process.execPath, [BUNDLE_SCRIPT, "--out", appDir], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    });
    if (r.status !== 0) {
      throw new Error(
        `bundle-backend failed (exit ${r.status}):\n${r.stdout || ""}\n${r.stderr || ""}`,
      );
    }
    serverJs = path.join(appDir, "server.js");
    assert.ok(fs.existsSync(serverJs), "server.js missing after bundle");
  });

  after(() => {
    if (appDir && fs.existsSync(appDir)) {
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });

  it("bundle does not contain source-relative require.resolve for Tally modules", () => {
    const code = fs.readFileSync(serverJs, "utf8");
    const forbidden = [
      'require.resolve("./mapLedgerToParty")',
      "require.resolve('./mapLedgerToParty')",
      'require.resolve("./parseTallyMastersXml")',
      "require.resolve('./parseTallyMastersXml')",
      'require.resolve("./tallyXmlListHelpers")',
      "require.resolve('./tallyXmlListHelpers')",
      'require.resolve("../gstinNormalize")',
      "require.resolve('../gstinNormalize')",
    ];
    for (const needle of forbidden) {
      assert.ok(!code.includes(needle), `bundled server.js must not contain ${needle}`);
    }
    // Static diagnostic ids remain for runtime.pipelineId / mapperModule reporting
    assert.match(code, /tallyMasterImport\/mapLedgerToParty/);
  });

  it("Decimal-dependent Control Tower path works via generated client-v2", () => {
    const clientDir = path.join(appDir, "prisma", "generated", "client-v2");
    assert.ok(fs.existsSync(clientDir), "client-v2 must be copied into app/");
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { Prisma } = require(clientDir);
    assert.equal(typeof Prisma.Decimal, "function", "Prisma.Decimal must be a constructor in packaged client");
    const d = new Prisma.Decimal("0.0001");
    assert.equal(d.toString(), "0.0001");
    // Same filter shape used by getAccountsDashboard / panel-metrics
    assert.ok(d.gt(0));
  });

  it("accountsDashboardService source no longer depends on bare @prisma/client", () => {
    const src = fs.readFileSync(
      path.join(BACKEND, "src", "services", "accountsDashboardService.js"),
      "utf8",
    );
    assert.doesNotMatch(src, /require\(["']@prisma\/client["']\)/);
    assert.match(src, /prismaClientPackage/);
  });
});
