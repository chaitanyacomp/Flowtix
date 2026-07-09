/**
 * FT-DEP-001 Batch 2 — config validation unit tests (no DB).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateRuntimeConfig,
  formatConfigErrors,
} = require("../../src/runtime/config");
const { parseVersionTxt, loadReleaseMetadata } = require("../../src/runtime/releaseMeta");
const { ensureRuntimeFolders } = require("../../src/runtime/folders");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("validateRuntimeConfig", () => {
  it("fails when DATABASE_URL missing", () => {
    const r = validateRuntimeConfig({ NODE_ENV: "development" });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.name === "DATABASE_URL"));
  });

  it("requires JWT_SECRET in production", () => {
    const r = validateRuntimeConfig({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db",
    });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.name === "JWT_SECRET"));
  });

  it("rejects short JWT_SECRET in production", () => {
    const r = validateRuntimeConfig({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db",
      JWT_SECRET: "short",
    });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.name === "JWT_SECRET"));
  });

  it("passes production with valid required vars", () => {
    const r = validateRuntimeConfig({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db",
      JWT_SECRET: "long-enough-secret-value",
      PORT: "4000",
    });
    assert.equal(r.ok, true);
  });

  it("formatConfigErrors names the variable", () => {
    const text = formatConfigErrors([
      { name: "DATABASE_URL", message: "Missing required variable DATABASE_URL. MySQL connection string" },
    ]);
    assert.match(text, /DATABASE_URL/);
    assert.match(text, /startup aborted/);
  });
});

describe("release metadata", () => {
  it("parses VERSION.txt", () => {
    const parsed = parseVersionTxt("productVersion=1.0.0\ngitCommit=abc123\n");
    assert.equal(parsed.productVersion, "1.0.0");
    assert.equal(parsed.gitCommit, "abc123");
  });

  it("loadReleaseMetadata falls back to package.json", () => {
    const meta = loadReleaseMetadata(null);
    assert.ok(meta.productVersion);
  });
});

describe("ensureRuntimeFolders", () => {
  it("creates shared uploads temp logs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ft-erp-runtime-"));
    const paths = {
      sharedDir: path.join(root, "shared"),
      uploadsDir: path.join(root, "shared", "uploads"),
      tempDir: path.join(root, "shared", "temp"),
      logsDir: path.join(root, "logs"),
    };
    const r = ensureRuntimeFolders(paths);
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(paths.uploadsDir));
    assert.ok(fs.existsSync(paths.tempDir));
    assert.ok(fs.existsSync(paths.logsDir));
    fs.rmSync(root, { recursive: true, force: true });
  });
});
