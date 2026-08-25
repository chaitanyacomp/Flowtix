const jwt = require("jsonwebtoken");
const { getAuthSessionEpoch } = require("../services/authSessionEpoch");

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    const err = new Error("JWT_SECRET is not configured");
    err.statusCode = 500;
    throw err;
  }
  return "mini-erp-dev-jwt-secret-change-me";
}

function signAccessToken(payload) {
  const secret = requireJwtSecret();
  const sessionEpoch = getAuthSessionEpoch();
  return jwt.sign({ ...payload, sessionEpoch }, secret, { expiresIn: "8h" });
}

function verifyAccessToken(token) {
  const secret = requireJwtSecret();
  const decoded = jwt.verify(token, secret);
  const current = getAuthSessionEpoch();
  const tokenEpoch = Number(decoded && decoded.sessionEpoch);
  const normalized = Number.isFinite(tokenEpoch) ? tokenEpoch : 0;
  if (normalized !== current) {
    const err = new Error("Session invalidated. Please sign in again.");
    err.name = "SessionEpochError";
    throw err;
  }
  return decoded;
}

module.exports = { signAccessToken, verifyAccessToken, getAuthSessionEpoch };
