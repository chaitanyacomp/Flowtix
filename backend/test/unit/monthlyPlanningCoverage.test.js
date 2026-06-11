const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAdditionalRequirementQty,
  sumApprovedPlannedFgByItem,
  mapCoverageItem,
  summarizeCoverageItems,
  getPeriodRequirementCoverage,
} = require("../../src/services/monthlyPlanningCoverageService");

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

function throwOnWrite(name) {
  return async () => {
    throw new Error(`Unexpected write: ${name}`);
  };
}

function createCoverageDb({
  approvedLines = [],
  planCounts = { APPROVED: 0 },
  composition = null,
} = {}) {
  const db = {
    monthlyProductionPlanLine: {
      findMany: async ({ where }) => {
        return approvedLines.filter((line) => {
          if (where?.plan?.periodKey && line.periodKey !== where.plan.periodKey) return false;
          if (where?.plan?.status && line.planStatus !== where.plan.status) return false;
          return true;
        });
      },
    },
    monthlyProductionPlan: {
      count: async ({ where }) => {
        if (where?.status === "APPROVED") return planCounts.APPROVED ?? 0;
        return 0;
      },
    },
  };
  for (const method of WRITE_METHODS) {
    db.monthlyProductionPlan[method] = throwOnWrite(`monthlyProductionPlan.${method}`);
    db.monthlyProductionPlanLine[method] = throwOnWrite(`monthlyProductionPlanLine.${method}`);
  }
  return {
    db,
    loadComposition: async () =>
      composition ?? {
        periodKey: "2026-06",
        anchorPeriodKey: "2026-06",
        sheetCount: 0,
        itemCount: 0,
        items: [],
      },
  };
}

describe("monthlyPlanningCoverage.computeAdditionalRequirementQty", () => {
  it("never returns negative quantities", () => {
    assert.equal(computeAdditionalRequirementQty(10000, 11800), 0);
    assert.equal(computeAdditionalRequirementQty(11800, 11800), 0);
    assert.equal(computeAdditionalRequirementQty(10000, 9300), 700);
  });
});

describe("monthlyPlanningCoverage.sumApprovedPlannedFgByItem", () => {
  it("sums only APPROVED plan lines in the period", async () => {
    const { db } = createCoverageDb({
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "11800", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "5000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "4300", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 65, plannedFgQty: "9999", periodKey: "2026-06", planStatus: "DRAFT" },
        { fgItemId: 66, plannedFgQty: "1000", periodKey: "2026-06", planStatus: "AWAITING_PURCHASE_REVIEW" },
        { fgItemId: 65, plannedFgQty: "100", periodKey: "2026-06", planStatus: "LOCKED" },
      ],
    });
    const map = await sumApprovedPlannedFgByItem(db, "2026-06");
    assert.equal(map.get(65), 11800);
    assert.equal(map.get(66), 9300);
    assert.equal(map.size, 2);
  });
});

describe("monthlyPlanningCoverage.getPeriodRequirementCoverage", () => {
  it("Case 1: no approved plans → additional equals current composition", async () => {
    const { db, loadComposition } = createCoverageDb({
      planCounts: { APPROVED: 0 },
      composition: {
        periodKey: "2026-06",
        items: [
          {
            itemId: 65,
            itemName: "Cap",
            unit: "Pcs",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
          {
            itemId: 66,
            itemName: "Nozzle",
            unit: "Pcs",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      },
    });

    const res = await getPeriodRequirementCoverage({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(res.totals.totalCurrentRequirementQty, 20000);
    assert.equal(res.totals.totalAlreadyApprovedQty, 0);
    assert.equal(res.totals.totalAdditionalRequirementQty, 20000);
    assert.equal(res.totals.additionalItemCount, 2);
    const cap = res.items.find((i) => i.fgItemId === 65);
    assert.equal(cap.additionalRequirementQty, 10000);
    assert.deepEqual(cap.sourceBreakdown, { rsRequirement: 10000, carryForward: 0, greenShortage: 0 });
  });

  it("Case 2: approved plan partially covers composition", async () => {
    const { db, loadComposition } = createCoverageDb({
      planCounts: { APPROVED: 1 },
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "11800", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "9300", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: {
        periodKey: "2026-06",
        items: [
          {
            itemId: 65,
            itemName: "Cap",
            rsRequirement: 11800,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 11800,
          },
          {
            itemId: 66,
            itemName: "Nozzle",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      },
    });

    const res = await getPeriodRequirementCoverage({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    const cap = res.items.find((i) => i.fgItemId === 65);
    const nozzle = res.items.find((i) => i.fgItemId === 66);
    assert.equal(cap.additionalRequirementQty, 0);
    assert.equal(nozzle.additionalRequirementQty, 700);
    assert.equal(res.totals.totalAdditionalRequirementQty, 700);
    assert.equal(res.totals.additionalItemCount, 1);
  });

  it("Case 3: approved exceeds composition → additional zero", async () => {
    const { db, loadComposition } = createCoverageDb({
      planCounts: { APPROVED: 1 },
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "11800", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: {
        periodKey: "2026-06",
        items: [
          {
            itemId: 65,
            itemName: "Cap",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      },
    });

    const res = await getPeriodRequirementCoverage({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(res.items[0].additionalRequirementQty, 0);
    assert.equal(res.items[0].alreadyApprovedQty, 11800);
    assert.equal(res.items[0].currentRequirementQty, 10000);
  });

  it("sums multiple approved plans in the same period", async () => {
    const { db, loadComposition } = createCoverageDb({
      planCounts: { APPROVED: 2 },
      approvedLines: [
        { fgItemId: 66, plannedFgQty: "4000", periodKey: "2026-06", planStatus: "APPROVED" },
        { fgItemId: 66, plannedFgQty: "3000", periodKey: "2026-06", planStatus: "APPROVED" },
      ],
      composition: {
        periodKey: "2026-06",
        items: [
          {
            itemId: 66,
            itemName: "Nozzle",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      },
    });

    const res = await getPeriodRequirementCoverage({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(res.items[0].alreadyApprovedQty, 7000);
    assert.equal(res.items[0].additionalRequirementQty, 3000);
    assert.equal(res.approvedPlanCount, 2);
  });

  it("ignores DRAFT, AWAITING_PURCHASE_REVIEW, and legacy LOCKED from approved coverage", async () => {
    const { db, loadComposition } = createCoverageDb({
      approvedLines: [
        { fgItemId: 65, plannedFgQty: "5000", periodKey: "2026-06", planStatus: "DRAFT" },
        { fgItemId: 65, plannedFgQty: "3000", periodKey: "2026-06", planStatus: "AWAITING_PURCHASE_REVIEW" },
        { fgItemId: 65, plannedFgQty: "2000", periodKey: "2026-06", planStatus: "LOCKED" },
      ],
      composition: {
        periodKey: "2026-06",
        items: [
          {
            itemId: 65,
            itemName: "Cap",
            rsRequirement: 10000,
            carryForward: 0,
            greenShortage: 0,
            suggestedProduction: 10000,
          },
        ],
      },
    });

    const res = await getPeriodRequirementCoverage({
      db,
      periodKey: "2026-06",
      loadRequirementComposition: loadComposition,
    });

    assert.equal(res.items[0].alreadyApprovedQty, 0);
    assert.equal(res.items[0].additionalRequirementQty, 10000);
  });

  it("preserves source breakdown on each item", () => {
    const row = mapCoverageItem(
      66,
      {
        itemName: "Nozzle",
        unit: "Pcs",
        rsRequirement: 9000,
        carryForward: 500,
        greenShortage: 500,
        suggestedProduction: 10000,
      },
      9300,
      "2026-06",
    );
    assert.deepEqual(row.sourceBreakdown, {
      rsRequirement: 9000,
      carryForward: 500,
      greenShortage: 500,
    });
    assert.equal(row.currentRequirementQty, 10000);
    assert.equal(row.additionalRequirementQty, 700);
    assert.equal(row.hasAdditionalRequirement, true);
  });

  it("computes totals correctly", () => {
    const totals = summarizeCoverageItems([
      { currentRequirementQty: 11800, alreadyApprovedQty: 11800, additionalRequirementQty: 0, hasAdditionalRequirement: false },
      { currentRequirementQty: 10000, alreadyApprovedQty: 9300, additionalRequirementQty: 700, hasAdditionalRequirement: true },
    ]);
    assert.equal(totals.totalCurrentRequirementQty, 21800);
    assert.equal(totals.totalAlreadyApprovedQty, 21100);
    assert.equal(totals.totalAdditionalRequirementQty, 700);
    assert.equal(totals.itemCount, 2);
    assert.equal(totals.additionalItemCount, 1);
  });
});
