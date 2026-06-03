const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  wastageReasonLabel,
  WASTAGE_REASON_LABELS,
} = require("../../src/services/materialWastageService");
const {
  computeUnusedIssuedRmQty,
  computePhysicalReturnableQty,
} = require("../../src/services/materialReturnService");

describe("materialWastageService", () => {
  it("maps wastage reason codes to labels", () => {
    assert.equal(wastageReasonLabel("PROCESS_LOSS"), "Process Loss");
    assert.equal(Object.keys(WASTAGE_REASON_LABELS).length, 6);
  });
});

describe("returnable qty with wastage (additive)", () => {
  it("unused subtracts wastage like returned qty", () => {
    assert.equal(computeUnusedIssuedRmQty(8.317, 4.077, 3.5, 0.74), 0);
  });

  it("returnable caps logical unused by on-hand", () => {
    assert.equal(computePhysicalReturnableQty(8.317, 4.077, 3.5, 4.24, 0.74), 0);
    assert.equal(computePhysicalReturnableQty(8.317, 4.077, 0, 4.24, 0), 4.24);
  });
});
