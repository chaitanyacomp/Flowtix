/**
 * Apply prisma/schema.prisma to an empty MySQL database dedicated to integration tests.
 *
 * Requires INTEGRATION_DATABASE_URL (must differ from DATABASE_URL after .env load).
 * Uses `prisma db push` so the database matches the current schema without relying on
 * a complete migration history from empty.
 *
 * Usage:
 *   INTEGRATION_DATABASE_URL="mysql://..." npm run test:integration:prepare
 */

const { execSync } = require("child_process");
const path = require("path");

const backendRoot = path.join(__dirname, "..");

require("dotenv").config({ path: path.join(backendRoot, ".env") });

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
const mainUrl = process.env.DATABASE_URL;

if (!integrationUrl || !String(integrationUrl).trim()) {
  console.error(
    "[prepare-integration-db] Missing INTEGRATION_DATABASE_URL.\n" +
      "Create an empty database, then set e.g.\n" +
      '  INTEGRATION_DATABASE_URL="mysql://USER:PASS@localhost:3306/mini_erp_integration"\n' +
      "See docs/INTEGRATION_TEST_DB.md (from backend/).",
  );
  process.exit(1);
}

if (mainUrl && integrationUrl.trim() === mainUrl.trim()) {
  console.error(
    "[prepare-integration-db] INTEGRATION_DATABASE_URL must not equal DATABASE_URL.\n" +
      "Use a separate empty database so your main dev data is never modified by this script.",
  );
  process.exit(1);
}

console.log("[prepare-integration-db] prisma db push →", maskUrl(integrationUrl));
execSync("npx prisma db push", {
  cwd: backendRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: integrationUrl },
});

console.log("[prepare-integration-db] Done.");
console.log(
  "Run integration tests, e.g.\n" +
    "  ERP_RUN_DB_INTEGRATION=1 INTEGRATION_DATABASE_URL=<same URL> npm run test:integration",
);

function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(invalid URL)";
  }
}
