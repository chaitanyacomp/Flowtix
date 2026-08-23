/**
 * Startup / route syntax checkpoint — catches SyntaxError in route modules before login 500s.
 * Complements node --check in CI/agent workflows.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BACKEND_ROOT = path.resolve(__dirname, "../..");
const SRC_ROOT = path.join(BACKEND_ROOT, "src");

function collectJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "generated") continue;
      collectJsFiles(full, out);
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

describe("backend route/module syntax checkpoint", () => {
  it("node --check passes for production routes and machine-planning services", () => {
    const critical = [
      "src/routes/production.js",
      "src/routes/salesOrders.js",
      "src/routes/machines.js",
      "src/routes/requirementSheets.js",
      "src/constants/erpRoles.js",
      "src/services/woPrepareOperationalQueue.js",
      "src/services/regularSoMachinePlanningService.js",
      "src/services/woProductionRunAllocationService.js",
      "src/services/regularSoPlanningSnapshotService.js",
      "src/createApp.js",
    ].map((rel) => path.join(BACKEND_ROOT, rel));

    for (const file of critical) {
      assert.ok(fs.existsSync(file), `missing ${file}`);
      const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(
        r.status,
        0,
        `Syntax error in ${path.relative(BACKEND_ROOT, file)}:\n${r.stderr || r.stdout}`,
      );
    }
  });

  it("createApp loads without SyntaxError (all routes register)", () => {
    // Isolate require so a prior failed load does not poison this assertion.
    const r = spawnSync(
      process.execPath,
      [
        "-e",
        `
          const { createApp } = require(${JSON.stringify(path.join(SRC_ROOT, "createApp.js"))});
          const app = createApp();
          if (!app || typeof app.use !== "function") {
            console.error("createApp did not return an Express app");
            process.exit(2);
          }
          console.log("CREATE_APP_OK");
        `,
      ],
      {
        cwd: BACKEND_ROOT,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "test" },
      },
    );
    assert.equal(r.status, 0, `createApp failed:\n${r.stderr || r.stdout}`);
    assert.match(r.stdout || "", /CREATE_APP_OK/);
  });
});
