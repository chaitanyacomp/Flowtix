const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateRegularSoLineDemandCoverage,
  regularSoAdditionalProductionBlock,
  assertRegularSoAdditionalProductionAllowed,
} = require("../../src/services/regularSoProductionClosure");
const {
  getProductionBatchQcPendingQty,
  getSoItemQcApprovedRemainingQty,
  buildDispatchableQtyBySalesOrderLineId,
} = require("../../src/services/reportMetrics");

describe("regularSoProductionClosure", () => {
  it("SO 10000 / WO 10100 / Produced 10025 — SO covered, WO remainder not mandatory", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 10025,
      woPlannedQty: 10100,
    });
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.woPlanMet, false);
    assert.equal(c.productionObligationMet, true);
    assert.equal(c.hasSoShortage, false);
    assert.equal(c.canEndProductionWithWoRemainder, true);
    assert.equal(c.woTargetBalance, 75);
    assert.equal(c.expectedExcessBeforeQc, 25);
    assert.equal(c.soShortageQty, 0);
  });

  it("produced equal to SO qty covers demand even with WO target remaining", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 10000,
      woPlannedQty: 10100,
    });
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.woTargetBalance, 100);
    assert.equal(c.expectedExcessBeforeQc, 0);
    assert.equal(c.canEndProductionWithWoRemainder, true);
  });

  it("produced below SO demand — shortage path, not WO-plan-only shortfall", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 9000,
      woPlannedQty: 10100,
    });
    assert.equal(c.soDemandCovered, false);
    assert.equal(c.productionObligationMet, false);
    assert.equal(c.hasSoShortage, true);
    assert.equal(c.soShortageQty, 1000);
    assert.equal(c.woTargetBalance, 1100);
    assert.equal(c.canEndProductionWithWoRemainder, false);
  });

  it("accounts for other WO produced qty when computing remaining SO demand", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 4000,
      producedOnThisWo: 6000,
      woPlannedQty: 6100,
    });
    assert.equal(c.remainingSoDemand, 6000);
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.expectedExcessBeforeQc, 0);
    assert.equal(c.productionObligationMet, true);
  });

  it("WO plan met without SO excess still completes obligation", () => {
    const c = evaluateRegularSoLineDemandCoverage({
      soDemandQty: 10000,
      producedOnOtherWos: 0,
      producedOnThisWo: 10100,
      woPlannedQty: 10100,
    });
    assert.equal(c.woPlanMet, true);
    assert.equal(c.soDemandCovered, true);
    assert.equal(c.productionObligationMet, true);
    assert.equal(c.canEndProductionWithWoRemainder, false);
    assert.equal(c.expectedExcessBeforeQc, 100);
  });
});

describe("regularSoAdditionalProductionBlock", () => {
  it("allows additional production while produced is below SO qty", () => {
    assert.equal(
      regularSoAdditionalProductionBlock(
        {
          soDemandCovered: false,
          reportPending: false,
          lines: [{ workOrderLineId: 10, soDemandCovered: false }],
        },
        10,
      ),
      null,
    );
  });

  it("rejects additional production when produced equals SO qty", () => {
    const block = regularSoAdditionalProductionBlock(
      {
        soDemandCovered: true,
        reportPending: false,
        lines: [{ workOrderLineId: 10, soDemandCovered: true }],
      },
      10,
    );
    assert.equal(block?.code, "REGULAR_SO_DEMAND_COVERED");
  });

  it("rejects additional production when produced is above SO qty", () => {
    const block = regularSoAdditionalProductionBlock(
      {
        soDemandCovered: true,
        reportPending: false,
        lines: [{ workOrderLineId: 10, soDemandCovered: true }],
      },
      10,
    );
    assert.equal(block?.code, "REGULAR_SO_DEMAND_COVERED");
  });

  it("rejects additional production after End Production parks report-pending", () => {
    const block = regularSoAdditionalProductionBlock(
      {
        soDemandCovered: true,
        reportPending: true,
        lines: [{ workOrderLineId: 10, soDemandCovered: true }],
      },
      10,
    );
    assert.equal(block?.code, "REGULAR_SO_PRODUCTION_LOCKED_REPORT_PENDING");
  });
});

function createRegularCoverageDb({ produced, soQty, woQty, orderType = "NORMAL", sourceType = "CUSTOMER_REQUIREMENT" }) {
  return {
    workOrderLine: {
      findUnique: async () => ({
        id: 10,
        workOrderId: 5,
        workOrder: {
          id: 5,
          requirementSheetId: null,
          sourceType,
          salesOrder: { id: 2, orderType },
        },
      }),
      findMany: async () => [],
    },
    workOrder: {
      findUnique: async () => ({
        id: 5,
        docNo: "WO-1",
        status: "IN_PROGRESS",
        requirementSheetId: null,
        cycleId: null,
        sourceType,
        salesOrderId: 2,
        salesOrder: { id: 2, docNo: "SO-1", orderType },
        lines: [{ id: 10, qty: String(woQty), plannedQty: String(woQty), fgItemId: 1 }],
        productionExecution: { executionStatus: "RUNNING" },
        productionReports: [],
      }),
    },
    salesOrder: {
      findUnique: async () => ({
        orderType,
        lines: [{ qty: String(soQty), customerPoQty: String(soQty), itemId: 1 }],
      }),
    },
    productionEntry: {
      groupBy: async () => [{ workOrderLineId: 10, _sum: { producedQty: String(produced) } }],
    },
  };
}

describe("assertRegularSoAdditionalProductionAllowed", () => {
  it("allows a new REGULAR_SO batch while finalized production is below SO qty", async () => {
    await assertRegularSoAdditionalProductionAllowed(
      createRegularCoverageDb({ produced: 9900, soQty: 10000, woQty: 10100 }),
      10,
    );
  });

  it("rejects a new REGULAR_SO batch after finalized production covers SO qty", async () => {
    await assert.rejects(
      () =>
        assertRegularSoAdditionalProductionAllowed(
          createRegularCoverageDb({ produced: 10000, soQty: 10000, woQty: 10100 }),
          10,
        ),
      (err) => err.code === "REGULAR_SO_DEMAND_COVERED" && err.statusCode === 409,
    );
  });

  it("rejects a new REGULAR_SO batch when finalized production exceeds SO qty", async () => {
    await assert.rejects(
      () =>
        assertRegularSoAdditionalProductionAllowed(
          createRegularCoverageDb({ produced: 10025, soQty: 10000, woQty: 10100 }),
          10,
        ),
      (err) => err.code === "REGULAR_SO_DEMAND_COVERED",
    );
  });

  it("is a no-op for NO_QTY work orders", async () => {
    await assertRegularSoAdditionalProductionAllowed(
      createRegularCoverageDb({ produced: 10025, soQty: 10000, woQty: 10100, orderType: "NO_QTY" }),
      10,
    );
  });
});

describe("REGULAR_SO QC and dispatch after SO coverage excess", () => {
  it("QC pending uses the full produced quantity including excess above SO", () => {
    assert.equal(getProductionBatchQcPendingQty(10025, 0, 0), 10025);
    assert.equal(getProductionBatchQcPendingQty(10025, 10025, 0), 0);
  });

  it("dispatch caps at remaining SO qty and leaves QC-accepted excess as unallocated FG", () => {
    const soQty = 10000;
    const qcAccepted = 10025;
    const onHand = 10025;
    const byLine = buildDispatchableQtyBySalesOrderLineId({
      orderLineInputs: [{ id: 1, itemId: 10, qty: soQty }],
      dispatchRecords: [],
      orderType: "NORMAL",
      onHandByItemId: new Map([[10, onHand]]),
      qcAcceptedTotalByItemId: new Map([[10, qcAccepted]]),
    });
    assert.equal(byLine.get(1), 10000);
    assert.equal(getSoItemQcApprovedRemainingQty(qcAccepted, 0), 10025);
    const leftoverFgAfterSoDispatch = getSoItemQcApprovedRemainingQty(qcAccepted, soQty);
    assert.equal(leftoverFgAfterSoDispatch, 25);
  });
});
