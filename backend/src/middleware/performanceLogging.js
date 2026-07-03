const { getPrismaQueryCount, getPrismaQueryDuplicatePatterns, runWithQueryMetrics } = require("../utils/prismaQueryMetrics");

const PERF_SLOW_MS = Number(process.env.PERF_SLOW_MS || 700);

function isPerfLoggingEnabled() {
  if (process.env.PERF_LOG === "1" || process.env.PERF_LOG === "true") return true;
  return process.env.NODE_ENV !== "production";
}

function categorizeApiPath(path) {
  const p = String(path || "");
  if (p.startsWith("/api/auth")) return "auth";
  if (p.startsWith("/api/dashboard")) return "dashboard";
  if (p.startsWith("/api/pending-actions")) return "pending-actions";
  if (p.startsWith("/api/sales-bills")) return "sales-bills";
  if (p.startsWith("/api/production")) return "production";
  if (p.startsWith("/api/dispatch")) return "dispatch";
  if (p.startsWith("/api/reports")) return "reports";
  if (p.startsWith("/api/items") || p.startsWith("/api/customers") || p.startsWith("/api/suppliers")) {
    return "masters";
  }
  return "other";
}

/**
 * Logs API duration, role, Prisma query count, and response size for /api/* routes.
 * Enable in production with PERF_LOG=1.
 */
function performanceLoggingMiddleware(req, res, next) {
  if (!isPerfLoggingEnabled()) return next();
  const rawPath = req.originalUrl || req.url || "";
  if (!rawPath.startsWith("/api/")) return next();

  const startedAt = process.hrtime.bigint();

  runWithQueryMetrics(() => {
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const queryCount = getPrismaQueryCount();
      const duplicatePatterns =
        durationMs >= PERF_SLOW_MS || queryCount >= 50 ? getPrismaQueryDuplicatePatterns(8) : [];
      const contentLength = res.getHeader("content-length");
      const responseSize =
        contentLength != null && contentLength !== "" ? Number(contentLength) : null;
      const role = req.user?.role ?? null;
      const category = categorizeApiPath(rawPath.split("?")[0]);
      const payload = {
        endpoint: rawPath.split("?")[0],
        method: req.method,
        category,
        durationMs: Math.round(durationMs * 10) / 10,
        status: res.statusCode,
        role,
        queryCount: queryCount != null ? queryCount : undefined,
        responseSize: Number.isFinite(responseSize) ? responseSize : undefined,
        ...(duplicatePatterns.length ? { duplicatePatterns } : {}),
      };
      const line = `[perf] ${payload.method} ${payload.endpoint} ${payload.durationMs}ms`;
      if (durationMs >= PERF_SLOW_MS || res.statusCode >= 500) {
        // eslint-disable-next-line no-console
        console.warn(line, payload);
      } else {
        // eslint-disable-next-line no-console
        console.log(line, payload);
      }
    });
    next();
  });
}

module.exports = { performanceLoggingMiddleware, isPerfLoggingEnabled, categorizeApiPath };
