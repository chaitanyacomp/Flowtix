const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createRmPlanSnapshot,
  loadFgGreenShortageInputs,
} = require("../../src/services/monthlyPlanningRmSnapshotService");

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

function throwOnWrite(name) {
  return async () => {
    throw new Error(`Unexpected write: ${name}`);
  };
}

function createSnapshotDb({ greenShortage = 5000, plannedFgQty = "700" } = {}) {
  const state = {
    rmPlans: [],
    rmPlanLines: [],
    revisionLines: [],
  };

  const db = {
    rmPlan: {
      findUnique: async ({ where }) =>
        state.rmPlans.find(
          (p) => p.planId === where.planId_revision.planId && p.revision === where.planId_revision.revision,
        ) ?? null,
      create: async ({ data }) => {
        const row = { id: 1, ...data };
        state.rmPlans.push(row);
        return row;
      },
    },
    rmPlanLine: {
      createMany: async ({ data }) => {
        state.rmPlanLines.push(...data);
        return { count: data.length };
      },
    },
    monthlyProductionPlan: {
      findUnique: async () => ({
        id: 5,
        periodKey: "2026-07",
        status: "AWAITING_PURCHASE_REVIEW",
        planSequenceNo: 1,
        planKind: "INITIAL",
      }),
    },
    monthlyProductionPlanLine: {
      findMany: async () => [
        {
          id: 1,
          fgItemId: 10,
          plannedFgQty,
          suggestedFgQty: "10000",
          plannedQtyOverridden: false,
          source: "REQUIREMENT_SHEET",
          remarks: null,
          fgItem: { id: 10, itemName: "FG-A", unit: "Nos" },
        },
      ],
    },
    monthlyProductionPlanRevisionLine: {
      createMany: async ({ data }) => {
        state.revisionLines.push(...data);
        return { count: data.length };
      },
    },
    item: {
      findMany: async () => [{ id: 201, itemName: "RM-1", unit: "Kg" }],
    },
  };

  for (const method of WRITE_METHODS) {
    if (!db.rmPlan[method]) db.rmPlan[method] = throwOnWrite(`rmPlan.${method}`);
  }

  return {
    db,
    state,
    deps: {
      loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
      loadFgGreenShortageInputs: async () => [
        { fgItemId: 10, fgItemName: "FG-A", greenShortage },
      ],
      aggregateRmDemandForFgLines: async (_db, fgLines) => {
        assert.equal(fgLines[0].fgQty, greenShortage);
        return { rmNeeded: new Map([[201, 600]]), missingChildBoms: [] };
      },
      getMaterialAvailabilityByItems: async () => [
        {
          itemId: 201,
          physicalUsableStockQty: 100,
          freeStockQty: 100,
          effectiveReservedQty: 0,
          incomingQty: 0,
          warnings: [],
        },
      ],
    },
  };
}

describe("monthlyPlanningRmSnapshotService P11", () => {
  it("loadFgGreenShortageInputs filters composition to green shortage > 0", async () => {
    const items = await loadFgGreenShortageInputs(
      {},
      "2026-07",
      async () => ({
        items: [
          { itemId: 1, itemName: "A", greenShortage: 0, suggestedProduction: 500 },
          { itemId: 2, itemName: "B", greenShortage: 120 },
        ],
      }),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].fgItemId, 2);
    assert.equal(items[0].greenShortage, 120);
  });

  it("createRmPlanSnapshot freezes BOM(greenShortage) not plannedFgQty", async () => {
    const { db, state, deps } = createSnapshotDb({ greenShortage: 5000, plannedFgQty: "700" });
    const res = await createRmPlanSnapshot({
      db,
      planId: 5,
      revision: 1,
      deps,
    });
    assert.equal(res.created, true);
    assert.equal(state.rmPlanLines.length, 1);
    assert.equal(Number(state.rmPlanLines[0].grossDemandQty), 600);
    assert.equal(Number(state.rmPlanLines[0].netRequirementQty), 500);
    assert.equal(state.rmPlanLines[0].belowMinStockFlag, false);
  });
});
