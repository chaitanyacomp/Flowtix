const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  calculateRegularSoDemandCoverageLine,
} = require("../../src/services/materialAvailabilityService");
const {
  applyRegularSoWoDemandCoverage,
} = require("../../src/services/materialAvailabilityWorkspaceService");
const {
  buildRmSummaryLineFromAvailability,
  loadRegularSoOpenIncomingByItem,
  materialPlanningOperationalState,
} = require("../../src/services/materialPlanningService");

function availability(overrides = {}) {
  return {
    requiredQty: 211.05,
    physicalUsableStockQty: 225,
    freeStockQty: 15,
    effectiveReservedQty: 210,
    reservationBreakdown: [],
    ...overrides,
  };
}

describe("REGULAR_SO demand coverage", () => {
  it("uses Prisma's legacy-compatible WORK_ORDER_PLANNING enum for SO-26-0001 incoming supply", async () => {
    let capturedWhere = null;
    const incoming = await loadRegularSoOpenIncomingByItem(
      {
        materialRequirementLine: {
          findMany: async (query) => {
            capturedWhere = query.where;
            return [];
          },
        },
      },
      { salesOrderId: 263, workOrderId: 638 },
    );

    assert.deepEqual(
      capturedWhere.materialRequirement.sourceType.in,
      ["SALES_ORDER", "WORK_ORDER_PLANNING"],
    );
    assert.deepEqual(capturedWhere.materialRequirement.OR, [
      { workOrderId: 638 },
      { workOrderId: null, salesOrderId: 263 },
    ]);
    assert.equal(incoming.size, 0);
  });

  it("projects the SO-26-0001 legacy PMR state consistently in RM Control Center", () => {
    const row = applyRegularSoWoDemandCoverage(
      {
        itemId: 93,
        requiredQty: { toString: () => "211.05" },
        physicalUsableStockQty: { toString: () => "14" },
        freeStockQty: 14,
        effectiveReservedQty: null,
        reservationBreakdown: undefined,
        incomingQty: null,
      },
      {
        id: 638,
        salesOrderId: 263,
        salesOrder: { orderType: "NORMAL" },
      },
      {
        openPmrs: [
          {
            status: "SHORT_ISSUE_ACCEPTED",
            lines: [{ rmItemId: 93, issuedQty: { toString: () => "211" } }],
          },
        ],
      },
    );

    assert.equal(row.issuedToProductionQty, 211);
    assert.equal(row.freeAvailableQty, 14);
    assert.equal(row.coveredQty, 225);
    assert.equal(row.remainingIssueBalanceQty, 0.05);
    assert.equal(row.uncoveredProcurementQty, 0);
    assert.equal(row.shortageAfterReservationQty, 0);
    assert.equal(row.netShortageAfterIncomingQty, 0);
  });

  it("uses this-WO reservation and eligible free stock once", () => {
    const row = calculateRegularSoDemandCoverageLine({
      availability: availability({
        reservationBreakdown: [
          { workOrderId: 638, salesOrderId: 263, reservedQty: 210 },
        ],
      }),
      salesOrderId: 263,
      workOrderId: 638,
    });
    assert.equal(row.reservedForThisWoQty, 210);
    assert.equal(row.freeAvailableQty, 15);
    assert.equal(row.coveredQty, 225);
    assert.equal(row.uncoveredProcurementQty, 0);
    assert.equal(row.remainingIssueBalanceQty, 211.05);
  });

  it("does not use another demand's reservation", () => {
    const row = calculateRegularSoDemandCoverageLine({
      availability: availability({
        reservationBreakdown: [
          { workOrderId: 999, salesOrderId: 999, reservedQty: 210 },
        ],
      }),
      salesOrderId: 263,
      workOrderId: 638,
    });
    assert.equal(row.reservedForOtherDemandQty, 210);
    assert.equal(row.coveredQty, 15);
    assert.equal(row.uncoveredProcurementQty, 196.05);
  });

  it("uses free stock alone when no reservation exists", () => {
    const row = calculateRegularSoDemandCoverageLine({
      availability: availability({
        physicalUsableStockQty: 100,
        freeStockQty: 100,
        effectiveReservedQty: 0,
      }),
      salesOrderId: 263,
      workOrderId: 638,
    });
    assert.equal(row.coveredQty, 100);
    assert.equal(row.uncoveredProcurementQty, 111.05);
  });

  it("adds net issue outside store stock without double counting", () => {
    const row = calculateRegularSoDemandCoverageLine({
      availability: availability({
        physicalUsableStockQty: 125,
        freeStockQty: 15,
        effectiveReservedQty: 110,
        reservationBreakdown: [
          { workOrderId: 638, salesOrderId: 263, reservedQty: 110 },
        ],
      }),
      salesOrderId: 263,
      workOrderId: 638,
      netIssuedQty: 100,
    });
    assert.equal(row.coveredQty, 225);
    assert.equal(row.uncoveredProcurementQty, 0);
    assert.equal(row.remainingIssueBalanceQty, 111.05);
  });

  it("projects the confirmed 211 Kg post-issue case without a duplicate procurement gap", () => {
    const row = buildRmSummaryLineFromAvailability({
      rmItemId: 501,
      requiredQty: 211.05,
      item: { itemName: "RM Resin", unit: "Kg" },
      availability: availability({
        physicalUsableStockQty: 14,
        freeStockQty: 14,
        effectiveReservedQty: 0,
        reservationBreakdown: [],
      }),
      demandScope: { salesOrderId: 263, workOrderId: 638 },
      issuePosition: {
        cumulativeIssuedQty: 211,
        cumulativeReturnedQty: 0,
        netIssuedQty: 211,
        roundingToleranceAcknowledged: true,
      },
    });

    assert.equal(row.requiredQty, 211.05);
    assert.equal(row.netIssuedQty, 211);
    assert.equal(row.freeAvailableQty, 14);
    assert.equal(row.reservedForThisWoQty, 0);
    assert.equal(row.coveredQty, 225);
    assert.equal(row.uncoveredProcurementQty, 0);
    assert.equal(row.shortageQty, 0);
    assert.equal(row.remainingIssueBalanceQty, 0.05);
    assert.equal(row.approvedRoundingDifferenceQty, 0.05);
    assert.equal(row.status, "AVAILABLE");

    const operational = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "OPEN" },
      readiness: {
        rmSummary: [row],
        allRmAvailable: true,
        hasMissingBom: false,
        hasMissingChildBom: false,
      },
      activeMaterialRequirement: null,
      cancelledMaterialRequirement: null,
      procurementCompleted: true,
    });
    assert.equal(operational.purchaseRequiredCount, 0);
    assert.equal(operational.pendingProcurementQty, 0);
    assert.equal(operational.readyForProduction, true);
    assert.equal(operational.currentStage, "Procurement Complete – RM Issued / Ready for Production");
  });

  it("keeps issue balance partial while covered stock prevents a duplicate PR", () => {
    const row = buildRmSummaryLineFromAvailability({
      rmItemId: 501,
      requiredQty: 211.05,
      item: { itemName: "RM Resin", unit: "Kg" },
      availability: availability({
        physicalUsableStockQty: 125,
        freeStockQty: 15,
        effectiveReservedQty: 110,
        reservationBreakdown: [{ workOrderId: 638, salesOrderId: 263, reservedQty: 110 }],
      }),
      demandScope: { salesOrderId: 263, workOrderId: 638 },
      issuePosition: { netIssuedQty: 100, cumulativeReturnedQty: 0 },
    });
    assert.equal(row.uncoveredProcurementQty, 0);
    assert.equal(row.shortageQty, 0);
    assert.equal(row.remainingIssueBalanceQty, 111.05);
    assert.equal(row.status, "AVAILABLE");
  });
});
