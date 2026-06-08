const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const roles = require("../../src/constants/erpRoles");

describe("MPRS Phase 1 — Store ownership role constants", () => {
  it("STORE can write monthly planning and RS", () => {
    assert.ok(roles.MONTHLY_PLANNING_WRITE_ROLES.includes("STORE"));
    assert.ok(roles.RS_WRITE_ROLES.includes("STORE"));
    assert.ok(roles.MATERIAL_REQUISITION_WRITE_ROLES.includes("STORE"));
    assert.ok(roles.RM_ALLOCATION_WRITE_ROLES.includes("STORE"));
  });

  it("PURCHASE retains PO execution but not monthly planning write", () => {
    assert.ok(roles.RM_PO_WRITE_ROLES.includes("PURCHASE"));
    assert.equal(roles.MONTHLY_PLANNING_WRITE_ROLES.includes("PURCHASE"), false);
  });

  it("PURCHASE can read planning workspaces", () => {
    assert.ok(roles.MONTHLY_PLANNING_READ_ROLES.includes("PURCHASE"));
    assert.ok(roles.PROCUREMENT_PLANNING_ROLES.includes("PURCHASE"));
  });

  it("STORE can access RM Control Center and procurement review dashboard", () => {
    assert.ok(roles.RM_CONTROL_CENTER_ROLES.includes("STORE"));
    assert.ok(roles.PROCUREMENT_REVIEW_DASHBOARD_ROLES.includes("STORE"));
    assert.ok(roles.PLANNING_DASHBOARD_ROLES.includes("STORE"));
  });
});
