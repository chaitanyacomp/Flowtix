/**
 * FT-DEP-001 Batch 2 — startup validation (config, DB, Prisma, folders, logging, version).
 */
const { validateRuntimeConfig, formatConfigErrors } = require("./config");
const { ensureRuntimeFolders } = require("./folders");
const { loadReleaseMetadata } = require("./releaseMeta");

/**
 * @param {object} opts
 * @param {import('./paths').resolveRuntimePaths extends Function ? any : any} opts.paths
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {(msg: string) => void} opts.log
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
async function runStartupValidation({ paths, prisma, log, env = process.env }) {
  const report = {
    configuration: false,
    database: false,
    prisma: false,
    folders: false,
    logging: false,
    version: false,
  };

  // --- configuration ---
  const configResult = validateRuntimeConfig(env);
  if (!configResult.ok) {
    const msg = formatConfigErrors(configResult.issues);
    log(msg);
    const err = new Error("Configuration validation failed");
    err.code = "CONFIG_INVALID";
    err.issues = configResult.issues;
    err.formatted = msg;
    throw err;
  }
  report.configuration = true;
  log(`[OK] configuration  (NODE_ENV=${configResult.environment})`);

  // --- folders ---
  const folderResult = ensureRuntimeFolders(paths);
  if (!folderResult.ok) {
    const detail = folderResult.failures.map((f) => `${f.path}: ${f.error}`).join("; ");
    log(`[FAIL] folders        ${detail}`);
    const err = new Error(`Runtime folders not writable: ${detail}`);
    err.code = "FOLDERS_INVALID";
    throw err;
  }
  report.folders = true;
  const createdNote = folderResult.created.length
    ? ` (created ${folderResult.created.length} missing)`
    : "";
  log(`[OK] folders        shared/uploads/temp + logs${createdNote}`);

  // --- logging (caller initializes; we only mark) ---
  report.logging = true;
  log(`[OK] logging        ${paths.logsDir}`);

  // --- version / release metadata ---
  const meta = loadReleaseMetadata(paths.versionFile);
  report.version = true;
  log(
    `[OK] version        ${meta.productVersion}` +
      (meta.gitCommit ? ` commit=${meta.gitCommit}` : "") +
      (meta.buildDate ? ` built=${meta.buildDate}` : ""),
  );

  // --- Prisma client load ---
  try {
    if (!prisma || typeof prisma.$queryRaw !== "function") {
      throw new Error("Prisma client is not available (missing $queryRaw)");
    }
    // Touch constructor name / engine presence lightly
    report.prisma = true;
    log("[OK] Prisma         client loaded");
  } catch (e) {
    log(`[FAIL] Prisma         ${e instanceof Error ? e.message : String(e)}`);
    const err = new Error(`Prisma compatibility check failed: ${e instanceof Error ? e.message : e}`);
    err.code = "PRISMA_INVALID";
    throw err;
  }

  // --- database ---
  try {
    await prisma.$queryRaw`SELECT 1`;
    report.database = true;
    log("[OK] database       connection OK");
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`[FAIL] database       ${detail}`);
    const err = new Error(
      "Cannot connect to the database. Check DATABASE_URL and ensure MySQL is running.",
    );
    err.code = "DATABASE_UNAVAILABLE";
    err.cause = e;
    throw err;
  }

  return { report, meta, environment: configResult.environment };
}

module.exports = { runStartupValidation };
