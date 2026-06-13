/**
 * P6B-4F — PO qty above requirement (pack size / MOQ).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePurchaseRequestPoLineQty,
  linePendingPoQty,
  lineExcessOrderedQty,
} = require("../../src/services/purchaseRequestService");

function prLine(overrides = {}) {
  return {
    netRequiredQty: 185.61,
    orderedQty: 0,
    rmItemId: 1,
    rmItem: { itemName: "PP" },
    purchaseRequest: { docNo: "PR-26-0001" },
    ...overrides,
  };
}

describe("purchaseRequestPoQty (P6B-4F)", () => {
  it("allows PO qty above pending requirement", () => {
    const line = prLine();
    assert.equal(linePendingPoQty(line), 185.61);
    const qty = validatePurchaseRequestPoLineQty(line, 200);
    assert.equal(qty, 200);
  });

  it("computes excess ordered after over-order", () => {
    const line = prLine({ orderedQty: 200 });
    assert.equal(linePendingPoQty(line), 0);
    assert.ok(Math.abs(lineExcessOrderedQty(line) - 14.39) < 0.01);
  });

  it("rejects zero or negative qty", () => {
    assert.throws(
      () => validatePurchaseRequestPoLineQty(prLine(), 0),
      (err) => err.code === "PR_LINE_QTY_INVALID",
    );
    assert.throws(
      () => validatePurchaseRequestPoLineQty(prLine(), -5),
      (err) => err.code === "PR_LINE_QTY_INVALID",
    );
  });

  it("rejects when line already fully ordered", () => {
    assert.throws(
      () => validatePurchaseRequestPoLineQty(prLine({ orderedQty: 200 }), 10),
      (err) => err.code === "PR_LINE_ALREADY_ORDERED",
    );
  });
});
