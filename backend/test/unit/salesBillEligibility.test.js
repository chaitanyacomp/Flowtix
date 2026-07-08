const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  activeBillDispatchKeyForBill,
  pickPrimaryBillForDispatch,
  isPositiveDispatchQty,
  isActiveSalesBillRecord,
  BILLABLE_FORWARD_DISPATCH_WHERE,
} = require("../../src/services/salesBillEligibility");

describe("salesBillEligibility", () => {
  it("activeBillDispatchKey is dispatchId only for active DRAFT/FINALIZED bills", () => {
    assert.equal(activeBillDispatchKeyForBill(42, "DRAFT", null), 42);
    assert.equal(activeBillDispatchKeyForBill(42, "FINALIZED", null), 42);
    assert.equal(activeBillDispatchKeyForBill(42, "CANCELLED", new Date()), null);
    assert.equal(activeBillDispatchKeyForBill(42, "FINALIZED", new Date()), null);
  });

  it("pickPrimaryBillForDispatch prefers DRAFT over FINALIZED and ignores CANCELLED", () => {
    const primary = pickPrimaryBillForDispatch([
      { id: 1, dispatchId: 9, status: "CANCELLED", cancelledAt: new Date(), isExported: false },
      { id: 2, dispatchId: 9, status: "FINALIZED", cancelledAt: null, isExported: true, billingAdjustmentRequired: true },
      { id: 3, dispatchId: 9, status: "DRAFT", cancelledAt: null, isExported: false, billingAdjustmentRequired: false },
    ]);
    assert.equal(primary?.id, 3);
  });

  it("isPositiveDispatchQty uses billing epsilon", () => {
    assert.equal(isPositiveDispatchQty(1), true);
    assert.equal(isPositiveDispatchQty(0), false);
    assert.equal(isPositiveDispatchQty("10.5"), true);
  });

  it("isActiveSalesBillRecord matches DRAFT/FINALIZED without cancel", () => {
    assert.equal(isActiveSalesBillRecord("DRAFT", null), true);
    assert.equal(isActiveSalesBillRecord("FINALIZED", null), true);
    assert.equal(isActiveSalesBillRecord("CANCELLED", null), false);
  });

  it("BILLABLE_FORWARD_DISPATCH_WHERE requires LOCKED forward rows", () => {
    assert.equal(BILLABLE_FORWARD_DISPATCH_WHERE.workflowStatus, "LOCKED");
    assert.equal(BILLABLE_FORWARD_DISPATCH_WHERE.reversalOfId, null);
  });
});
