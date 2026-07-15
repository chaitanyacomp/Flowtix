const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { RS_WRITE_ROLES, ALL_APP_ROLES } = require("../../src/constants/erpRoles");

describe("RS recovery Waive ownership (STORE + ADMIN)", () => {
  it("RS_WRITE_ROLES includes STORE and ADMIN only for write actions", () => {
    assert.deepEqual([...RS_WRITE_ROLES].sort(), ["ADMIN", "STORE"]);
    assert.ok(!RS_WRITE_ROLES.includes("PURCHASE"));
    assert.ok(!RS_WRITE_ROLES.includes("PRODUCTION"));
    assert.ok(!RS_WRITE_ROLES.includes("QA"));
    for (const role of ALL_APP_ROLES) {
      if (role === "ADMIN" || role === "STORE") {
        assert.ok(RS_WRITE_ROLES.includes(role));
      } else {
        assert.ok(!RS_WRITE_ROLES.includes(role), `${role} must not waive via RS_WRITE_ROLES`);
      }
    }
  });

  it("waive route uses RS_WRITE_ROLES (not ADMIN-only)", () => {
    const routePath = path.join(__dirname, "../../src/routes/requirementSheets.js");
    const src = fs.readFileSync(routePath, "utf8");
    const waiveIdx = src.indexOf('"/requirement-sheets/:id/recovery-decisions/:itemId/waive"');
    assert.ok(waiveIdx > 0, "waive route must exist");
    const window = src.slice(waiveIdx, waiveIdx + 350);
    assert.match(window, /requireRole\(RS_WRITE_ROLES\)/);
    assert.doesNotMatch(window, /requireRole\(\[\"ADMIN\"\]\)/);
  });

  it("keep route also uses RS_WRITE_ROLES", () => {
    const routePath = path.join(__dirname, "../../src/routes/requirementSheets.js");
    const src = fs.readFileSync(routePath, "utf8");
    const keepIdx = src.indexOf('"/requirement-sheets/:id/recovery-decisions/:itemId/keep"');
    assert.ok(keepIdx > 0);
    const window = src.slice(keepIdx, keepIdx + 350);
    assert.match(window, /requireRole\(RS_WRITE_ROLES\)/);
  });
});
