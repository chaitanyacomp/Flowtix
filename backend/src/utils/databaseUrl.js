/**
 * Parse Prisma/MySQL DATABASE_URL for mysqldump/mysql CLI (no shell interpolation).
 * Supports mysql://user:pass@host:port/dbname
 *
 * @param {string} raw
 * @returns {{ user: string; password: string; host: string; port: string; database: string }}
 */
function parseDatabaseUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) {
    const err = new Error("DATABASE_URL is not set.");
    err.statusCode = 503;
    throw err;
  }
  if (!/^mysql:\/\//i.test(s)) {
    const err = new Error("DATABASE_URL must be a mysql:// connection string.");
    err.statusCode = 503;
    throw err;
  }
  const normalized = s.replace(/^mysql:\/\//i, "http://");
  let u;
  try {
    u = new URL(normalized);
  } catch {
    const err = new Error("DATABASE_URL could not be parsed.");
    err.statusCode = 503;
    throw err;
  }
  const dbPath = (u.pathname || "").replace(/^\//, "").split("?")[0];
  if (!dbPath) {
    const err = new Error("DATABASE_URL must include a database name in the path.");
    err.statusCode = 503;
    throw err;
  }
  return {
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    host: u.hostname || "127.0.0.1",
    port: u.port ? String(u.port) : "3306",
    database: decodeURIComponent(dbPath),
  };
}

module.exports = { parseDatabaseUrl };
