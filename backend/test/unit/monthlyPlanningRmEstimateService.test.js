const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  canShowLiveRmEstimateStatus,
  getRmPlanningEstimate,
} = require("../../src/services/monthlyPlanningRmEstimateService");

function createEstimateDb({ status = "DRAFT", planLines = [] } = {}) {
  const db = {
    monthlyProductionPlan: {
      findUnique: async () => ({
        id: 5,
        status,
        currentRevision: 0,
        periodKey: "2026-07",
        planSequenceNo: 1,
        planKind: "INITIAL",
      }),
    },
    monthlyProductionPlanLine: {
      findMany: async () => planLines,
    },
    item: {
      findMany: async ({ where }) =>
        (where?.id?.in ?? []).map((id) => ({
          id,
          itemName: `RM-${id}`,
          unit: "Kg",
        })),
    },
    rmPlan: {
      create: async () => {
        throw new Error("rmPlan.create should not run for live estimate");
      },
    },
    rmPlanLine: {
      createMany: async () => {
        throw new Error("rmPlanLine.createMany should not run for live estimate");
      },
    },
  };

  return { db };
}

describe("monthlyPlanningRmEstimateService", () => {
  it("canShowLiveRmEstimateStatus is true only for draft and awaiting review", () => {
    assert.equal(canShowLiveRmEstimateStatus("DRAFT"), true);
    assert.equal(canShowLiveRmEstimateStatus("AWAITING_PURCHASE_REVIEW"), true);
    assert.equal(canShowLiveRmEstimateStatus("APPROVED"), false);
    assert.equal(canShowLiveRmEstimateStatus("LOCKED"), false);
  });

  it("calculates live estimate from all plannedFgQty lines (not green shortage only)", async () => {
    const planLines = [
      {
        id: 1,
        fgItemId: 10,
        plannedFgQty: "1500",
        fgItem: { id: 10, itemName: "Dummy Plug", unit: "Nos" },
      },
      {
        id: 2,
        fgItemId: 11,
        plannedFgQty: "7200",
        fgItem: { id: 11, itemName: "PVC Angle", unit: "Nos" },
      },
      {
        id: 3,
        fgItemId: 12,
        plannedFgQty: "500",
        fgItem: { id: 12, itemName: "Square Box", unit: "Nos" },
      },
    ];
    const { db } = createEstimateDb({ planLines });
    const deps = {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      aggregateRmDemandForFgLines: async (_db, fgLines) => {
        assert.equal(fgLines.length, 3);
        assert.deepEqual(
          fgLines.map((fg) => ({ fgItemId: fg.fgItemId, fgQty: fg.fgQty })),
          [
            { fgItemId: 10, fgQty: 1500 },
            { fgItemId: 11, fgQty: 7200 },
            { fgItemId: 12, fgQty: 500 },
          ],
        );
        return { rmNeeded: new Map([[201, 1260]]), missingChildBoms: [] };
      },
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 201,
          physicalUsableStockQty: 100,
          freeStockQty: 100,
          effectiveReservedQty: 10,
          incomingQty: 50,
          warnings: [],
        },
      ],
    };

    const res = await getRmPlanningEstimate({ db, planId: 5, deps });
    assert.equal(res.mode, "LIVE_ESTIMATE");
    assert.equal(res.exists, true);
    assert.equal(res.totalFgPlannedQty, 9200);
    assert.equal(res.totals.grossDemandTotal, 1260);
    assert.equal(res.totals.netRequirementTotal, 1160);
    assert.equal(res.lines.length, 1);
    assert.equal(Number(res.lines[0].grossDemandQty), 1260);
    assert.equal(Number(res.lines[0].netRequirementQty), 1160);
  });

  it("reflects updated plannedFgQty on subsequent estimate reads", async () => {
    let plannedQty = "700";
    const { db } = createEstimateDb();
    db.monthlyProductionPlanLine.findMany = async () => [
      {
        id: 1,
        fgItemId: 10,
        plannedFgQty: plannedQty,
        fgItem: { id: 10, itemName: "FG-A", unit: "Nos" },
      },
    ];
    const deps = {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      aggregateRmDemandForFgLines: async (_db, fgLines) => ({
        rmNeeded: new Map([[201, Number(fgLines[0].fgQty)]]),
        missingChildBoms: [],
      }),
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 201,
          physicalUsableStockQty: 0,
          freeStockQty: 0,
          effectiveReservedQty: 0,
          incomingQty: 0,
          warnings: [],
        },
      ],
    };

    const first = await getRmPlanningEstimate({ db, planId: 5, deps });
    assert.equal(first.totals.grossDemandTotal, 700);

    plannedQty = "12000";
    const second = await getRmPlanningEstimate({ db, planId: 5, deps });
    assert.equal(second.totals.grossDemandTotal, 12000);
  });

  it("FT-PD-067: live estimate uses customer demand plus selected GL replenishment only", async () => {
    const planLines = [
      {
        id: 1,
        fgItemId: 10,
        plannedFgQty: "1300",
        customerProductionQty: "1000",
        greenReplenishmentQty: "300",
        fgItem: { id: 10, itemName: "FG-A", unit: "Nos" },
      },
      {
        id: 2,
        fgItemId: 11,
        plannedFgQty: "2500",
        customerProductionQty: "2000",
        greenReplenishmentQty: "0",
        fgItem: { id: 11, itemName: "FG-B", unit: "Nos" },
      },
    ];
    const { db } = createEstimateDb({ planLines });
    const deps = {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      aggregateRmDemandForFgLines: async (_db, fgLines) => {
        assert.deepEqual(
          fgLines.map((fg) => ({ fgItemId: fg.fgItemId, fgQty: fg.fgQty })),
          [
            { fgItemId: 10, fgQty: 1300 },
            { fgItemId: 11, fgQty: 2000 },
          ],
        );
        return { rmNeeded: new Map([[201, 3300]]), missingChildBoms: [] };
      },
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 201,
          physicalUsableStockQty: 0,
          freeStockQty: 0,
          effectiveReservedQty: 0,
          incomingQty: 0,
          warnings: [],
        },
      ],
    };

    const res = await getRmPlanningEstimate({ db, planId: 5, deps });
    assert.equal(res.totalFgPlannedQty, 3300);
    assert.equal(res.totals.grossDemandTotal, 3300);
  });

  it("FT-PD-067: GL-only shortage with no customer or selection produces no RM estimate", async () => {
    const { db } = createEstimateDb({
      planLines: [
        {
          id: 1,
          fgItemId: 10,
          plannedFgQty: "0",
          customerProductionQty: "0",
          greenReplenishmentQty: "0",
          fgItem: { id: 10, itemName: "FG-A", unit: "Nos" },
        },
      ],
    });
    const res = await getRmPlanningEstimate({ db, planId: 5, deps: {} });
    assert.equal(res.exists, false);
    assert.equal(res.totalFgPlannedQty, 0);
    assert.deepEqual(res.lines, []);
  });

  async function estimateGrossForFtPd067(planLines, expectedFgLines) {
    const { db } = createEstimateDb({ planLines });
    const deps = {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      aggregateRmDemandForFgLines: async (_db, fgLines) => {
        assert.deepEqual(
          fgLines.map((fg) => ({ fgItemId: fg.fgItemId, fgQty: fg.fgQty })),
          expectedFgLines,
        );
        const gross = fgLines.reduce((sum, fg) => sum + Number(fg.fgQty) * 0.1, 0);
        return { rmNeeded: new Map([[201, gross]]), missingChildBoms: [] };
      },
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 201,
          physicalUsableStockQty: 0,
          freeStockQty: 0,
          effectiveReservedQty: 0,
          incomingQty: 0,
          warnings: [],
        },
      ],
    };
    const res = await getRmPlanningEstimate({ db, planId: 5, deps });
    return res.totals.grossDemandTotal;
  }

  it("FT-PD-067: customer only RM excludes unselected GL", async () => {
    const gross = await estimateGrossForFtPd067(
      [
        { id: 1, fgItemId: 10, plannedFgQty: "1500", customerProductionQty: "1000", greenReplenishmentQty: "0", fgItem: { id: 10, itemName: "FG-A", unit: "Nos" } },
        { id: 2, fgItemId: 11, plannedFgQty: "2600", customerProductionQty: "2000", greenReplenishmentQty: "0", fgItem: { id: 11, itemName: "FG-B", unit: "Nos" } },
      ],
      [
        { fgItemId: 10, fgQty: 1000 },
        { fgItemId: 11, fgQty: 2000 },
      ],
    );
    assert.equal(gross, 300);
  });

  it("FT-PD-067: selecting one GL item increases RM for that item only", async () => {
    const gross = await estimateGrossForFtPd067(
      [
        { id: 1, fgItemId: 10, plannedFgQty: "1500", customerProductionQty: "1000", greenReplenishmentQty: "500", fgItem: { id: 10, itemName: "FG-A", unit: "Nos" } },
        { id: 2, fgItemId: 11, plannedFgQty: "2600", customerProductionQty: "2000", greenReplenishmentQty: "0", fgItem: { id: 11, itemName: "FG-B", unit: "Nos" } },
      ],
      [
        { fgItemId: 10, fgQty: 1500 },
        { fgItemId: 11, fgQty: 2000 },
      ],
    );
    assert.equal(gross, 350);
  });

  it("FT-PD-067: selecting all GL items increases RM for all selected BOMs", async () => {
    const gross = await estimateGrossForFtPd067(
      [
        { id: 1, fgItemId: 10, plannedFgQty: "1500", customerProductionQty: "1000", greenReplenishmentQty: "500", fgItem: { id: 10, itemName: "FG-A", unit: "Nos" } },
        { id: 2, fgItemId: 11, plannedFgQty: "2600", customerProductionQty: "2000", greenReplenishmentQty: "600", fgItem: { id: 11, itemName: "FG-B", unit: "Nos" } },
      ],
      [
        { fgItemId: 10, fgQty: 1500 },
        { fgItemId: 11, fgQty: 2600 },
      ],
    );
    assert.equal(gross, 410);
  });

  it("FT-PD-067: deselect all returns RM to customer-only", async () => {
    const gross = await estimateGrossForFtPd067(
      [
        { id: 1, fgItemId: 10, plannedFgQty: "1000", customerProductionQty: "1000", greenReplenishmentQty: "0", fgItem: { id: 10, itemName: "FG-A", unit: "Nos" } },
        { id: 2, fgItemId: 11, plannedFgQty: "2000", customerProductionQty: "2000", greenReplenishmentQty: "0", fgItem: { id: 11, itemName: "FG-B", unit: "Nos" } },
      ],
      [
        { fgItemId: 10, fgQty: 1000 },
        { fgItemId: 11, fgQty: 2000 },
      ],
    );
    assert.equal(gross, 300);
  });

  it("rejects estimate for approved plans (frozen snapshot path only)", async () => {
    const { db } = createEstimateDb({ status: "APPROVED", planLines: [] });
    await assert.rejects(
      () => getRmPlanningEstimate({ db, planId: 5, deps: {} }),
      (e) => e.code === "PLAN_NOT_ESTIMATABLE",
    );
  });

  it("surfaces missing FG BOM and child BOM warnings without persisting snapshot", async () => {
    const { db } = createEstimateDb({
      planLines: [
        {
          id: 1,
          fgItemId: 10,
          plannedFgQty: "100",
          fgItem: { id: 10, itemName: "No BOM FG", unit: "Nos" },
        },
        {
          id: 2,
          fgItemId: 11,
          plannedFgQty: "200",
          fgItem: { id: 11, itemName: "FG-B", unit: "Nos" },
        },
      ],
    });
    const deps = {
      loadApprovedBomWithLines: async (_db, fgItemId) =>
        fgItemId === 10 ? null : { id: 2, lines: [{ id: 1 }] },
      aggregateRmDemandForFgLines: async () => ({
        rmNeeded: new Map([[201, 40]]),
        missingChildBoms: [{ sfgItemId: 60, sfgName: "Sub-assembly" }],
      }),
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 201,
          physicalUsableStockQty: 0,
          freeStockQty: 0,
          effectiveReservedQty: 0,
          incomingQty: 0,
          warnings: [],
        },
      ],
    };

    const res = await getRmPlanningEstimate({ db, planId: 5, deps });
    assert.equal(res.planWarnings.missingFgBoms.length, 1);
    assert.equal(res.planWarnings.missingFgBoms[0].fgItemName, "No BOM FG");
    assert.equal(res.planWarnings.missingChildBoms.length, 1);
    assert.equal(res.planWarnings.missingChildBoms[0].sfgName, "Sub-assembly");
  });
});
