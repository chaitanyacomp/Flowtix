const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveNoQtyWoExecutableQty } = require("../../src/services/noQtyWoQtyService");

describe("noQtyWoQtyService.resolveNoQtyWoExecutableQty", () => {
  it("returns requirementQty rounded to 3 decimals", () => {
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: 10000 }), 10000);
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: "10000.5" }), 10000.5);
  });

  it("ignores suggestedWoQtySnapshot (cumulative Total to Produce)", () => {
    assert.equal(
      resolveNoQtyWoExecutableQty({
        requirementQty: 10000,
        suggestedWoQtySnapshot: 20000,
        shortfallQtySnapshot: 10000,
      }),
      10000,
    );
  });

  it("returns 0 when requirementQty is zero or negative", () => {
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: 0, suggestedWoQtySnapshot: 10000 }), 0);
    assert.equal(resolveNoQtyWoExecutableQty({ requirementQty: -5, suggestedWoQtySnapshot: 10000 }), 0);
    assert.equal(resolveNoQtyWoExecutableQty({ suggestedWoQtySnapshot: 20000 }), 0);
  });
});
