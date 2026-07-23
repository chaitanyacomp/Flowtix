const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  regularProductionReportQueueProjection,
} = require("../../src/services/dashboardQueueSnapshots");

describe("REGULAR_SO confirmed production report queue projection", () => {
  it("does not treat stale SHORTFALL_PENDING as Report Pending after confirmation", () => {
    const projected = regularProductionReportQueueProjection({
      orderType: "NORMAL",
      executionStatus: "SHORTFALL_PENDING",
      confirmedReport: { id: 197, status: "CONFIRMED" },
      hasPendingQc: true,
    });
    assert.deepEqual(projected, {
      finalized: true,
      reportPending: false,
      nextAction: "QC_PENDING",
    });
  });

  it("keeps a genuinely unfinished Regular report pending", () => {
    const projected = regularProductionReportQueueProjection({
      orderType: "NORMAL",
      executionStatus: "SHORTFALL_PENDING",
      confirmedReport: null,
      hasPendingQc: true,
    });
    assert.deepEqual(projected, {
      finalized: false,
      reportPending: true,
      nextAction: null,
    });
  });

  it("does not change NO_QTY report and recovery semantics", () => {
    const projected = regularProductionReportQueueProjection({
      orderType: "NO_QTY",
      executionStatus: "SHORTFALL_PENDING",
      confirmedReport: { id: 999, status: "CONFIRMED" },
      hasPendingQc: true,
    });
    assert.deepEqual(projected, {
      finalized: false,
      reportPending: false,
      nextAction: null,
    });
  });
});
