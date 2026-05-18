const http = require("http");
const dotenv = require("dotenv");

dotenv.config();

const { prisma } = require("./utils/prisma");
const { ensureDefaultAdmin } = require("./utils/ensureDefaultAdmin");
const { ensureAppSettings } = require("./services/appSettings");
const { ensureIndiaStatesSeeded, backfillLegacyStateLinks } = require("./services/stateMaster");
const { ensureDefaultUnitsSeeded, backfillLegacyItemUnitLinks } = require("./services/unitMaster");
const { createApp } = require("./createApp");
const { resetBackupJobLockOnProcessStart } = require("./services/databaseBackupService");

const app = createApp();

const port = process.env.PORT ? Number(process.env.PORT) : 4000;

/** Keep a strong reference to the HTTP server so the process stays alive (avoids rare exit-after-listen issues). */
let httpServer;

function parseDatabaseUrlInfo() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return { host: null, database: null };
  try {
    const u = new URL(raw);
    const host = u.host || null; // includes port if present
    const database = u.pathname ? u.pathname.replace(/^\//, "") : null;
    return { host: host || null, database: database || null };
  } catch {
    // Non-URL formats (rare); avoid leaking full string.
    return { host: null, database: null };
  }
}

async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // eslint-disable-next-line no-console
    console.log("[startup] Database connection OK");
    resetBackupJobLockOnProcessStart();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[startup] Cannot connect to the database. Set DATABASE_URL in backend/.env and ensure MySQL is running (e.g. docker compose up -d mysql).",
    );
    // eslint-disable-next-line no-console
    console.error(err?.message || err);
    process.exit(1);
  }

  await ensureDefaultAdmin();
  await ensureAppSettings();
  await ensureIndiaStatesSeeded();
  await backfillLegacyStateLinks();
  await ensureDefaultUnitsSeeded();
  await backfillLegacyItemUnitLinks();

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
      console.log(`[startup] Backend listening on http://localhost:${port}`);
      const dbInfo = parseDatabaseUrlInfo();
      // eslint-disable-next-line no-console
      console.log("[startup] Runtime", {
        pid: process.pid,
        port,
        databaseHost: dbInfo.host,
        databaseName: dbInfo.database,
      });
      // eslint-disable-next-line no-console
      console.log("[startup] Readiness: GET /api/health (includes DB check)");
      console.log("[startup] Dashboard commercial: GET /api/dashboard/quotations-pending-so");
      resolve();
    });
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  const code = err && typeof err === "object" ? err.code : null;
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
