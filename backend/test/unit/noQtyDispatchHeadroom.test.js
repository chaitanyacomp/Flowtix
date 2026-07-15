const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeNoQtyDispatchHeadroom } = require("../../src/services/noQtyDispatchHeadroom");

describe("noQtyDispatchHeadroom", () => {
  it("returns max(0, qc + recheck + post − operational net)", () => {
    assert.equal(
      computeNoQtyDispatchHeadroom({
        alreadyOpNet: 30,
        qcAcceptedThisCycle: 100,
        recheckAcceptedThisCycle: 10,
        postCycleApprovalQty: 5,
      }),
      85,
    );
  });

  it("never returns negative headroom", () => {
    assert.equal(
      computeNoQtyDispatchHeadroom({
        alreadyOpNet: 200,
        qcAcceptedThisCycle: 50,
      }),
      0,
    );
  });

  it("treats missing optional pools as zero", () => {
    assert.equal(
      computeNoQtyDispatchHeadroom({
        alreadyOpNet: 10,
        qcAcceptedThisCycle: 40,
      }),
      30,
    );
  });

  it("caps excess accepted FG by remaining customer demand", () => {
    assert.equal(computeNoQtyDispatchHeadroom({ alreadyOpNet: 6000, customerDemandQty: 6000, qcAcceptedThisCycle: 6500, availableFgStock: 500 }), 0);
    assert.equal(computeNoQtyDispatchHeadroom({ alreadyOpNet: 5500, customerDemandQty: 6000, qcAcceptedThisCycle: 6500, availableFgStock: 1000 }), 500);
    assert.equal(computeNoQtyDispatchHeadroom({ alreadyOpNet: 5000, customerDemandQty: 6000, qcAcceptedThisCycle: 5500, availableFgStock: 500 }), 500);
  });
});
