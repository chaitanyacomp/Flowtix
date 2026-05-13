const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../../.env") });
require("dotenv").config({ path: path.join(__dirname, "../../.env.integration") });

const runIntegration = process.env.ERP_RUN_DB_INTEGRATION === "1";
const testDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.INTEGRATION_DATABASE_URL;

if (runIntegration) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Integration tests require NODE_ENV=test.");
  }
  if (!testDatabaseUrl) {
    throw new Error("Integration tests require TEST_DATABASE_URL.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() === testDatabaseUrl.trim()) {
    throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }
  process.env.DATABASE_URL = testDatabaseUrl;
}

module.exports = { runIntegration, testDatabaseUrl };
