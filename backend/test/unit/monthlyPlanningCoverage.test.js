const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAdditionalRequirementQty,
  sumApprovedPlannedFgByItem,
  mapCoverageItem,
  summarizeCoverageItems,
  getPeriodRequirementCoverage,
} = require("../../src/services/monthlyPlanningCoverageService");

const {
  COMPONENT_TYPE,
  buildComponentsForRsLine,
  allocatePlanQtyToComponents,
  aggregateUncoveredByFgItem,
  rsLineSourceKey,
} = require("../../src/services/monthlyPlanningSourceCoverageService");

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

function throwOnWrite(name) {
  return async () => {
    throw new Error(`Unexpected write: ${name}`);
  };
}

/**
 * In-memory source-coverage DB for Additional Plan scenarios.
 */
function createSourceCoverageDb({
  sheets = [],
  approvedPlans = [],
  coverageRows = [],
} = {}) {
  const coverages = [...coverageRows];
  let nextCoverageId = coverages.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;

  const db = {
    requirementSheet: {
      findMany: async () => sheets,
    },
    monthlyProductionPlan: {
      findMany: async ({ where, orderBy, select, include } = {}) => {
        let plans = approvedPlans.filter((p) => {
          if (where?.periodKey && p.periodKey !== where.periodKey) return false;
          if (where?.status && p.status !== where.status) return false;
          return true;
        });
        if (orderBy?.planSequenceNo === "asc") {
          plans = [...plans].sort((a, b) => a.planSequenceNo - b.planSequenceNo);
        }
        return plans.map((p) => {
          const row = select ? { id: p.id, planSequenceNo: p.planSequenceNo } : { ...p };
          if (include?.lines) row.lines = p.lines || [];
          if (include?.requirementCoverages) {
            row.requirementCoverages = coverages.filter((c) => c.planId === p.id).map((c) => ({ id: c.id }));
          }
          return row;
        });
      },
      findUnique: async ({ where, include }) => {
        const plan = approvedPlans.find((p) => p.id === where.id);
        if (!plan) return null;
        const row = { ...plan };
        if (include?.lines) row.lines = plan.lines || [];
        if (include?.requirementCoverages) {
          row.requirementCoverages = coverages.filter((c) => c.planId === plan.id).map((c) => ({ id: c.id }));
        }
        return row;
      },
      count: async ({ where }) => {
        return approvedPlans.filter((p) => {
          if (where?.periodKey && p.periodKey !== where.periodKey) return false;
          if (where?.status && p.status !== where.status) return false;
          return true;
        }).length;
      },
    },
    monthlyProductionPlanLine: {
      findMany: async ({ where }) => {
        const lines = [];
        for (const plan of approvedPlans) {
          if (where?.plan?.periodKey && plan.periodKey !== where.plan.periodKey) continue;
          if (where?.plan?.status && plan.status !== where.plan.status) continue;
          for (const line of plan.lines || []) {
            lines.push({ ...line, periodKey: plan.periodKey, planStatus: plan.status });
          }
        }
        return lines;
      },
    },
    monthlyPlanRequirementCoverage: {
      findMany: async ({ where }) => {
        return coverages.filter((c) => {
          if (where?.periodKey && c.periodKey !== where.periodKey) return false;
          if (where?.plan?.status) {
            const plan = approvedPlans.find((p) => p.id === c.planId);
            if (!plan || plan.status !== where.plan.status) return false;
          }
          return true;
        });
      },
      createMany: async ({ data }) => {
        for (const row of data) {
          coverages.push({ id: nextCoverageId++, ...row });
        }
        return { count: data.length };
      },
      create: async ({ data }) => {
        const row = { id: nextCoverageId++, ...data };
        coverages.push(row);
        return row;
      },
    },
  };

  for (const method of WRITE_METHODS) {
    if (!db.monthlyProductionPlan[method]) {
    db.monthlyProductionPlan[method] = throwOnWrite(`monthlyProductionPlan.${method}`);
    }
    if (!db.monthlyProductionPlanLine[method]) {
    db.monthlyProductionPlanLine[method] = throwOnWrite(`monthlyProductionPlanLine.${method}`);
    }
  }

  return { db, coverages };
}

function sheetFixture({
  id,
  docNo,
  salesOrderId = 1,
  soDocNo = "SO-1",
  cycleId,
  cycleNo,
  version = 1,
  periodKey = "2026-07",
  lines,
}) {
  return {
    id,
    docNo,
    salesOrderId,
    cycleId,
    periodKey,
    version,
    status: "LOCKED",
    salesOrder: { id: salesOrderId, docNo: soDocNo, orderType: "NO_QTY" },
    cycle: { id: cycleId, cycleNo },
    lines,
  };
}

function lineFixture({
  id,
  itemId = 75,
  itemName = "Square Box",
  requirementQty,
  baseDemandQty,
  productionShortfallQty = 0,
  shortfallQtySnapshot = 0,
  qcRejectionRecoveryQty = 0,
  suggestedWoQtySnapshot,
}) {
  const base = baseDemandQty ?? requirementQty;
  return {
    id,
    itemId,
    requirementQty,
    baseDemandQty: base,
    productionShortfallQty,
    shortfallQtySnapshot,
    qcRejectionRecoveryQty,
    suggestedWoQtySnapshot: suggestedWoQtySnapshot ?? base + productionShortfallQty,
    totalRsQty: base + productionShortfallQty + qcRejectionRecoveryQty,
    item: { id: itemId, itemName, itemType: "FG", unit: "Nos" },
  };
}

describe("monthlyPlanningCoverage.computeAdditionalRequirementQty", () => {
  it("never returns negative quantities", () => {
    assert.equal(computeAdditionalRequirementQty(10000, 11800), 0);
    assert.equal(computeAdditionalRequirementQty(11800, 11800), 0);
    assert.equal(computeAdditionalRequirementQty(10000, 9300), 700);
  });
});

describe("monthlyPlanningSourceCoverage.buildComponentsForRsLine", () => {
  it("splits base, shortfall, and QC without inventing pending QC", () => {
    const comps = buildComponentsForRsLine(
      {
        id: 335,
        docNo: "RS-26-0002",
        salesOrderId: 224,
        cycleId: 382,
        cycle: { cycleNo: 2 },
        salesOrder: { docNo: "SO-26-0001" },
      },
      lineFixture({
        id: 437,
        requirementQty: 60000,
        baseDemandQty: 60000,
        productionShortfallQty: 3000,
        shortfallQtySnapshot: 3000,
        qcRejectionRecoveryQty: 0,
      }),
    );
    assert.equal(comps.length, 2);
    assert.equal(comps[0].componentType, COMPONENT_TYPE.RS_BASE_DEMAND);
    assert.equal(comps[0].componentQty, 60000);
    assert.equal(comps[1].componentType, COMPONENT_TYPE.PRODUCTION_SHORTFALL);
    assert.equal(comps[1].componentQty, 3000);
  });
});

describe("monthlyPlanningSourceCoverage.allocatePlanQtyToComponents", () => {
  it("binds Plan 1 qty to earliest cycle RS first", () => {
    const components = [
      ...buildComponentsForRsLine(
        { id: 334, salesOrderId: 224, cycleId: 381, cycle: { cycleNo: 1 }, salesOrder: {} },
        lineFixture({ id: 436, requirementQty: 60000, baseDemandQty: 60000 }),
      ),
      ...buildComponentsForRsLine(
        { id: 335, salesOrderId: 224, cycleId: 382, cycle: { cycleNo: 2 }, salesOrder: {} },
        lineFixture({
          id: 437,
          requirementQty: 60000,
          baseDemandQty: 60000,
          productionShortfallQty: 3000,
          shortfallQtySnapshot: 3000,
        }),
      ),
    ];
    const coveredBySourceKey = new Map();
    const rows = allocatePlanQtyToComponents({
      plan: { id: 72, periodKey: "2026-07" },
      planLine: { id: 1, fgItemId: 75 },
      coverQty: 60000,
      components,
      coveredBySourceKey,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].requirementSheetId, 334);
    assert.equal(rows[0].coveredQty, 60000);
    assert.equal(coveredBySourceKey.get(rsLineSourceKey(436, COMPONENT_TYPE.RS_BASE_DEMAND)), 60000);
    assert.equal(coveredBySourceKey.has(rsLineSourceKey(437, COMPONENT_TYPE.RS_BASE_DEMAND)), false);
  });
});

describe("monthlyPlanningCoverage.getPeriodRequirementCoverage source identity", () => {
  it("1+2: RS-1 covered by Plan 1; RS-2 60k + shortfall 3k → Additional 63,000", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 334,
          docNo: "RS-26-0001",
          cycleId: 381,
          cycleNo: 1,
          lines: [lineFixture({ id: 436, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
        sheetFixture({
          id: 335,
          docNo: "RS-26-0002",
          cycleId: 382,
          cycleNo: 2,
          lines: [
            lineFixture({
              id: 437,
              requirementQty: 60000,
              baseDemandQty: 60000,
              productionShortfallQty: 3000,
              shortfallQtySnapshot: 3000,
            }),
          ],
        }),
      ],
      approvedPlans: [
        {
          id: 72,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [
            {
              id: 900,
              fgItemId: 75,
              plannedFgQty: 60000,
              customerProductionQty: 60000,
          },
        ],
      },
      ],
    });

    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    const square = res.items.find((i) => i.fgItemId === 75);
    assert.ok(square);
    assert.equal(square.additionalRequirementQty, 63000);
    assert.equal(square.alreadyApprovedQty, 60000);
    assert.equal(square.componentBreakdown.newUncoveredRsDemand, 60000);
    assert.equal(square.componentBreakdown.productionShortfallCarryForward, 3000);
    assert.equal(square.componentBreakdown.qcRejectionCarryForward, 0);
    assert.equal(res.totals.totalAdditionalRequirementQty, 63000);
    assert.equal(res.totals.additionalItemCount, 1);
    assert.equal(res.coverageModel, "SOURCE_IDENTITY");
  });

  it("3: no shortfall → Additional = RS-2 demand only", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 1,
          docNo: "RS-1",
          cycleId: 1,
          cycleNo: 1,
          lines: [lineFixture({ id: 10, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
        sheetFixture({
          id: 2,
          docNo: "RS-2",
          cycleId: 2,
          cycleNo: 2,
          lines: [lineFixture({ id: 20, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 60000, customerProductionQty: 60000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    assert.equal(res.totals.totalAdditionalRequirementQty, 60000);
    assert.equal(res.totals.componentBreakdown.newUncoveredRsDemand, 60000);
    assert.equal(res.totals.componentBreakdown.productionShortfallCarryForward, 0);
  });

  it("4: finalized QC rejection is included", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 1,
          docNo: "RS-1",
          cycleId: 1,
          cycleNo: 1,
          lines: [lineFixture({ id: 10, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
        sheetFixture({
          id: 2,
          docNo: "RS-2",
          cycleId: 2,
          cycleNo: 2,
          lines: [
            lineFixture({
              id: 20,
              requirementQty: 60000,
              baseDemandQty: 60000,
              productionShortfallQty: 3000,
              shortfallQtySnapshot: 3000,
              qcRejectionRecoveryQty: 500,
            }),
          ],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 60000, customerProductionQty: 60000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    assert.equal(res.totals.totalAdditionalRequirementQty, 63500);
    assert.equal(res.totals.componentBreakdown.qcRejectionCarryForward, 500);
  });

  it("5: QC pending (0 on RS) → no rejection carry-forward", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 2,
          docNo: "RS-2",
          cycleId: 2,
          cycleNo: 2,
          lines: [
            lineFixture({
              id: 20,
              requirementQty: 60000,
              baseDemandQty: 60000,
              productionShortfallQty: 3000,
              qcRejectionRecoveryQty: 0,
            }),
          ],
        }),
      ],
      approvedPlans: [],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    assert.equal(res.totals.componentBreakdown.qcRejectionCarryForward, 0);
  });

  it("6: two RSs same FG — prior plan stays bound to correct RS", async () => {
    const { db, coverages } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 1,
          docNo: "RS-A",
          cycleId: 1,
          cycleNo: 1,
          lines: [lineFixture({ id: 10, requirementQty: 10000, baseDemandQty: 10000 })],
        }),
        sheetFixture({
          id: 2,
          docNo: "RS-B",
          cycleId: 2,
          cycleNo: 2,
          lines: [lineFixture({ id: 20, requirementQty: 10000, baseDemandQty: 10000 })],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 10000, customerProductionQty: 10000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    assert.equal(res.totals.totalAdditionalRequirementQty, 10000);
    const bound = coverages.find((c) => c.planId === 1);
    assert.equal(bound.requirementSheetId, 1);
    assert.equal(bound.requirementSheetLineId, 10);
  });

  it("7: two different FG items remain item-specific", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 1,
          docNo: "RS-1",
          cycleId: 1,
          cycleNo: 1,
          lines: [
            lineFixture({ id: 10, itemId: 75, itemName: "A", requirementQty: 1000, baseDemandQty: 1000 }),
            lineFixture({ id: 11, itemId: 76, itemName: "B", requirementQty: 2000, baseDemandQty: 2000 }),
          ],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 1000, customerProductionQty: 1000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    const a = res.items.find((i) => i.fgItemId === 75);
    const b = res.items.find((i) => i.fgItemId === 76);
    assert.equal(a.additionalRequirementQty, 0);
    assert.equal(b.additionalRequirementQty, 2000);
  });

  it("8: existing Additional Plan covering RS-2 → no duplicate", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 1,
          docNo: "RS-1",
          cycleId: 1,
          cycleNo: 1,
          lines: [lineFixture({ id: 10, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
        sheetFixture({
          id: 2,
          docNo: "RS-2",
          cycleId: 2,
          cycleNo: 2,
          lines: [
            lineFixture({
              id: 20,
              requirementQty: 60000,
              baseDemandQty: 60000,
              productionShortfallQty: 3000,
              shortfallQtySnapshot: 3000,
            }),
          ],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 60000, customerProductionQty: 60000 }],
        },
        {
          id: 2,
          periodKey: "2026-07",
          planSequenceNo: 2,
          status: "APPROVED",
          lines: [{ id: 2, fgItemId: 75, plannedFgQty: 63000, customerProductionQty: 63000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    assert.equal(res.totals.totalAdditionalRequirementQty, 0);
    assert.equal(res.totals.additionalItemCount, 0);
  });

  it("9: partial planning leaves only uncovered remainder", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 2,
          docNo: "RS-2",
          cycleId: 2,
          cycleNo: 2,
          lines: [lineFixture({ id: 20, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 25000, customerProductionQty: 25000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    assert.equal(res.totals.totalAdditionalRequirementQty, 35000);
  });

  it("10: preview totals match component breakdown sum", async () => {
    const { db } = createSourceCoverageDb({
      sheets: [
        sheetFixture({
          id: 1,
          docNo: "RS-1",
          cycleId: 1,
          cycleNo: 1,
          lines: [lineFixture({ id: 10, requirementQty: 60000, baseDemandQty: 60000 })],
        }),
        sheetFixture({
          id: 2,
          docNo: "RS-2",
          cycleId: 2,
          cycleNo: 2,
          lines: [
            lineFixture({
              id: 20,
              requirementQty: 60000,
              baseDemandQty: 60000,
              productionShortfallQty: 3000,
              shortfallQtySnapshot: 3000,
            }),
          ],
        }),
      ],
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-07",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [{ id: 1, fgItemId: 75, plannedFgQty: 60000, customerProductionQty: 60000 }],
        },
      ],
    });
    const res = await getPeriodRequirementCoverage({ db, periodKey: "2026-07" });
    const b = res.totals.componentBreakdown;
    const sum =
      b.newUncoveredRsDemand +
      b.productionShortfallCarryForward +
      b.qcRejectionCarryForward +
      b.greenLevelQty;
    assert.equal(sum, res.totals.totalAdditionalRequirementQty);
    assert.equal(sum, 63000);
  });
});

describe("monthlyPlanningCoverage legacy helpers", () => {
  it("sumApprovedPlannedFgByItem still sums APPROVED plan lines", async () => {
    const { db } = createSourceCoverageDb({
      approvedPlans: [
        {
          id: 1,
          periodKey: "2026-06",
          planSequenceNo: 1,
          status: "APPROVED",
          lines: [
            { fgItemId: 65, plannedFgQty: "11800", customerProductionQty: 0 },
            { fgItemId: 66, plannedFgQty: "5000", customerProductionQty: 0 },
          ],
        },
        {
          id: 2,
      periodKey: "2026-06",
          planSequenceNo: 2,
          status: "APPROVED",
          lines: [{ fgItemId: 66, plannedFgQty: "4300", customerProductionQty: 0 }],
        },
      ],
    });
    const map = await sumApprovedPlannedFgByItem(db, "2026-06");
    assert.equal(map.get(65), 11800);
    assert.equal(map.get(66), 9300);
  });

  it("mapCoverageItem + summarizeCoverageItems remain pure", () => {
    const item = mapCoverageItem(
      65,
      { itemName: "Cap", unit: "Pcs", rsRequirement: 10000, carryForward: 0, greenShortage: 0, suggestedProduction: 10000 },
      3000,
      "2026-06",
    );
    assert.equal(item.additionalRequirementQty, 7000);
    const totals = summarizeCoverageItems([item]);
    assert.equal(totals.totalAdditionalRequirementQty, 7000);
  });
});

describe("aggregateUncoveredByFgItem", () => {
  it("aggregates uncovered components by FG", () => {
    const rows = aggregateUncoveredByFgItem([
      {
        fgItemId: 75,
        itemName: "Square Box",
        unit: "Nos",
        componentType: COMPONENT_TYPE.RS_BASE_DEMAND,
        componentQty: 60000,
        coveredQty: 0,
        uncoveredQty: 60000,
        sourceKey: "RS_LINE:20:RS_BASE_DEMAND",
        requirementSheetId: 2,
      },
      {
        fgItemId: 75,
        itemName: "Square Box",
        unit: "Nos",
        componentType: COMPONENT_TYPE.PRODUCTION_SHORTFALL,
        componentQty: 3000,
        coveredQty: 0,
        uncoveredQty: 3000,
        sourceKey: "RS_LINE:20:PRODUCTION_SHORTFALL",
        requirementSheetId: 2,
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].additionalRequirementQty, 63000);
    assert.equal(rows[0].componentBreakdown.newUncoveredRsDemand, 60000);
    assert.equal(rows[0].componentBreakdown.productionShortfallCarryForward, 3000);
  });
});
