const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { PLANNING_DASHBOARD_ROLES } = require("../../src/constants/erpRoles");
const { WRITE_ROLES: MACHINE_WRITE, READ_ROLES: MACHINE_READ } = require("../../src/routes/machines");
const { WRITE_ROLES: OPERATOR_WRITE, READ_ROLES: OPERATOR_READ } = require("../../src/routes/operators");
const { WRITE_ROLES: SHIFT_WRITE, READ_ROLES: SHIFT_READ } = require("../../src/routes/shifts");
const {
  WRITE_ROLES: FG_WRITE,
  READ_ROLES: FG_READ,
} = require("../../src/routes/fgProductionStandards");

describe("PRODUCTION_MANAGER master + planning permissions", () => {
  it("includes PRODUCTION_MANAGER on Requirement & Cycle Planning roles", () => {
    assert.ok(PLANNING_DASHBOARD_ROLES.includes("PRODUCTION_MANAGER"));
    assert.ok(PLANNING_DASHBOARD_ROLES.includes("PRODUCTION"));
  });

  it("rejects Production Manager mutations on Machines / Operators / Shifts / FG Standards", () => {
    assert.ok(!MACHINE_WRITE.includes("PRODUCTION_MANAGER"));
    assert.ok(!OPERATOR_WRITE.includes("PRODUCTION_MANAGER"));
    assert.ok(!SHIFT_WRITE.includes("PRODUCTION_MANAGER"));
    assert.ok(!FG_WRITE.includes("PRODUCTION_MANAGER"));
    assert.ok(MACHINE_WRITE.includes("ADMIN"));
    assert.ok(FG_WRITE.includes("ADMIN"));
  });

  it("allows Production Manager read on production masters including FG Standards", () => {
    assert.ok(MACHINE_READ.includes("PRODUCTION_MANAGER"));
    assert.ok(OPERATOR_READ.includes("PRODUCTION_MANAGER"));
    assert.ok(SHIFT_READ.includes("PRODUCTION_MANAGER"));
    assert.ok(FG_READ.includes("PRODUCTION_MANAGER"));
  });
});
