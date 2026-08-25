const { verifyAccessToken } = require("../utils/jwt");
const {
  isMaintenanceActive,
  isMaintenanceExemptPath,
  readMaintenanceState,
} = require("../services/maintenanceMode");
const { readRestoreStatus, toPublicRestoreStatus } = require("../services/restoreJobStatus");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: { message: "Missing Bearer token" } });
  }
  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    return next();
  } catch (e) {
    const msg =
      e && e.name === "SessionEpochError"
        ? e.message
        : "Invalid token";
    return res.status(401).json({
      error: {
        message: msg,
        code: e && e.name === "SessionEpochError" ? "SESSION_INVALIDATED" : "INVALID_TOKEN",
      },
    });
  }
}

/**
 * @param {string[]} roles
 * @param {string} [forbiddenMessage] — response body when role is not allowed (default "Forbidden").
 */
function requireRole(roles, forbiddenMessage = "Forbidden") {
  return function roleMiddleware(req, res, next) {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: { message: "Unauthorized" } });
    if (!roles.includes(role)) {
      return res.status(403).json({ error: { message: forbiddenMessage } });
    }
    return next();
  };
}

/**
 * Block all access except health + restore-status while maintenance mode is active.
 */
function maintenanceModeMiddleware(req, res, next) {
  if (!isMaintenanceActive()) return next();
  const urlPath = String(req.originalUrl || req.url || "").split("?")[0];
  if (isMaintenanceExemptPath(req.method, urlPath)) return next();
  const restoreStatus = toPublicRestoreStatus(readRestoreStatus());
  const maint = readMaintenanceState();
  return res.status(503).json({
    error: {
      message:
        "ERP is in maintenance mode for database restore. Only health and restore status are available. Active users cannot make changes until restore finishes.",
      code: "MAINTENANCE_MODE",
    },
    maintenance: {
      active: true,
      reason: maint.reason,
      startedAt: maint.startedAt,
    },
    restoreStatus,
  });
}

module.exports = { requireAuth, requireRole, maintenanceModeMiddleware };
