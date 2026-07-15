/**
 * Apply the committed Prisma migration history to an empty MySQL database
 * dedicated to integration tests.
 *
 * Uses `prisma migrate deploy` (NOT `prisma db push`) so the integration
 * database is built exactly like development and production — from the SQL in
 * `prisma/migrations/`. This matters because several TEXT snapshot columns use
 * the MySQL 8 expression-default form `DEFAULT ('')`, which the committed
 * migrations contain but schema-driven `db push` on Prisma 5.22.0 cannot
 * generate (it emits an illegal literal `TEXT ... DEFAULT ''` and MySQL rejects
 * it with error 1101).
 *
 * Requires TEST_DATABASE_URL (or legacy INTEGRATION_DATABASE_URL) and it must
 * differ from DATABASE_URL after .env / .env.integration load.
 *
 * Usage:
 *   NODE_ENV=test TEST_DATABASE_URL="mysql://..." npm run test:integration:prepare
 */

const { execSync } = require("child_process");
const path = require("path");

const backendRoot = path.join(__dirname, "..");

require("dotenv").config({ path: path.join(backendRoot, ".env") });
require("dotenv").config({ path: path.join(backendRoot, ".env.integration") });

const integrationUrl = process.env.TEST_DATABASE_URL || process.env.INTEGRATION_DATABASE_URL;
const mainUrl = process.env.DATABASE_URL;

if (!integrationUrl || !String(integrationUrl).trim()) {
  console.error(
    "[prepare-integration-db] Missing TEST_DATABASE_URL.\n" +
      "Create an empty database, then set e.g.\n" +
      '  NODE_ENV=test TEST_DATABASE_URL="mysql://USER:PASS@localhost:3306/mini_erp_test"\n' +
      "See docs/INTEGRATION_TEST_DB.md (from backend/).",
  );
  process.exit(1);
}

if (process.env.NODE_ENV !== "test") {
  console.error("[prepare-integration-db] Refusing to run: set NODE_ENV=test.");
  process.exit(1);
}

if (mainUrl && integrationUrl.trim() === mainUrl.trim()) {
  console.error(
    "[prepare-integration-db] TEST_DATABASE_URL must not equal DATABASE_URL.\n" +
      "Use a separate empty database so your main dev data is never modified by this script.",
  );
  process.exit(1);
}

console.log("[prepare-integration-db] prisma migrate deploy →", maskUrl(integrationUrl));
// Pass the integration URL as DATABASE_URL for the child process only, so Prisma
// applies the committed migration history to the dedicated test database and the
// developer's own DATABASE_URL is never targeted.
execSync("npx prisma migrate deploy", {
  cwd: backendRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: integrationUrl },
});

console.log("[prepare-integration-db] Done — committed migrations applied.");
console.log(
  "Run integration tests, e.g.\n" +
    "  NODE_ENV=test TEST_DATABASE_URL=<same URL> npm run test:integration:db",
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
