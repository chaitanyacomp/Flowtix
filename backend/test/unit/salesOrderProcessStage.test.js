const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolvePostDispatchProcessStage } = require("../../src/services/salesOrderProcessStage");

describe("salesOrderProcessStage commercial handoff", () => {
  it("keeps pending dispatch as dispatch work", () => {
    const dispatchSummary = {
      totalOrdered: 100,
      totalDispatched: 40,
      totalPending: 60,
      fullyDispatched: false,
    };
    assert.equal(dispatchSummary.fullyDispatched, false);
  });

  it("maps dispatch-complete but bill-pending SO to Sales Bill pending", () => {
    const stage = resolvePostDispatchProcessStage(
      {
        totalOrdered: 100,
        totalDispatched: 100,
        totalPending: 0,
        fullyDispatched: true,
      },
      0,
    );
    assert.deepEqual(stage, { key: "SALES_BILL_PENDING", label: "Sales Bill pending" });
  });

  it("maps fully billed SO to completed", () => {
    const stage = resolvePostDispatchProcessStage(
      {
        totalOrdered: 100,
        totalDispatched: 100,
        totalPending: 0,
        fullyDispatched: true,
      },
      100,
    );
    assert.deepEqual(stage, { key: "COMPLETED", label: "Completed" });
  });
});
