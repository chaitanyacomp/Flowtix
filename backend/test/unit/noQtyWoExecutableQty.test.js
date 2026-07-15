const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveNoQtyWoExecutableQty } = require("../../src/services/noQtyWoQtyService");

describe("noQtyWoQtyService.resolveNoQtyWoExecutableQty", () => {
  it("uses the locked operational snapshot without changing customer demand", () => {
    assert.equal(
      resolveNoQtyWoExecutableQty({
        requirementQty: 1000,
        baseDemandQty: 1000,
        totalRsQty: 1025,
        suggestedWoQtySnapshot: 1025,
        productionShortfallQty: 20,
        qcRejectionRecoveryQty: 5,
      }),
      1025,
    );
  });

  it("15-17: accepted excess reduces suggested WO, including to zero, without changing RS/WO planned quantities", () => {
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: 3500, totalRsQty: 3500, suggestedWoQtySnapshot: 3000 }), 3000);
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: 300, totalRsQty: 300, suggestedWoQtySnapshot: 0 }), 0);
  });

  it("uses suggestedWoQtySnapshot when totalRsQty is missing", () => {
    assert.equal(
      resolveNoQtyWoExecutableQty({
        requirementQty: 1000,
        suggestedWoQtySnapshot: 1025,
      }),
      1025,
    );
  });

  it("falls back to requirementQty when composition fields are absent (Waive / legacy)", () => {
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: 1000 }), 1000);
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: "10000.5" }), 10000.5);
  });

  it("Waive path: totalRsQty equals base demand only", () => {
    assert.equal(
      resolveNoQtyWoExecutableQty({
        requirementQty: 1000,
        baseDemandQty: 1000,
        totalRsQty: 1000,
        suggestedWoQtySnapshot: 1000,
        productionShortfallQty: 0,
        qcRejectionRecoveryQty: 0,
      }),
      1000,
    );
  });

  it("returns 0 when all quantities are zero or missing", () => {
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: 0, suggestedWoQtySnapshot: 0 }), 0);
    assert.equal(resolveNoQtyWoExecutableQty({}), 0);
  });
});
