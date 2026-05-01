const { verifyAccessToken } = require("../utils/jwt");

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
    return res.status(401).json({ error: { message: "Invalid token" } });
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

module.exports = { requireAuth, requireRole };

