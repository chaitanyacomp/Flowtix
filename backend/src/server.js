const http = require("http");

// FT-DEP-001 Batch 2 — load shared/.env (and package .env) BEFORE Prisma client init.
const { loadRuntimeEnv } = require("./runtime/loadEnv");
loadRuntimeEnv();

const { bootstrapRuntime, getReleaseMeta } = require("./runtime/bootstrap");
const { prisma } = require("./utils/prisma");
const { ensureAppSettings } = require("./services/appSettings");
const { ensureIndiaStatesSeeded, backfillLegacyStateLinks } = require("./services/stateMaster");
const { ensureDefaultUnitsSeeded, backfillLegacyItemUnitLinks } = require("./services/unitMaster");
const { createApp } = require("./createApp");
const { resetBackupJobLockOnProcessStart } = require("./services/databaseBackupService");

/** Keep a strong reference to the HTTP server so the process stays alive (avoids rare exit-after-listen issues). */
let httpServer;

function parseDatabaseUrlInfo() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return { host: null, database: null };
  try {
    const u = new URL(raw);
    const host = u.host || null;
    const database = u.pathname ? u.pathname.replace(/^\//, "") : null;
    return { host: host || null, database: database || null };
  } catch {
    return { host: null, database: null };
  }
}

async function start() {
  let boot;
  try {
    boot = await bootstrapRuntime({ prisma });
  } catch (err) {
    // bootstrap already printed readable errors
    process.exit(1);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  const meta = getReleaseMeta();

  resetBackupJobLockOnProcessStart();

  await ensureAppSettings();
  await ensureIndiaStatesSeeded();
  await backfillLegacyStateLinks();
  await ensureDefaultUnitsSeeded();
  await backfillLegacyItemUnitLinks();

  const app = createApp({ getReleaseMeta: getReleaseMeta });

  await new Promise((resolve, reject) => {
    const server = http.createServer(app);
    function onBindError(err) {
      reject(err);
    }
    server.once("error", onBindError);
    server.listen(port, () => {
      server.removeListener("error", onBindError);
      server.on("error", (err) => {
        // eslint-disable-next-line no-console
        console.error("[startup] HTTP server error:", err?.message || err);
      });
      httpServer = server;
      // eslint-disable-next-line no-console
      console.log(
        `[startup] Backend listening on http://localhost:${port} (v${meta.productVersion || "?"})`,
      );
      const dbInfo = parseDatabaseUrlInfo();
      // eslint-disable-next-line no-console
      console.log("[startup] Runtime", {
        pid: process.pid,
        port,
        environment: boot.environment,
        layout: boot.paths.layout,
        databaseHost: dbInfo.host,
        databaseName: dbInfo.database,
      });
      // eslint-disable-next-line no-console
      console.log("[startup] Health: GET /health  |  Readiness: GET /api/health");
      console.log("[startup] Dashboard commercial: GET /api/dashboard/quotations-pending-so");
      resolve();
    });
  });
}

start().catch((err) => {
  const code = err && typeof err === "object" ? err.code : null;
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  if (code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(
      `[startup] Server failed to start: port ${port} is already in use. Stop the other process using port ${port} and restart the backend.`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.error("[startup] Server failed to start:", err?.message || err);
  }
  if (err?.stack) {
    // eslint-disable-next-line no-console
    console.error(err.stack);
  }
  process.exit(1);
});
