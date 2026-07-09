/**
 * FT-DEP-001 Batch 2 — GET /health (lightweight, no secrets).
 */
const { loadReleaseMetadata } = require("./releaseMeta");
const { resolveRuntimePaths } = require("./paths");

const startedAt = Date.now();

/**
 * @param {import('express').Express} app
 * @param {{ prisma: import('@prisma/client').PrismaClient, getMeta?: () => object }} deps
 */
function registerHealthRoutes(app, deps) {
  const { prisma, getMeta } = deps;

  app.get("/health", async (req, res) => {
    const paths = resolveRuntimePaths(process.env);
    const meta = typeof getMeta === "function" ? getMeta() : loadReleaseMetadata(paths.versionFile);
    let database = "down";
    let ok = true;

    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "up";
    } catch {
      database = "down";
      ok = false;
    }

    const body = {
      ok,
      application: "Flowtix ERP",
      version: meta.productVersion || null,
      environment: process.env.NODE_ENV || "development",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      database,
      buildTimestamp: meta.buildDate || null,
      gitCommit: meta.gitCommit || null,
      // No DATABASE_URL, JWT, paths with secrets, or host credentials.
    };

    return res.status(ok ? 200 : 503).json(body);
  });
}

module.exports = { registerHealthRoutes, startedAt };
