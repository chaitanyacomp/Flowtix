/**
 * FT-DEP-001 Batch 2 — production configuration validation.
 * Fail-fast with readable errors. No business logic.
 */

const REQUIRED_ALWAYS = [
  {
    name: "DATABASE_URL",
    description: "MySQL connection string (mysql://user:pass@host:port/database)",
  },
];

const REQUIRED_PRODUCTION = [
  {
    name: "JWT_SECRET",
    description: "Secret used to sign access tokens (min 16 characters in production)",
    validate: (v) => String(v).trim().length >= 16 || "JWT_SECRET must be at least 16 characters in production",
  },
];

/**
 * @typedef {{ name: string, message: string }} ConfigIssue
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true, environment: string, issues: [] } | { ok: false, environment: string, issues: ConfigIssue[] }}
 */
function validateRuntimeConfig(env = process.env) {
  const environment = String(env.NODE_ENV || "development").trim() || "development";
  const isProd = environment === "production";
  /** @type {ConfigIssue[]} */
  const issues = [];

  for (const spec of REQUIRED_ALWAYS) {
    const raw = env[spec.name];
    if (raw == null || String(raw).trim() === "") {
      issues.push({
        name: spec.name,
        message: `Missing required variable ${spec.name}. ${spec.description}`,
      });
    }
  }

  if (isProd) {
    for (const spec of REQUIRED_PRODUCTION) {
      const raw = env[spec.name];
      if (raw == null || String(raw).trim() === "") {
        issues.push({
          name: spec.name,
          message: `Missing required production variable ${spec.name}. ${spec.description}`,
        });
        continue;
      }
      if (typeof spec.validate === "function") {
        const result = spec.validate(raw);
        if (result !== true) {
          issues.push({
            name: spec.name,
            message: typeof result === "string" ? result : `Invalid ${spec.name}`,
          });
        }
      }
    }
  }

  const portRaw = env.PORT;
  if (portRaw != null && String(portRaw).trim() !== "") {
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      issues.push({
        name: "PORT",
        message: `PORT must be an integer 1–65535 (got "${portRaw}")`,
      });
    }
  }

  if (env.DATABASE_URL && String(env.DATABASE_URL).trim()) {
    try {
      const u = new URL(String(env.DATABASE_URL));
      if (!/^mysql/.test(u.protocol)) {
        issues.push({
          name: "DATABASE_URL",
          message: `DATABASE_URL must use mysql protocol (got "${u.protocol}")`,
        });
      }
    } catch {
      issues.push({
        name: "DATABASE_URL",
        message: "DATABASE_URL is not a valid URL (expected mysql://user:pass@host:port/db)",
      });
    }
  }

  if (issues.length) return { ok: false, environment, issues };
  return { ok: true, environment, issues: [] };
}

/**
 * Format issues for console / startup.log
 * @param {ConfigIssue[]} issues
 */
function formatConfigErrors(issues) {
  const lines = [
    "",
    "============================================================",
    "  FT ERP startup aborted — configuration error",
    "============================================================",
    "",
    "Fix the following and restart:",
    "",
  ];
  for (const issue of issues) {
    lines.push(`  • [${issue.name}] ${issue.message}`);
  }
  lines.push("");
  lines.push("See deployment/production.env.example and FT-DEP-001 (runtime configuration).");
  lines.push("Place secrets in shared/.env (production) or backend/.env (development).");
  lines.push("");
  return lines.join("\n");
}

module.exports = {
  REQUIRED_ALWAYS,
  REQUIRED_PRODUCTION,
  validateRuntimeConfig,
  formatConfigErrors,
};
