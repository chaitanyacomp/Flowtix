/**
 * Strict launcher for Phase 3 disposable-DB restore integration verification.
 * Never runs against erp; requires NODE_ENV=test + explicit opt-in flag.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const backendRoot = path.join(__dirname, "..");

require("dotenv").config({ path: path.join(backendRoot, ".env") });
require("dotenv").config({ path: path.join(backendRoot, ".env.integration") });

if (process.env.NODE_ENV !== "test") {
  console.error("[test:integration:phase3-restore] Refusing to run: set NODE_ENV=test.");
  process.exit(1);
}

if (!process.env.TEST_DATABASE_URL && !process.env.INTEGRATION_DATABASE_URL) {
  console.error(
    "[test:integration:phase3-restore] Refusing to run: set TEST_DATABASE_URL (credentials only; disposable DBs are created).",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [path.join(__dirname, "verify-phase3-restore-integration.js")], {
  cwd: backendRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    ERP_RUN_PHASE3_RESTORE_INTEGRATION: "1",
  },
  windowsHide: true,
});

process.exit(result.status ?? 1);
