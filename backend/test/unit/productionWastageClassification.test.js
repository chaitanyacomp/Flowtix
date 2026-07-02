const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertWastageClassificationMatches,
  normalizeWastageDetailsInput,
  sumWastageDetailQty,
} = require("../../src/services/productionWastageClassificationService");

describe("productionWastageClassificationService", () => {
  it("normalizes and sums wastage detail rows", () => {
    const rows = normalizeWastageDetailsInput([
      { wastageTypeId: 1, qty: 1.2, remarks: "  " },
      { wastageTypeId: 0, qty: 5 },
      { wastageTypeId: 2, qty: 0.85, remarks: "setup" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(sumWastageDetailQty(rows), 2.05);
  });

  it("blocks confirmation when detailed wastage does not match total", () => {
    assert.throws(
      () => assertWastageClassificationMatches(2.85, [{ wastageTypeId: 1, qty: 2.3 }], "Kg"),
      (err) => err.code === "WASTAGE_CLASSIFICATION_MISMATCH",
    );
  });

  it("allows confirmation when detailed wastage matches total", () => {
    assert.doesNotThrow(() =>
      assertWastageClassificationMatches(
        2.85,
        [
          { wastageTypeId: 1, qty: 1.2 },
          { wastageTypeId: 2, qty: 1.65 },
        ],
        "Kg",
      ),
    );
  });
});
