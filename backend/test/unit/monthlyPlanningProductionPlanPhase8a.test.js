const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeVarianceQty,
  computeVariancePct,
  computeRemainingGreenGap,
  computeLockSummary,
  enrichProductionLineMetrics,
} = require("../../src/services/monthlyPlanningProductionPlanMetrics");
const {
  getProductionLines,
  updateProductionLines,
  lockMonthlyPlan,
} = require("../../src/services/monthlyPlanningService");
const { computeSuggestedProduction } = require("../../src/services/monthlyPlanningRequirementCompositionService");

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

function throwOnWrite(name) {
  return async () => {
    throw new Error(`Unexpected write: ${name}`);
  };
}

function createLinesMockDb({ status = "DRAFT", planId = 1, periodKey = "2026-07", items = [], existingLines = [] } = {}) {
  const state = {
    lines: existingLines.map((l) => ({ plannedQtyOverridden: false, ...l })),
    upserts: [],
    deletes: [],
  };
  const itemTypeById = new Map(items.map((i) => [i.id, i.itemType]));
  const db = {
    monthlyProductionPlan: {
      findUnique: async ({ where }) =>
        where.id === planId ? { id: planId, status, periodKey } : null,
    },
    monthlyProductionPlanLine: {
      findMany: async () =>
        state.lines.map((l) => ({
          id: l.id,
          fgItemId: l.fgItemId,
          suggestedFgQty: l.suggestedFgQty ?? 0,
          plannedFgQty: l.plannedFgQty ?? 0,
          plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
          source: l.source ?? "MANUAL",
          remarks: l.remarks ?? null,
          fgItem: { id: l.fgItemId, itemName: `Item ${l.fgItemId}`, itemType: "FG", unit: "NOS" },
        })),
      deleteMany: async ({ where }) => {
        state.deletes.push(where.id);
        state.lines = state.lines.filter((l) => l.id !== where.id);
        return { count: 1 };
      },
      upsert: async ({ where, create, update }) => {
        state.upserts.push({ where, create, update });
        const fgItemId = where.planId_fgItemId.fgItemId;
        const found = state.lines.find((l) => l.fgItemId === fgItemId);
        if (found) Object.assign(found, update);
        else state.lines.push({ id: 1000 + state.lines.length, fgItemId, ...create });
        return {};
      },
    },
    item: {
      findMany: async ({ where }) =>
        (where.id.in || [])
          .filter((id) => itemTypeById.has(id))
          .map((id) => ({ id, itemType: itemTypeById.get(id) })),
    },
    materialRequirement: { findFirst: async () => null },
    materialRequirementLine: { groupBy: async () => [] },
    $transaction: async (fn) => fn(db),
    __state: state,
  };
  for (const method of WRITE_METHODS) {
    if (!db.materialRequirement) db.materialRequirement = {};
    if (!db.materialRequirement[method]) db.materialRequirement[method] = throwOnWrite(`materialRequirement.${method}`);
  }
  return db;
}

const mockComposition = {
  periodKey: "2026-07",
  items: [
    {
      itemId: 10,
      itemName: "Cap",
      suggestedProduction: 11750,
      rsRequirement: 0,
      carryForward: 0,
      greenShortage: 11750,
    },
    {
      itemId: 11,
      itemName: "Nozzle",
      suggestedProduction: 9300,
      rsRequirement: 9300,
      carryForward: 0,
      greenShortage: 0,
    },
  ],
};

const mockGreenLevels = {
  anchorPeriodKey: "2026-07",
  items: [
    { itemId: 10, greenQty: 11800, freeFgStock: 50 },
    { itemId: 11, greenQty: 9000, freeFgStock: 200 },
  ],
};

describe("monthlyPlanningProductionPlanMetrics", () => {
  it("computes variance qty and pct", () => {
    assert.equal(computeVarianceQty(10000, 11750), -1750);
    assert.equal(computeVariancePct(-1750, 11750), -14.894);
  });

  it("computes remaining green gap from planned qty", () => {
    assert.equal(computeRemainingGreenGap(11800, 50, 10000), 1750);
    assert.equal(computeRemainingGreenGap(11800, 50, 11750), 0);
  });

  it("computes lock summary totals", () => {
    const summary = computeLockSummary([
      { suggestedFgQty: 11750, plannedFgQty: 10000, varianceQty: -1750 },
      { suggestedFgQty: 9300, plannedFgQty: 9300, varianceQty: 0 },
    ]);
    assert.equal(summary.fgItemsWithVariance, 1);
    assert.equal(summary.totalSuggestedQty, 21050);
    assert.equal(summary.totalPlannedQty, 19300);
    assert.equal(summary.totalVarianceQty, -1750);
  });
});

describe("Phase 8A — suggested production alignment", () => {
  it("uses Phase 5 formula RS + carry forward + green shortage", () => {
    assert.equal(computeSuggestedProduction(9300, 0, 0), 9300);
    assert.equal(computeSuggestedProduction(0, 0, 11750), 11750);
    assert.equal(computeSuggestedProduction(500, 200, 300), 1000);
  });

  it("getProductionLines returns Phase 5 suggested and variance fields", async () => {
    const db = createLinesMockDb({
      existingLines: [
        { id: 1, fgItemId: 10, suggestedFgQty: 100, plannedFgQty: 10000, plannedQtyOverridden: true },
      ],
    });
    const res = await getProductionLines({
      db,
      planId: 1,
      loadComposition: async () => mockComposition,
      loadGreenLevelsFn: async () => mockGreenLevels,
    });
    assert.equal(res.lines[0].suggestedFgQty, 11750);
    assert.equal(res.lines[0].varianceQty, -1750);
    assert.equal(res.lines[0].remainingGreenGap, 1750);
    assert.equal(res.lockSummary.fgItemsWithVariance, 1);
  });
});

describe("Phase 8A — planned qty default and override", () => {
  it("auto-populates suggested from Phase 5 on save for new row", async () => {
    const db = createLinesMockDb({ items: [{ id: 10, itemType: "FG" }] });
    await updateProductionLines({
      db,
      planId: 1,
      upserts: [{ fgItemId: 10, plannedFgQty: 11750, plannedQtyOverridden: false, source: "MANUAL" }],
      loadComposition: async () => mockComposition,
      loadGreenLevelsFn: async () => mockGreenLevels,
    });
    const upsert = db.__state.upserts[0];
    assert.equal(Number(upsert.create.suggestedFgQty), 11750);
    assert.equal(Number(upsert.create.plannedFgQty), 11750);
    assert.equal(upsert.create.plannedQtyOverridden, false);
  });

  it("persists plannedQtyOverridden true on manual edit save", async () => {
    const db = createLinesMockDb({
      items: [{ id: 10, itemType: "FG" }],
      existingLines: [{ id: 1, fgItemId: 10, suggestedFgQty: 11750, plannedFgQty: 11750 }],
    });
    await updateProductionLines({
      db,
      planId: 1,
      upserts: [{ fgItemId: 10, plannedFgQty: 10000, plannedQtyOverridden: true, source: "MANUAL" }],
      loadComposition: async () => mockComposition,
      loadGreenLevelsFn: async () => mockGreenLevels,
    });
    const upsert = db.__state.upserts[0];
    assert.equal(upsert.update.plannedQtyOverridden, true);
    assert.equal(Number(upsert.update.plannedFgQty), 10000);
    assert.equal(Number(upsert.update.suggestedFgQty), 11750);
  });

  it("preserves overridden planned qty without auto-reset on save", async () => {
    const db = createLinesMockDb({
      items: [{ id: 10, itemType: "FG" }],
      existingLines: [
        { id: 1, fgItemId: 10, suggestedFgQty: 11000, plannedFgQty: 9000, plannedQtyOverridden: true },
      ],
    });
    await updateProductionLines({
      db,
      planId: 1,
      upserts: [{ fgItemId: 10, plannedFgQty: 9000, plannedQtyOverridden: true, source: "MANUAL" }],
      loadComposition: async () => ({
        ...mockComposition,
        items: [{ ...mockComposition.items[0], suggestedProduction: 12000 }],
      }),
      loadGreenLevelsFn: async () => mockGreenLevels,
    });
    const upsert = db.__state.upserts[0];
    assert.equal(Number(upsert.update.plannedFgQty), 9000);
    assert.equal(Number(upsert.update.suggestedFgQty), 12000);
    assert.equal(upsert.update.plannedQtyOverridden, true);
  });
});

describe("Phase 8A — read-only verification (no workflow changes)", () => {
  it("does not change lock behavior — still uses plannedFgQty only", async () => {
    const exploded = [];
    const state = {
      plan: { id: 5, status: "DRAFT", currentRevision: 0, periodKey: "2026-07", lockedAt: null },
      rmPlan: { id: 1, revision: 1, totalFgPlannedQty: 10, recalculatedAt: new Date(), lines: [] },
    };
    const db = {
      monthlyProductionPlan: {
        findUnique: async () => ({ ...state.plan }),
        update: async ({ data }) => {
          Object.assign(state.plan, data);
          return state.plan;
        },
      },
      monthlyProductionPlanLine: {
        findMany: async () => [
          {
            id: 1,
            fgItemId: 50,
            plannedFgQty: 10,
            suggestedFgQty: 99,
            fgItem: { id: 50, itemName: "FG-A" },
          },
        ],
      },
      rmPlan: {
        create: async ({ data }) => {
          state.rmPlan = { id: 1, ...data, lines: [] };
          return state.rmPlan;
        },
        findMany: async () => [{ revision: 1, recalculatedAt: state.rmPlan.recalculatedAt }],
        findFirst: async ({ where, orderBy }) => {
          if (!state.rmPlan || state.rmPlan.planId !== where.planId) return null;
          return { revision: state.rmPlan.revision };
        },
        findUnique: async ({ where }) => {
          if (!where?.planId_revision) return null;
          const { planId, revision } = where.planId_revision;
          if (state.rmPlan && state.rmPlan.planId === planId && state.rmPlan.revision === revision) {
            return state.rmPlan;
          }
          return null;
        },
      },
      monthlyProductionPlanRevisionLine: {
        createMany: async () => ({ count: 1 }),
      },
      rmPlanLine: { createMany: async () => ({ count: 1 }) },
      item: {
        findMany: async () => [{ id: 201, itemName: "RM-1", unit: "Kg", minimumStockQty: 0 }],
      },
      $transaction: async (fn) => fn(db),
    };
    await lockMonthlyPlan({
      db,
      planId: 5,
      deps: {
        allowLegacyLock: true,
        aggregateRmDemandForFgLines: async (_tx, fgLines) => {
          exploded.push(...fgLines);
          return { rmNeeded: new Map([[201, 5]]), missingChildBoms: [] };
        },
        loadApprovedBomWithLines: async () => ({ lines: [{ id: 1 }] }),
        getMaterialAvailabilityByItems: async () => [
          { itemId: 201, freeStockQty: 0, effectiveReservedQty: 0, incomingQty: 0, netShortageAfterIncomingQty: 5 },
        ],
      },
    });
    assert.equal(exploded[0].fgQty, 10);
    assert.notEqual(exploded[0].fgQty, 99);
  });

  it("does not create procurement on production line save", async () => {
    const db = createLinesMockDb({ items: [{ id: 10, itemType: "FG" }] });
    db.materialRequirement.create = throwOnWrite("materialRequirement.create");
    await updateProductionLines({
      db,
      planId: 1,
      upserts: [{ fgItemId: 10, plannedFgQty: 100, plannedQtyOverridden: false }],
      loadComposition: async () => mockComposition,
      loadGreenLevelsFn: async () => mockGreenLevels,
    });
  });
});

describe("monthlyPlanningProductionPlanMetrics.enrichProductionLineMetrics", () => {
  it("matches green gap visibility formula", () => {
    const row = enrichProductionLineMetrics({
      suggestedFgQty: 11750,
      plannedFgQty: 10000,
      greenTarget: 11800,
      freeFgStock: 50,
    });
    assert.equal(row.varianceQty, -1750);
    assert.equal(row.remainingGreenGap, 1750);
    assert.equal(row.projectedStockAfterPlan, 10050);
  });
});
