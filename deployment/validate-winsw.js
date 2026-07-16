/**
 * FT-DEP-001 Milestone 2 — WinSW offline packaging contract.
 *
 * Validates deployment/vendor/winsw/WinSW-x64.exe against winsw-manifest.json.
 * Exit codes:
 *   0 — binary present and checksum matches
 *   2 — binary missing (release blocker for offline service install)
 *   3 — checksum mismatch or manifest incomplete
 *   4 — other error
 *
 * Usage:
 *   node deployment/validate-winsw.js [--json] [--require]
 *   --require  fail (exit 2) when binary missing (default for create-release)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VENDOR_DIR = path.join(__dirname, "vendor", "winsw");
const MANIFEST_PATH = path.join(VENDOR_DIR, "winsw-manifest.json");
const BINARY_PATH = path.join(VENDOR_DIR, "WinSW-x64.exe");

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    require: argv.includes("--require") || !argv.includes("--allow-missing"),
  };
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { ok: false, error: `manifest missing: ${MANIFEST_PATH}` };
  }
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return { ok: true, manifest: m };
  } catch (e) {
    return { ok: false, error: `manifest parse error: ${e.message || e}` };
  }
}

function validate({ requireBinary = true } = {}) {
  const loaded = loadManifest();
  if (!loaded.ok) {
    return { ok: false, exitCode: 4, ...loaded };
  }
  const m = loaded.manifest;
  const expected = m.sha256 ? String(m.sha256).trim().toLowerCase() : null;

  if (!expected || expected === "null") {
    return {
      ok: false,
      exitCode: 3,
      blocker: true,
      detail:
        "winsw-manifest.json sha256 is unset. Acquire WinSW-x64.exe, compute SHA-256, update manifest (see replacementProcedure).",
      version: m.version || null,
      binaryPath: BINARY_PATH,
      binaryPresent: fs.existsSync(BINARY_PATH),
    };
  }

  if (!fs.existsSync(BINARY_PATH)) {
    return {
      ok: false,
      exitCode: requireBinary ? 2 : 0,
      blocker: requireBinary,
      detail: requireBinary
        ? `WinSW binary missing (offline release blocker): ${BINARY_PATH}`
        : `WinSW binary missing (allowed by --allow-missing): ${BINARY_PATH}`,
      version: m.version,
      expectedSha256: expected,
      binaryPath: BINARY_PATH,
      binaryPresent: false,
      downloadUrl: m.downloadUrl,
    };
  }

  const actual = sha256File(BINARY_PATH);
  if (actual !== expected) {
    return {
      ok: false,
      exitCode: 3,
      blocker: true,
      detail: `WinSW checksum mismatch. expected=${expected} actual=${actual}`,
      version: m.version,
      expectedSha256: expected,
      actualSha256: actual,
      binaryPath: BINARY_PATH,
      binaryPresent: true,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    blocker: false,
    detail: `WinSW ${m.version} OK sha256=${actual}`,
    version: m.version,
    expectedSha256: expected,
    actualSha256: actual,
    binaryPath: BINARY_PATH,
    binaryPresent: true,
    downloadUrl: m.downloadUrl,
    source: m.source,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = validate({ requireBinary: args.require });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const tag = result.ok ? "OK" : "FAIL";
    console.log(`[validate-winsw] ${tag}: ${result.detail || result.error}`);
    if (result.version) console.log(`[validate-winsw] version=${result.version}`);
    if (result.downloadUrl) console.log(`[validate-winsw] source=${result.downloadUrl}`);
    if (result.blocker) {
      console.log("[validate-winsw] RELEASE BLOCKER: offline WinSW packaging incomplete.");
    }
  }
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  validate,
  sha256File,
  BINARY_PATH,
  MANIFEST_PATH,
  VENDOR_DIR,
};
