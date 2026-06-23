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
  const free = overrides.free ?? 0;
  const physical = overrides.physical ?? free;
  const required = overrides.requiredQty ?? 0;
  return {
    itemId,
    requiredQty: required,
    physicalUsableStockQty: physical,
    freeStockQty: free,
    effectiveReservedQty: overrides.reserved ?? 0,
    incomingQty: overrides.incoming ?? 0,
    shortageAfterReservationQty: overrides.shortageAfterReservationQty,
    netShortageAfterIncomingQty: overrides.netGap,
    warnings: overrides.warnings ?? [],
  };
}

describe("monthlyPlanningRmRequirementCompositionService.getRmRequirementComposition", () => {
  it("P11: generates RM demand from greenShortage only (not suggestedProduction)", async () => {
    const db = createWriteGuardDb([{ id: 201, itemName: "RM-1", unit: "Kg", itemType: "RM" }]);
    const res = await getRmRequirementComposition({
      db,
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          {
            itemId: 10,
            itemName: "FG-A",
            unit: "Nos",
            greenShortage: 5000,
            greenTarget: 5000,
            freeFgStock: 0,
            suggestedProduction: 15000,
            productionRequirementQty: 10000,
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
        assert.equal(fgLines[0].fgQty, 5000);
        return { rmNeeded: new Map([[201, 600]]), missingChildBoms: [] };
      },
      loadAvailability: async ({ requiredQtyByItemId }) => {
        assert.equal(requiredQtyByItemId[201], 600);
        return [availabilityRow(201, { requiredQty: 600, physical: 200, free: 200 })];
      },
    });

    assert.equal(res.demandDriver, "FG_GREEN_SHORTAGE");
    assert.equal(res.summary.fgItemsWithGreenShortage, 1);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].rmRequirement, 600);
    assert.equal(res.items[0].availableRmStock, 200);
    assert.equal(res.items[0].netRmRequirement, 400);
    assert.equal(res.items[0].fgSources[0].greenShortage, 5000);
    assert.equal(res.items[0].fgSources[0].rmDemandQty, 600);
  });

  it("P11: skips FG with RS demand but zero green shortage", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          {
            itemId: 10,
            itemName: "FG-A",
            unit: "Nos",
            greenShortage: 0,
            suggestedProduction: 10000,
          },
          {
            itemId: 11,
            itemName: "FG-B",
            unit: "Nos",
            greenShortage: 1000,
            suggestedProduction: 1000,
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
        assert.equal(fgLines[0].fgItemId, 11);
        assert.equal(fgLines[0].fgQty, 1000);
        return { rmNeeded: new Map([[201, 100]]), missingChildBoms: [] };
      },
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 100, physical: 0 })],
    });

    assert.equal(res.summary.fgItemsWithGreenShortage, 1);
    assert.equal(res.items[0].rmRequirement, 100);
  });

  it("consolidates multiple FG green shortages into same RM total", async () => {
    let explodeCall = 0;
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          { itemId: 10, itemName: "FG-A", unit: "Nos", greenShortage: 1000, suggestedProduction: 5000 },
          { itemId: 11, itemName: "FG-B", unit: "Nos", greenShortage: 2000, suggestedProduction: 8000 },
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
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 500, physical: 300 })],
    });

    assert.equal(explodeCall, 3);
    assert.equal(res.summary.fgItemsWithGreenShortage, 2);
    assert.equal(res.items[0].rmRequirement, 500);
    assert.equal(res.items[0].netRmRequirement, 200);
    const traceTotal = res.items[0].fgSources.reduce((sum, s) => sum + s.rmDemandQty, 0);
    assert.equal(traceTotal, 500);
  });

  it("net RM uses total available stock (physical usable) minus RM requirement", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([{ itemId: 10, itemName: "FG-A", unit: "Nos", greenShortage: 5000 }]),
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
          physical: 350,
          free: 200,
          incoming: 100,
        }),
      ],
    });

    const row = res.items[0];
    assert.equal(row.rmRequirement, 500);
    assert.equal(row.availableRmStock, 350);
    assert.equal(row.netRmRequirement, 150);
    assert.equal(row.incomingPo, 100);
  });

  it("does not surface RM minimum stock on MPRS green planning path", async () => {
    const db = createWriteGuardDb([
      { id: 201, itemName: "RM-1", unit: "Kg", itemType: "RM", minimumStockQty: 400 },
    ]);
    const res = await getRmRequirementComposition({
      db,
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([{ itemId: 10, itemName: "FG-A", unit: "Nos", greenShortage: 1000 }]),
      loadFgBomMeta: async () => ({
        planningStatus: "READY",
        bomRevision: "R1",
        bom: { docNo: "BOM-1" },
        missingChildBomNames: [],
      }),
      aggregateRmDemand: async () => ({ rmNeeded: new Map([[201, 100]]), missingChildBoms: [] }),
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 100, physical: 150 })],
    });

    assert.equal(res.items[0].minimumStock, undefined);
    assert.equal(res.items[0].belowMinimumFlag, undefined);
    assert.equal(res.items[0].netRmRequirement, 0);
  });

  it("handles missing BOM FG in summary without RM demand from that FG", async () => {
    const res = await getRmRequirementComposition({
      periodKey: "2026-07",
      loadFgComposition: async () =>
        fgComposition([
          { itemId: 10, itemName: "FG-A", unit: "Nos", greenShortage: 1000 },
          { itemId: 11, itemName: "FG-B", unit: "Nos", greenShortage: 2000 },
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
      loadAvailability: async () => [availabilityRow(201, { requiredQty: 200, physical: 150 })],
    });

    assert.equal(res.summary.missingBomCount, 1);
    assert.equal(res.summary.fgItemsWithGreenShortage, 2);
    assert.equal(res.items[0].fgSources.length, 1);
    assert.equal(res.items[0].fgSources[0].fgItemId, 10);
  });

  it("performs no stock or procurement writes", async () => {
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
        greenShortage: 100,
        rmByItem: new Map([[201, 200]]),
      },
      {
        fgItemId: 11,
        fgItemName: "B",
        greenShortage: 50,
        rmByItem: new Map([[202, 50]]),
      },
    ]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].rmDemandQty, 200);
    assert.equal(sources[0].greenShortage, 100);
  });
});
