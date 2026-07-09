/**
 * FT-DEP-001 Batch 2 — bootstrap: env → folders → logging → validate → metadata.
 * Called once from server.js before createApp / listen.
 */
const { loadRuntimeEnv } = require("./loadEnv");
const { resolveRuntimePaths } = require("./paths");
const { initRuntimeLogging, writeStartup } = require("./logging");
const { ensureRuntimeFolders } = require("./folders");
const { runStartupValidation } = require("./validate");
const { loadReleaseMetadata } = require("./releaseMeta");

/** @type {ReturnType<typeof loadReleaseMetadata> | null} */
let cachedMeta = null;
/** @type {ReturnType<typeof resolveRuntimePaths> | null} */
let cachedPaths = null;

function getReleaseMeta() {
  if (cachedMeta) return cachedMeta;
  const paths = cachedPaths || resolveRuntimePaths(process.env);
  cachedMeta = loadReleaseMetadata(paths.versionFile);
  return cachedMeta;
}

function getRuntimePathsCached() {
  return cachedPaths || resolveRuntimePaths(process.env);
}

/**
 * @param {{ prisma: object }} deps
 */
async function bootstrapRuntime(deps) {
  const { prisma } = deps;

  const { loadedFrom, paths: initialPaths } = loadRuntimeEnv();
  cachedPaths = resolveRuntimePaths(process.env);

  // Ensure folders before logging so log files can be created.
  const earlyFolders = ensureRuntimeFolders(cachedPaths);
  if (!earlyFolders.ok) {
    const detail = earlyFolders.failures.map((f) => `${f.path}: ${f.error}`).join("; ");
    // eslint-disable-next-line no-console
    console.error(`[startup] Cannot create runtime folders: ${detail}`);
    process.exit(1);
  }

  const logHandles = initRuntimeLogging(cachedPaths.logsDir);

  writeStartup("------------------------------------------------------------", logHandles);
  writeStartup("Flowtix ERP — startup validation (FT-DEP-001 Batch 2)", logHandles);
  writeStartup(`layout=${cachedPaths.layout} home=${cachedPaths.homeDir}`, logHandles);
  if (loadedFrom.length) {
    writeStartup(`env loaded from: ${loadedFrom.join(", ")}`, logHandles);
  } else {
    writeStartup("env: no .env file found (using process environment only)", logHandles);
  }
  writeStartup(`shared=${cachedPaths.sharedDir}`, logHandles);
  writeStartup(`logs=${cachedPaths.logsDir}`, logHandles);
  writeStartup("------------------------------------------------------------", logHandles);

  const log = (msg) => writeStartup(msg, logHandles);

  try {
    const result = await runStartupValidation({
      paths: cachedPaths,
      prisma,
      log,
      env: process.env,
    });
    cachedMeta = result.meta;
    writeStartup("------------------------------------------------------------", logHandles);
    writeStartup("Startup validation PASSED", logHandles);
    writeStartup("------------------------------------------------------------", logHandles);
    return {
      paths: cachedPaths,
      meta: result.meta,
      environment: result.environment,
      logHandles,
    };
  } catch (err) {
    writeStartup("------------------------------------------------------------", logHandles);
    writeStartup("Startup validation FAILED", logHandles);
    if (err?.formatted) writeStartup(err.formatted, logHandles);
    else writeStartup(err instanceof Error ? err.message : String(err), logHandles);
    writeStartup("------------------------------------------------------------", logHandles);
    throw err;
  }
}

module.exports = {
  bootstrapRuntime,
  getReleaseMeta,
  getRuntimePathsCached,
};
