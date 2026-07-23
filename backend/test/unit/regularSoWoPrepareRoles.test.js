const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { WO_PLAN_PREP_ROLES, WO_WRITE_ROLES } = require("../../src/constants/erpRoles");

describe("REGULAR_SO WO prepare / write roles", () => {
  it("includes Store and Admin for Prepare WO and WO create; excludes Purchase/QA", () => {
    assert.ok(WO_PLAN_PREP_ROLES.includes("STORE"));
    assert.ok(WO_PLAN_PREP_ROLES.includes("ADMIN"));
    assert.ok(WO_WRITE_ROLES.includes("STORE"));
    assert.ok(WO_WRITE_ROLES.includes("ADMIN"));
    assert.ok(!WO_PLAN_PREP_ROLES.includes("PURCHASE"));
    assert.ok(!WO_PLAN_PREP_ROLES.includes("QA"));
    assert.ok(!WO_WRITE_ROLES.includes("PURCHASE"));
    assert.ok(!WO_WRITE_ROLES.includes("QA"));
  });
});
