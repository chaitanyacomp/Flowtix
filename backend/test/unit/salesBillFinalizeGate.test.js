const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { assertDispatchEligibleForBillingFinalize } = require("../../src/services/salesBillEligibility");

describe("assertDispatchEligibleForBillingFinalize", () => {
  it("rejects UNLOCKED dispatch", async () => {
    const tx = {
      dispatch: {
        findUnique: async () => ({
          id: 1,
          reversalOfId: null,
          workflowStatus: "UNLOCKED",
          dispatchedQty: "50",
        }),
      },
    };
    await assert.rejects(
      () => assertDispatchEligibleForBillingFinalize(tx, 1),
      (err) => err.statusCode === 409 && /locked/i.test(err.message),
    );
  });

  it("accepts LOCKED forward dispatch with positive qty", async () => {
    const row = {
      id: 1,
      reversalOfId: null,
      workflowStatus: "LOCKED",
      dispatchedQty: "50",
    };
    const tx = {
      dispatch: { findUnique: async () => row },
    };
    const out = await assertDispatchEligibleForBillingFinalize(tx, 1);
    assert.equal(out.id, 1);
  });

  it("rejects reversal dispatch rows", async () => {
    const tx = {
      dispatch: {
        findUnique: async () => ({
          id: 2,
          reversalOfId: 1,
          workflowStatus: "LOCKED",
          dispatchedQty: "-10",
        }),
      },
    };
    await assert.rejects(
      () => assertDispatchEligibleForBillingFinalize(tx, 2),
      (err) => err.statusCode === 409,
    );
  });
});
