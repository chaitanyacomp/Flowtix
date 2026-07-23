const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");

describe("createPurchaseRequestFromRegularSalesOrder — NO_QTY protection", () => {
  it("rejects NO_QTY sales orders without creating MR/PR", async () => {
    mock.reset();
    // Fresh require after mocks would be ideal; call with injected db instead.
    const { createPurchaseRequestFromRegularSalesOrder } = require("../../src/services/regularSoPurchaseRequestService");
    const db = {
      salesOrder: {
        findUnique: async () => ({ id: 99, docNo: "SO-NQ-1", orderType: "NO_QTY" }),
      },
      materialRequirement: {
        findFirst: async () => {
          throw new Error("should not look up MR for NO_QTY");
        },
      },
    };
    await assert.rejects(
      () =>
        createPurchaseRequestFromRegularSalesOrder(
          { salesOrderId: 99 },
          { userId: 1, role: "STORE" },
          db,
        ),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "REGULAR_SO_ONLY");
        return true;
      },
    );
  });
});
