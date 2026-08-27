const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  WO_PLAN_PREP_ROLES,
  WO_WRITE_ROLES,
  WO_MACHINE_RUN_WRITE_ROLES,
} = require("../../src/constants/erpRoles");
const { WRITE_ROLES: MACHINE_WRITE_ROLES } = require("../../src/routes/machines");

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

  it("STORE cannot write machine-run allocations or confirm machine material state", () => {
    assert.ok(WO_MACHINE_RUN_WRITE_ROLES.includes("ADMIN"));
    assert.ok(WO_MACHINE_RUN_WRITE_ROLES.includes("PRODUCTION"));
    assert.ok(WO_MACHINE_RUN_WRITE_ROLES.includes("PRODUCTION_MANAGER"));
    assert.ok(!WO_MACHINE_RUN_WRITE_ROLES.includes("STORE"));
    assert.ok(MACHINE_WRITE_ROLES.includes("ADMIN"));
    assert.ok(MACHINE_WRITE_ROLES.includes("PRODUCTION"));
    assert.ok(!MACHINE_WRITE_ROLES.includes("STORE"));
  });

  it("PRODUCTION cannot create REGULAR_SO WO; STORE and ADMIN can", () => {
    const { REGULAR_SO_WO_CREATE_ROLES } = require("../../src/constants/erpRoles");
    assert.ok(REGULAR_SO_WO_CREATE_ROLES.includes("STORE"));
    assert.ok(REGULAR_SO_WO_CREATE_ROLES.includes("ADMIN"));
    assert.ok(!REGULAR_SO_WO_CREATE_ROLES.includes("PRODUCTION"));
  });
});
