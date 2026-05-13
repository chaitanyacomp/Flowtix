const { spawnSync } = require("child_process");
const path = require("path");

const backendRoot = path.join(__dirname, "..");

require("dotenv").config({ path: path.join(backendRoot, ".env") });
require("dotenv").config({ path: path.join(backendRoot, ".env.integration") });

const nodeEnv = process.env.NODE_ENV;
const testUrl = process.env.TEST_DATABASE_URL;
const mainUrl = process.env.DATABASE_URL;

if (nodeEnv !== "test") {
  console.error("[test:integration:db] Refusing to run: set NODE_ENV=test.");
  process.exit(1);
}

if (!testUrl || !String(testUrl).trim()) {
  console.error("[test:integration:db] Refusing to run: set TEST_DATABASE_URL to a dedicated test database.");
  process.exit(1);
}

if (mainUrl && testUrl.trim() === mainUrl.trim()) {
  console.error("[test:integration:db] Refusing to run: TEST_DATABASE_URL must not equal DATABASE_URL.");
  process.exit(1);
}

const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "test:integration"], {
  cwd: backendRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    ERP_RUN_DB_INTEGRATION: "1",
    INTEGRATION_DATABASE_URL: testUrl,
  },
});

process.exit(result.status ?? 1);
