/**
 * NO_QTY vs REGULAR_SO Production Report confirm/close branching.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveProductionReportConfirmCloseAction,
} = require("../../src/services/productionReportConfirmClosePolicy");

describe("resolveProductionReportConfirmCloseAction", () => {
  it("NO_QTY confirm+close with shortage finishes execution and flags recovery create", () => {
    const plan = resolveProductionReportConfirmCloseAction({
      salesOrderOrderType: "NO_QTY",
      closeWorkOrder: true,
      executionStatus: "IN_PROGRESS",
      remainderQty: 28,
    });
    assert.equal(plan.flow, "NO_QTY");
    assert.equal(plan.action, "FINISH_PRODUCTION_EXECUTION");
    assert.equal(plan.shortfallOutcome, "CARRY_FORWARD");
    assert.equal(plan.createsNoQtyShortageRecovery, true);
  });

  it("NO_QTY exact shortage uses WO planned − finalized production remainder", () => {
    const planned = 2000;
    const finalized = 1972;
    const shortage = Math.max(0, planned - finalized);
    assert.equal(shortage, 28);
    const plan = resolveProductionReportConfirmCloseAction({
      salesOrderOrderType: "NO_QTY",
      closeWorkOrder: true,
      executionStatus: "ACTIVE",
      remainderQty: shortage,
    });
    assert.equal(plan.shortfallOutcome, "CARRY_FORWARD");
    assert.equal(plan.createsNoQtyShortageRecovery, true);
  });

  it("NO_QTY full complete does not request shortfall outcome", () => {
    const plan = resolveProductionReportConfirmCloseAction({
      salesOrderOrderType: "NO_QTY",
      closeWorkOrder: true,
      executionStatus: "IN_PROGRESS",
      remainderQty: 0,
    });
    assert.equal(plan.action, "FINISH_PRODUCTION_EXECUTION");
    assert.equal(plan.shortfallOutcome, null);
    assert.equal(plan.createsNoQtyShortageRecovery, false);
  });

  it("REGULAR_SO never creates NO_QTY shortage recovery (permanent close path)", () => {
    for (const orderType of ["NORMAL", "REGULAR", "REGULAR_SO", "REPLACEMENT"]) {
      const plan = resolveProductionReportConfirmCloseAction({
        salesOrderOrderType: orderType,
        closeWorkOrder: true,
        executionStatus: "SHORTFALL_PENDING",
        remainderQty: 28,
      });
      assert.equal(plan.flow, "REGULAR_SO");
      assert.equal(plan.action, "REGULAR_REPORT_CLOSE");
      assert.equal(plan.shortfallOutcome, null);
      assert.equal(plan.createsNoQtyShortageRecovery, false);
    }
  });

  it("GREEN_LEVEL finishes with CARRY_FORWARD but does not create NO_QTY recovery", () => {
    const plan = resolveProductionReportConfirmCloseAction({
      salesOrderOrderType: "NORMAL",
      isGreenLevel: true,
      closeWorkOrder: true,
      executionStatus: "IN_PROGRESS",
      remainderQty: 10,
    });
    assert.equal(plan.flow, "GREEN_LEVEL");
    assert.equal(plan.action, "FINISH_PRODUCTION_EXECUTION");
    assert.equal(plan.shortfallOutcome, "CARRY_FORWARD");
    assert.equal(plan.createsNoQtyShortageRecovery, false);
  });

  it("already completed execution is a no-op for NO_QTY close (idempotent retry)", () => {
    const plan = resolveProductionReportConfirmCloseAction({
      salesOrderOrderType: "NO_QTY",
      closeWorkOrder: true,
      executionStatus: "COMPLETED",
      remainderQty: 28,
    });
    assert.equal(plan.action, "NOOP");
    assert.equal(plan.createsNoQtyShortageRecovery, false);
  });
});
