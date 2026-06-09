const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  getRmRequirementComposition,
  buildFgSourcesForRm,
} = require("../../src/services/monthlyPlanningRmRequirementCompositionService");

const WRITE_METHODS = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
];

function throwOnWrite(name) {
  return async () => {
    throw new Error(`Unexpected write: ${name}`);
  };
}

function createWriteGuardDb(itemRows = []) {
  const models = [
    "requirementSheet",
    "requirementSheetLine",
    "item",
    "bom",
    "bomLine",
    "salesOrderCycle",
    "workOrder",
    "productionMaterialRequest",
    "materialRequirement",
    "stockTransaction",
    "dispatch",
    "purchaseRequest",
    "rmPurchaseOrder",
    "location",
  ];
  const db = {
    item: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [];
        return itemRows.filter((row) => ids.includes(row.id));
      },
    },
  };
  for (const model of models) {
    if (!db[model]) db[model] = {};
    for (const method of WRITE_METHODS) {
      if (!db[model][method]) db[model][method] = throwOnWrite(`${model}.${method}`);
    }
  }
  db.$transaction = throwOnWrite("$transaction");
  return db;
}

function fgComposition(items, overrides = {}) {
  return {
    periodKey: overrides.periodKey ?? "2026-07",
    anchorPeriodKey: overrides.anchorPeriodKey ?? "2026-07",
    itemCount: items.length,
    items,
  };
}

function availabilityRow(itemId, overrides = {}) {
  return {
    itemId,
    requiredQty: overrides.requiredQty ?? 0,
    physicalUsableStockQty: overrides.physical ?? 0,
    freeStockQty: overrides.free ?? 0,
    effectiveReservedQty: overrides.reserved ?? 0,
    incomingQty: overrides.incoming ?? 0,
    netShortageAfterIncomingQty: overrides.netGap ?? 0,
    warnings: overrides.warnings ?? [],
  };
}

describe("monthlyPlanningRmRequirementCompositionService.getRmRequirementComposition", () => {
  it("generates RM demand from suggestedProduction only", async () => {
    const db = createWriteGuardDb([
      { id: 201, itemName: "RM-1", unit: "Kg", itemType: "RM", minimumStockQty: 50 },
    ]);
    const res = await getRmRequirementComposition({
      db,
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          {
            itemId: 10,
            itemName: "FG-A",
            unit: "Nos",
            suggestedProduction: 10000,
          },
        ]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async (_db, fgLines) => {
        assert.equal(fgLines.length, 1);
        assert.equal(fgLines[0].fgQty, 10000);
        return { rmNeeded: new Map([[201, 250]]), missingChildBoms: [] };
      },
      loadAvailability: async ({ requiredQtyByItemId }) => {
        assert.equal(requiredQtyByItemId[201], 250);
        return [availabilityRow(201, { requiredQty: 250, free: 200, incoming: 100, netGap: 0 })];
      },
    });

    assert.equal(res.summary.fgItemsPlanned, 1);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].totalRmDemand, 250);
    assert.equal(res.items[0].fgSources[0].suggestedProduction, 10000);
    assert.equal(res.items[0].fgSources[0].rmDemandQty, 250);
  });

  it("consolidates multiple FG into same RM total", async () => {
    let explodeCall = 0;
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          { itemId: 10, itemName: "FG-A", unit: "Nos", suggestedProduction: 1000 },
          { itemId: 11, itemName: "FG-B", unit: "Nos", suggestedProduction: 2000 },
        ]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async (_db, fgLines) => {
        explodeCall += 1;
        if (fgLines.length === 2) {
          return { rmNeeded: new Map([[201, 500]]), missingChildBoms: [] };
        }
        if (fgLines[0].fgItemId === 10) {
          return { rmNeeded: new Map([[201, 200]]), missingChildBoms: [] };
        }
        return { rmNeeded: new Map([[201, 300]]), missingChildBoms: [] };
      },
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 500, netGap: 200 })],
    });

    assert.equal(explodeCall, 3);
    assert.equal(res.summary.fgItemsPlanned, 2);
    assert.equal(res.items[0].totalRmDemand, 500);
    assert.equal(res.items[0].fgSources.length, 2);
    const traceTotal = res.items[0].fgSources.reduce((sum, s) => sum + s.rmDemandQty, 0);
    assert.equal(traceTotal, 500);
  });

  it("reuses netShortageAfterIncomingQty for net gap", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([{ itemId: 10, itemName: "FG-A", unit: "Nos", suggestedProduction: 5000 }]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async () => ({ rmNeeded: new Map([[201, 500]]), missingChildBoms: [] }),
      loadAvailability: async () => [
        availabilityRow(201, {
          requiredQty: 500,
          free: 200,
          incoming: 100,
          netGap: 200,
        }),
      ],
    });

    const row = res.items[0];
    assert.equal(row.freeStock, 200);
    assert.equal(row.incomingPo, 100);
    assert.equal(row.netAvailable, 300);
    assert.equal(row.netGap, 200);
  });

  it("shows minimum stock visibility without adding to demand or gap", async () => {
    const db = createWriteGuardDb([
      { id: 201, itemName: "RM-1", unit: "Kg", itemType: "RM", minimumStockQty: 400 },
    ]);
    const res = await getRmRequirementComposition({
      db,
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([{ itemId: 10, itemName: "FG-A", unit: "Nos", suggestedProduction: 1000 }]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async () => ({ rmNeeded: new Map([[201, 100]]), missingChildBoms: [] }),
      loadAvailability: async () => [
        availabilityRow(201, { requiredQty: 100, free: 150, incoming: 0, netGap: 0 }),
      ],
    });

    assert.equal(res.items[0].minimumStock, 400);
    assert.equal(res.items[0].belowMinimumFlag, true);
    assert.equal(res.items[0].totalRmDemand, 100);
    assert.equal(res.items[0].netGap, 0);
  });

  it("handles missing BOM FG in summary without RM demand from that FG", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          { itemId: 10, itemName: "FG-A", unit: "Nos", suggestedProduction: 1000 },
          { itemId: 11, itemName: "FG-B", unit: "Nos", suggestedProduction: 2000 },
        ]),
      loadFgBomMeta: async (_db, fgItemId) => {
        if (fgItemId === 11) {
          return { planningStatus: "MISSING_BOM", bomRevision: null, bom: null, missingChildBomNames: [] };
        }
        return {
          planningStatus: "READY",
          bomRevision: "R1",
          bom: { docNo: "BOM-1" },
          missingChildBomNames: [],
        };
      },
      aggregateRmDemand: (() => {
        let callIndex = 0;
        return async (_db, fgLines) => {
          callIndex += 1;
          if (callIndex === 1) {
            assert.equal(fgLines.length, 2);
            assert.equal(fgLines.find((f) => f.fgItemId === 11).bomMissing, true);
          }
          return { rmNeeded: new Map([[201, 200]]), missingChildBoms: [] };
        };
      })(),
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 200, netGap: 50 })],
    });

    assert.equal(res.summary.missingBomCount, 1);
    assert.equal(res.summary.fgItemsPlanned, 2);
    assert.equal(res.items[0].totalRmDemand, 200);
    assert.equal(res.items[0].fgSources.length, 1);
    assert.equal(res.items[0].fgSources[0].fgItemId, 10);
  });

  it("traceability fg source totals equal consolidated RM total", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          { itemId: 10, itemName: "FG-A", unit: "Nos", suggestedProduction: 4000 },
          { itemId: 11, itemName: "FG-B", unit: "Nos", suggestedProduction: 3000 },
          { itemId: 12, itemName: "FG-C", unit: "Nos", suggestedProduction: 3000 },
        ]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async (_db, fgLines) => {
        if (fgLines.length === 3) {
          return { rmNeeded: new Map([[201, 500]]), missingChildBoms: [] };
        }
        const map = {
          10: 200,
          11: 150,
          12: 150,
        };
        return {
          rmNeeded: new Map([[201, map[fgLines[0].fgItemId]]]),
          missingChildBoms: [],
        };
      },
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 500, netGap: 200 })],
    });

    const row = res.items[0];
    const traceSum = row.fgSources.reduce((sum, s) => sum + s.rmDemandQty, 0);
    assert.equal(traceSum, row.totalRmDemand);
    assert.equal(traceSum, 500);
  });

  it("skips FG with zero suggestedProduction", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          { itemId: 10, itemName: "FG-A", unit: "Nos", suggestedProduction: 0 },
          { itemId: 11, itemName: "FG-B", unit: "Nos", suggestedProduction: 1000 },
        ]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async (_db, fgLines) => {
        assert.equal(fgLines.length, 1);
        assert.equal(fgLines[0].fgItemId, 11);
        return { rmNeeded: new Map([[201, 100]]), missingChildBoms: [] };
      },
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 100, netGap: 0 })],
    });

    assert.equal(res.summary.fgItemsPlanned, 1);
  });

  it("performs no stock writes", async () => {
    const db = createWriteGuardDb();
    await getRmRequirementComposition({
      db,
      periodKey: "2026-07",
      loadFgComposition: async () => fgComposition([]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async () => ({ rmNeeded: new Map(), missingChildBoms: [] }),
      loadAvailability: async () => [],
    });
    assert.ok(true);
  });

  it("performs no procurement writes", async () => {
    const db = createWriteGuardDb();
    await getRmRequirementComposition({
      db,
      periodKey: "2026-07",
      loadFgComposition: async () => fgComposition([]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async () => ({ rmNeeded: new Map(), missingChildBoms: [] }),
      loadAvailability: async () => [],
    });
    assert.ok(true);
  });

  it("rejects invalid period keys", async () => {
    await assert.rejects(
      () =>
        getRmRequirementComposition({
          periodKey: "bad",
          loadFgComposition: async () => fgComposition([]),
          aggregateRmDemand: async () => ({ rmNeeded: new Map(), missingChildBoms: [] }),
          loadAvailability: async () => [],
        }),
      (e) => e.code === "INVALID_PERIOD",
    );
  });
});

describe("monthlyPlanningRmRequirementCompositionService.buildFgSourcesForRm", () => {
  it("filters zero contributions", () => {
    const sources = buildFgSourcesForRm(201, [
      {
        fgItemId: 10,
        fgItemName: "A",
        suggestedProduction: 100,
        rmByItem: new Map([[201, 200]]),
      },
      {
        fgItemId: 11,
        fgItemName: "B",
        suggestedProduction: 100,
        rmByItem: new Map([[202, 50]]),
      },
    ]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].rmDemandQty, 200);
  });
});
