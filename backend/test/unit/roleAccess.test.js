const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ERP_ROLES } = require("../../src/constants/erpRoles");
const { accessForRole, normalizeRole } = require("../../src/constants/roleAccess");

test("all operational roles have an authenticated landing and permissions", () => {
  for (const role of ERP_ROLES) {
    const access = accessForRole(role);
    assert.equal(access.role, role);
    assert.equal(access.landingPath, "/dashboard");
    assert.ok(access.permissions.length > 0);
    assert.ok(access.permissions.some((permission) => permission === `dashboard:${role.toLowerCase()}`));
  }
});

test("role normalization is case/whitespace tolerant but rejects unknown roles", () => {
  assert.equal(normalizeRole("  store "), "STORE");
  assert.equal(normalizeRole("qa"), "QA");
  assert.equal(normalizeRole("accounts"), null);
});
