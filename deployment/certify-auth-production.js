#!/usr/bin/env node
/** Certify the built production bundle against a real deployment database. */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const releaseApp = path.join(root, "release", "Flowtix-v1.0.0", "app");
const dotenv = require(path.join(root, "backend", "node_modules", "dotenv"));
dotenv.config({ path: process.env.FLOWTIX_CERT_ENV || path.join(root, "backend", ".env"), quiet: true });

const password = process.env.FLOWTIX_CERT_PASSWORD || "";
if (!password) throw new Error("Set FLOWTIX_CERT_PASSWORD for the real certification users.");
const port = Number(process.env.FLOWTIX_CERT_PORT || 4018);
const users = [
  ["ADMIN", "admin@test.com"],
  ["STORE", "store@test.com"],
  ["PURCHASE", "purchase@test.com"],
  ["PRODUCTION", "production@test.com"],
  ["QA", "qa@test.com"],
];

const child = spawn(process.execPath, ["server.js"], {
  cwd: releaseApp,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    JWT_SECRET: process.env.JWT_SECRET || "flowtix-local-certification-secret",
    NODE_PATH: path.join(root, "backend", "node_modules"),
    FT_ERP_HOME: path.join(root, "_lab_auth_cert"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let backendErrors = "";
child.stderr.on("data", (chunk) => { backendErrors += String(chunk); });

async function waitForHealth() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged server did not become healthy. ${backendErrors.trim()}`);
}

async function certify() {
  await waitForHealth();
  const { chromium } = require(path.join(root, "node_modules", "playwright"));
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  try {
    for (const [expectedRole, email] of users) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => ({}));
    const token = String(body.token || "");
    const permissions = Array.isArray(body.user?.permissions) ? body.user.permissions : [];
    const landingPath = String(body.user?.landingPath || "");
    let landing = false;
    if (response.ok && landingPath) {
      const page = await fetch(`http://127.0.0.1:${port}${landingPath}`);
      const html = await page.text();
      landing = page.ok && /<div id="root"><\/div>/.test(html);
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    let uiLanding = false;
    let uiError = "";
    try {
      await page.goto(`http://127.0.0.1:${port}/login`);
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`http://127.0.0.1:${port}/dashboard`, { timeout: 15000 });
      await page.waitForTimeout(1500);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("user") || "null"));
      const renderedText = await page.locator("body").innerText();
      uiLanding = stored?.role === expectedRole && renderedText.trim().length > 0;
      if (!uiLanding) uiError = `Dashboard did not render for stored role ${stored?.role || "none"}.`;
    } catch (err) {
      uiError = err instanceof Error ? err.message.split("\n")[0] : String(err);
    } finally {
      await context.close();
    }
    rows.push({
      Role: expectedRole,
      UserExists: response.status !== 401,
      LoginAPI: response.status,
      Token: token.split(".").length === 3 && body.user?.role === expectedRole,
      Permissions: permissions.includes(`dashboard:${expectedRole.toLowerCase()}`),
      LandingPage: uiLanding ? landingPath : "FAIL",
      Result: response.ok && landing && uiLanding && token.split(".").length === 3 && permissions.length > 0 ? "PASS" : "FAIL",
      Error: response.ok ? uiError : body.error?.message || "Unknown error",
    });
  }
  } finally {
    await browser.close();
  }
  console.table(rows);
  const failed = rows.filter((row) => row.Result !== "PASS");
  if (failed.length || backendErrors.trim()) {
    if (backendErrors.trim()) console.error("[packaged backend]", backendErrors.trim());
    process.exitCode = 1;
  }
}

certify()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => { child.kill(); });
