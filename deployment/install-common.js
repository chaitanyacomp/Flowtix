/**
 * FT-DEP-001 Milestone 3 — shared install helpers (redaction, env parse, admin).
 * No business logic. Never log passwords.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function redactSecrets(text) {
  return String(text || "")
    .replace(/password\s*=\s*.+/gi, "password=***")
    .replace(/DATABASE_URL\s*=\s*.+/gi, "DATABASE_URL=***")
    .replace(/JWT_SECRET\s*=\s*.+/gi, "JWT_SECRET=***")
    .replace(/mysql:\/\/([^:]+):([^@]+)@/gi, "mysql://$1:***@");
}

function maskValue(v) {
  if (v == null || String(v).trim() === "") return "(empty)";
  const s = String(v);
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "****" + s.slice(-2);
}

function isAdmin() {
  if (process.platform !== "win32") return false;
  const r = spawnSync("net", ["session"], {
    encoding: "utf8",
    windowsHide: true,
    shell: true,
  });
  return !r.error && r.status === 0;
}

function parseEnvFile(filePath) {
  const map = {};
  if (!filePath || !fs.existsSync(filePath)) return map;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

/**
 * Parse mysql DATABASE_URL without logging password.
 * @returns {{ ok: boolean, user?: string, password?: string, host?: string, port?: number, database?: string, error?: string }}
 */
function parseDatabaseUrl(raw) {
  if (!raw || !String(raw).trim()) {
    return { ok: false, error: "DATABASE_URL empty" };
  }
  const s = String(raw).trim();
  if (!/^mysql:\/\//i.test(s)) {
    return { ok: false, error: "DATABASE_URL must start with mysql://" };
  }
  try {
    const u = new URL(s.replace(/^mysql:\/\//i, "http://"));
    const database = (u.pathname || "").replace(/^\//, "").split("?")[0];
    if (!database) return { ok: false, error: "DATABASE_URL missing database name" };
    return {
      ok: true,
      user: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : 3306,
      database,
    };
  } catch (e) {
    return { ok: false, error: `DATABASE_URL parse failed: ${e.message || e}` };
  }
}

function buildDatabaseUrl({ user, password, host, port, database }) {
  const encUser = encodeURIComponent(user || "");
  const encPass = encodeURIComponent(password || "");
  const h = host || "127.0.0.1";
  const p = port || 3306;
  const db = database || "flowtix_erp";
  return `mysql://${encUser}:${encPass}@${h}:${p}/${db}`;
}

function windowsVersion() {
  if (process.platform !== "win32") {
    return { ok: true, detail: `${process.platform} ${os.release()}` };
  }
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  const text = String(r.stdout || "").trim();
  if (r.status === 0 && text) {
    return { ok: true, detail: text };
  }
  return { ok: true, detail: `Windows ${os.release()}` };
}

function findMysqlClient() {
  if (process.env.MYSQL_PATH && fs.existsSync(process.env.MYSQL_PATH)) {
    return process.env.MYSQL_PATH;
  }
  const candidates = [
    "mysql",
    "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe",
    "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe",
    "C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysql.exe",
  ];
  for (const exe of candidates) {
    if (path.isAbsolute(exe) && fs.existsSync(exe)) return exe;
    const r = spawnSync(exe, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
      shell: true,
    });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}

function checkItem(id, ok, level, detail, corrective) {
  return {
    id,
    ok: !!ok,
    level: level || (ok ? "ok" : "error"),
    detail,
    corrective: corrective || null,
  };
}

function writeJsonSafe(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

const DEV_DB_NAMES = new Set([
  "mini_erp",
  "mini_erp_integration",
  "test",
  "testdb",
  "dev",
  "development",
]);

module.exports = {
  redactSecrets,
  maskValue,
  isAdmin,
  parseEnvFile,
  parseDatabaseUrl,
  buildDatabaseUrl,
  windowsVersion,
  findMysqlClient,
  checkItem,
  writeJsonSafe,
  nowIso,
  DEV_DB_NAMES,
};
