const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { deriveNextAction } = require("../../src/services/regularSoWorkOrderDetailService");

describe("regularSoWorkOrderDetailService — next action", () => {
  it("Issue RM when PMR requested / not issued", () => {
    const a = deriveNextAction({
      isRegular: true,
      pmrStatus: "REQUESTED",
      netIssued: 0,
      theoreticalRm: 211.05,
      productionAllowed: 0,
      approvedProduced: 0,
      woTarget: 15075,
      qaPending: 0,
      lifecycleStatus: "PENDING",
    });
    assert.equal(a.key, "ISSUE_RM");
    assert.equal(a.hrefKind, "MATERIAL_ISSUE");
  });

  it("Continue RM Issue when partially issued", () => {
    const a = deriveNextAction({
      isRegular: true,
      pmrStatus: "PARTIALLY_ISSUED",
      netIssued: 100,
      theoreticalRm: 211.05,
      productionAllowed: 7142,
      approvedProduced: 0,
      woTarget: 15075,
      qaPending: 0,
      lifecycleStatus: "PENDING",
    });
    assert.equal(a.key, "CONTINUE_ISSUE");
  });

  it("Start Production when RM issued and nothing produced", () => {
    const a = deriveNextAction({
      isRegular: true,
      pmrStatus: "FULLY_ISSUED",
      netIssued: 211.05,
      theoreticalRm: 211.05,
      productionAllowed: 15075,
      approvedProduced: 0,
      woTarget: 15075,
      qaPending: 0,
      lifecycleStatus: "IN_PROGRESS",
    });
    assert.equal(a.key, "START_PRODUCTION");
    assert.equal(a.hrefKind, "PRODUCTION");
  });

  it("NO_QTY guided action when not regular", () => {
    const a = deriveNextAction({
      isRegular: false,
      pmrStatus: null,
      netIssued: 0,
      theoreticalRm: 0,
      productionAllowed: 0,
      approvedProduced: 0,
      woTarget: 1000,
      qaPending: 0,
      lifecycleStatus: "PENDING",
    });
    assert.equal(a.key, "NO_QTY_GUIDED");
  });
});
