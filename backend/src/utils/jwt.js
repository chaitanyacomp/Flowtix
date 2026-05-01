const jwt = require("jsonwebtoken");

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
  return jwt.sign(payload, secret, { expiresIn: "8h" });
}

function verifyAccessToken(token) {
  const secret = requireJwtSecret();
  return jwt.verify(token, secret);
}

module.exports = { signAccessToken, verifyAccessToken };

