const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  outstandingProcurement,
  isProcurementBalanceSatisfied,
  deriveProcurementStatusLabel,
  derivePoProcurementClosureKind,
} = require("../../src/services/procurementQtyMath");

describe("procurementQtyMath", () => {
  it("outstanding = required - received - shortClosed", () => {
    assert.equal(outstandingProcurement(100, 40, 10), 50);
    assert.equal(outstandingProcurement(100, 100, 0), 0);
    assert.equal(outstandingProcurement(100, 60, 40), 0);
  });

  it("marks short-closed partial receipt as PARTIALLY_PROCURED_SHORT_CLOSED", () => {
    const status = deriveProcurementStatusLabel({
      targetQty: 100,
      receivedQty: 60,
      shortClosedQty: 40,
    });
    assert.equal(status, "PARTIALLY_PROCURED_SHORT_CLOSED");
    assert.equal(isProcurementBalanceSatisfied(100, 60, 40), true);
  });

  it("derives PO closure kind from line shortClosedQty", () => {
    const lines = [{ id: 1, qty: 100, shortClosedQty: 40 }];
    const receivedByLine = new Map([[1, 60]]);
    assert.equal(derivePoProcurementClosureKind("COMPLETED", lines, receivedByLine), "SHORT_CLOSED");
    assert.equal(
      derivePoProcurementClosureKind("COMPLETED", [{ id: 1, qty: 100, shortClosedQty: 0 }], new Map([[1, 100]])),
      "FULL_RECEIPT",
    );
  });
});
