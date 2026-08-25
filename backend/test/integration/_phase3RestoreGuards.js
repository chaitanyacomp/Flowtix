/**
 * Hard guards for Phase 3 restore integration — disposable MySQL DBs only.
 * Never target `erp` or the normal development/customer DATABASE_URL database.
 */
const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, "../../.env") });
require("dotenv").config({ path: path.join(__dirname, "../../.env.integration") });

const { parseDatabaseUrl } = require("../../src/utils/databaseUrl");

/** Databases that must never be restore/drop targets for this harness. */
const FORBIDDEN_DATABASE_NAMES = new Set([
  "erp",
  "mysql",
  "information_schema",
  "performance_schema",
  "sys",
]);

const DISPOSABLE_PREFIX = "ft_p3_restore_";

/**
 * @param {string} name
 */
function assertDisposableDatabaseName(name) {
  const db = String(name || "").trim();
  if (!db) {
    throw new Error("Phase 3 restore integration: empty database name.");
  }
  if (FORBIDDEN_DATABASE_NAMES.has(db.toLowerCase())) {
    throw new Error(
      `Phase 3 restore integration ABORT: database name "${db}" is forbidden (never use erp / system DBs).`,
    );
  }
  if (!db.startsWith(DISPOSABLE_PREFIX)) {
    throw new Error(
      `Phase 3 restore integration ABORT: database "${db}" must start with "${DISPOSABLE_PREFIX}".`,
    );
  }
  if (!/^[a-zA-Z0-9_]+$/.test(db)) {
    throw new Error(`Phase 3 restore integration ABORT: unsafe database name "${db}".`);
  }
}

/**
 * Abort if a URL points at the normal development/customer DB or any forbidden name.
 * @param {string} label
 * @param {string | undefined} rawUrl
 * @param {{ allowMissing?: boolean; mustBeDisposable?: boolean }} [opts]
 */
function assertSafeDatabaseUrl(label, rawUrl, opts = {}) {
  if (!rawUrl || !String(rawUrl).trim()) {
    if (opts.allowMissing) return null;
    throw new Error(`Phase 3 restore integration ABORT: ${label} is not set.`);
  }
  const parsed = parseDatabaseUrl(rawUrl);
  const db = parsed.database;
  if (FORBIDDEN_DATABASE_NAMES.has(db.toLowerCase())) {
    throw new Error(
      `Phase 3 restore integration ABORT: ${label} points at forbidden database "${db}".`,
    );
  }
  if (opts.mustBeDisposable) {
    assertDisposableDatabaseName(db);
  }
  return parsed;
}

/**
 * Build mysql URL with a replacement database name (credentials from base URL).
 * @param {string} baseUrl
 * @param {string} databaseName
 */
function rewriteDatabaseUrl(baseUrl, databaseName) {
  assertDisposableDatabaseName(databaseName);
  const p = parseDatabaseUrl(baseUrl);
  const user = encodeURIComponent(p.user);
  const pass = encodeURIComponent(p.password);
  return `mysql://${user}:${pass}@${p.host}:${p.port}/${databaseName}`;
}

/**
 * Fresh disposable name for this run.
 */
function makeDisposableDatabaseName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  const name = `${DISPOSABLE_PREFIX}${stamp}_${rand}`;
  assertDisposableDatabaseName(name);
  return name;
}

/**
 * Resolve credential base URL without ever using erp as the operational target.
 * Prefers TEST_DATABASE_URL / INTEGRATION_DATABASE_URL for host/user/pass only.
 */
function resolveCredentialBaseUrl() {
  const testUrl = process.env.TEST_DATABASE_URL || process.env.INTEGRATION_DATABASE_URL;
  const mainUrl = process.env.DATABASE_URL;

  if (mainUrl) {
    const main = parseDatabaseUrl(mainUrl);
    if (main.database.toLowerCase() === "erp") {
      // Expected for local .env — we must never operate on it.
      // eslint-disable-next-line no-console
      console.log(
        "[phase3-restore-integration] Noted: development DATABASE_URL points at erp — will not use it as target.",
      );
    } else if (FORBIDDEN_DATABASE_NAMES.has(main.database.toLowerCase())) {
      throw new Error(
        `Phase 3 restore integration ABORT: DATABASE_URL points at forbidden database "${main.database}".`,
      );
    }
  }

  if (!testUrl || !String(testUrl).trim()) {
    throw new Error(
      "Phase 3 restore integration ABORT: set TEST_DATABASE_URL (server credentials). Disposable DBs will be created; do not point at erp.",
    );
  }
  if (mainUrl && testUrl.trim() === mainUrl.trim()) {
    throw new Error(
      "Phase 3 restore integration ABORT: TEST_DATABASE_URL must not equal DATABASE_URL.",
    );
  }

  const testParsed = parseDatabaseUrl(testUrl);
  if (testParsed.database.toLowerCase() === "erp") {
    throw new Error(
      "Phase 3 restore integration ABORT: TEST_DATABASE_URL must not point at erp (use any other DB on the instance for credentials only).",
    );
  }
  if (FORBIDDEN_DATABASE_NAMES.has(testParsed.database.toLowerCase())) {
    throw new Error(
      `Phase 3 restore integration ABORT: TEST_DATABASE_URL points at forbidden database "${testParsed.database}".`,
    );
  }

  return testUrl.trim();
}

module.exports = {
  FORBIDDEN_DATABASE_NAMES,
  DISPOSABLE_PREFIX,
  assertDisposableDatabaseName,
  assertSafeDatabaseUrl,
  rewriteDatabaseUrl,
  makeDisposableDatabaseName,
  resolveCredentialBaseUrl,
  parseDatabaseUrl,
};
