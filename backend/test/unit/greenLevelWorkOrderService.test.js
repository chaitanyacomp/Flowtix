const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GREEN_LEVEL_WO_SOURCE_TYPE,
  buildGreenLevelWoPlacement,
  createGreenLevelWorkOrdersFromPlan,
} = require("../../src/services/greenLevelWorkOrderService");

const releasedAt = new Date("2026-07-06T10:00:00.000Z");

function createDeps() {
  return {
    loadApprovedBomWithLines: async () => ({ id: 1, lines: [{ id: 1 }] }),
    aggregateRmDemandForFgLines: async (_db, fgLines) => ({
      rmNeeded: new Map([[501, fgLines.reduce((sum, line) => sum + Number(line.fgQty ?? 0) * 2, 0)]]),
      missingChildBoms: [],
    }),
    getMaterialAvailabilityByItems: async ({ requiredQtyByItemId }) =>
      [...requiredQtyByItemId.entries()].map(([itemId, requiredQty]) => ({
        itemId,
        itemName: `RM ${itemId}`,
        requiredQty,
        freeStockQty: requiredQty,
      })),
  };
}

function createPlan(lines) {
  return {
    id: 10,
    docNo: "MPP-26-0001",
    periodKey: "2026-07",
    releasedAt,
    lines: lines.map((line, idx) => ({
      id: idx + 1,
      planId: 10,
      fgItemId: line.fgItemId,
      greenReplenishmentQty: line.greenReplenishmentQty,
      fgItem: { id: line.fgItemId, itemName: line.itemName ?? `FG ${line.fgItemId}`, unit: "NOS" },
    })),
  };
}

test("customer-only plan has no Green Level WO placement", async () => {
  const db = {
    monthlyProductionPlan: {
      findFirst: async () => null,
    },
  };

  const placement = await buildGreenLevelWoPlacement(db, {}, createDeps());

  assert.equal(placement.available, false);
  assert.equal(placement.summary.remainingQty, 0);
  assert.equal(placement.summary.canCreateWorkOrder, false);
});

test("selected Green Level items show GL WO placement only for remaining GL qty", async () => {
  const plan = createPlan([
    { fgItemId: 101, greenReplenishmentQty: 20, itemName: "FG A" },
    { fgItemId: 102, greenReplenishmentQty: 10, itemName: "FG B" },
  ]);
  const db = {
    monthlyProductionPlan: {
      findFirst: async () => ({ id: plan.id }),
      findUnique: async () => plan,
    },
    workOrder: {
      findMany: async () => [
        {
          id: 90,
          docNo: "WO-26-0090",
          status: "PENDING",
          sourceType: GREEN_LEVEL_WO_SOURCE_TYPE,
          createdAt: releasedAt,
          lines: [{ fgItemId: 101, plannedQty: 5, qty: 5, fgItem: { itemName: "FG A" } }],
          productionMaterialRequests: [],
        },
      ],
    },
  };

  const placement = await buildGreenLevelWoPlacement(db, {}, createDeps());

  assert.equal(placement.available, true);
  assert.equal(placement.summary.selectedQty, 30);
  assert.equal(placement.summary.placedQty, 5);
  assert.equal(placement.summary.remainingQty, 25);
  assert.equal(placement.lines.find((line) => line.fgItemId === 101).remainingQty, 15);
  assert.equal(placement.summary.canCreateWorkOrder, true);
});

test("creating GL WOs writes GREEN_LEVEL_REPLENISHMENT and does not touch RS balance", async () => {
  const plan = createPlan([{ fgItemId: 101, greenReplenishmentQty: 12, itemName: "FG A" }]);
  const created = [];
  const rsUpdates = [];
  const tx = {
    monthlyProductionPlan: { findUnique: async () => plan },
    workOrder: {
      findMany: async () => [],
      create: async ({ data }) => {
        created.push(data);
        return { id: 77, docNo: "WO-26-0077" };
      },
    },
    requirementSheetLine: {
      update: async (args) => {
        rsUpdates.push(args);
      },
      updateMany: async (args) => {
        rsUpdates.push(args);
      },
    },
    docSequence: {
      upsert: async () => ({ docType: "WORK_ORDER", year2: 26, nextNumber: 78 }),
    },
  };

  const result = await createGreenLevelWorkOrdersFromPlan(
    tx,
    { planId: plan.id, lines: [{ fgItemId: 101, qty: 12 }] },
    createDeps(),
  );

  assert.equal(result.created, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].sourceType, GREEN_LEVEL_WO_SOURCE_TYPE);
  assert.equal(created[0].monthlyProductionPlanId, plan.id);
  assert.equal(created[0].salesOrderId, null);
  assert.equal(created[0].requirementSheetId, null);
  assert.deepEqual(rsUpdates, []);
});

test("unplaced customer demand is not mixed into GL WO creation", async () => {
  const plan = createPlan([{ fgItemId: 101, greenReplenishmentQty: 7, itemName: "FG A" }]);
  plan.lines[0].customerProductionQty = 50;
  const created = [];
  const tx = {
    monthlyProductionPlan: { findUnique: async () => plan },
    workOrder: {
      findMany: async () => [],
      create: async ({ data }) => {
        created.push(data);
        return { id: 78, docNo: "WO-26-0078" };
      },
    },
    docSequence: {
      upsert: async () => ({ docType: "WORK_ORDER", year2: 26, nextNumber: 79 }),
    },
  };

  await createGreenLevelWorkOrdersFromPlan(tx, { planId: plan.id }, createDeps());

  assert.equal(created[0].lines.create[0].qty, "7");
  assert.equal(created[0].lines.create[0].plannedQty, "7");
});

test("already placed GL WOs are excluded from new GL WO balance", async () => {
  const plan = createPlan([{ fgItemId: 101, greenReplenishmentQty: 10, itemName: "FG A" }]);
  const tx = {
    monthlyProductionPlan: { findUnique: async () => plan },
    workOrder: {
      findMany: async () => [
        {
          id: 1,
          status: "PENDING",
          lines: [{ fgItemId: 101, plannedQty: 10, qty: 10 }],
          productionMaterialRequests: [],
        },
      ],
      create: async () => {
        throw new Error("should not create duplicate GL WO");
      },
    },
  };

  const result = await createGreenLevelWorkOrdersFromPlan(tx, { planId: plan.id }, createDeps());

  assert.equal(result.created, false);
  assert.equal(result.skippedReason, "ZERO_EXECUTABLE_QTY");
});
