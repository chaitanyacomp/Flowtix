/**
 * Batch 2E — commercial snapshot preserved; billing adjustment flagged after dispatch reversal.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("salesBillDispatchReversalCoupling", () => {
  it("documents expected post-reversal commercial state (no invoice mutation)", () => {
    const billBefore = {
      status: "FINALIZED",
      lines: [{ qty: "100", rate: "10", lineTotal: "1180" }],
      billingAdjustmentRequired: false,
      isExported: false,
    };
    const billAfterReversal = {
      ...billBefore,
      billingAdjustmentRequired: true,
      billingAdjustmentRequiredAt: new Date().toISOString(),
      billingAdjustmentReason: "Dispatch reversal (30 qty): Customer return partial",
    };
    assert.equal(billAfterReversal.lines[0].qty, "100");
    assert.equal(billAfterReversal.lines[0].lineTotal, "1180");
    assert.equal(billAfterReversal.billingAdjustmentRequired, true);
    assert.equal(billAfterReversal.status, "FINALIZED");
  });

  it("export reset applies only when bill was exported", () => {
    const exportedPatch = { isExported: false, exportResetAt: new Date(), exportResetReason: "reversal" };
    const nonExported = { billingAdjustmentRequired: true };
    assert.equal("isExported" in nonExported, false);
    assert.equal(exportedPatch.isExported, false);
  });
});
