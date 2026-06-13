const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  getRsSuggestionsForPeriod,
  pickLatestLockedSheets,
  lineProductionRequirement,
} = require("../../src/services/monthlyPlanningRsSuggestionsService");

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

function fgLine(overrides = {}) {
  return {
    itemId: overrides.itemId ?? 101,
    requirementQty: overrides.requirementQty ?? 20000,
    shortfallQtySnapshot: overrides.shortfallQtySnapshot ?? 1000,
    suggestedWoQtySnapshot: overrides.suggestedWoQtySnapshot ?? 21000,
    item: {
      id: overrides.itemId ?? 101,
      itemName: overrides.itemName ?? "Part A",
      itemType: "FG",
      unit: "NOS",
      ...(overrides.item ?? {}),
    },
  };
}

function lockedSheet(overrides = {}) {
  const cycleId = overrides.cycleId ?? 3;
  const cycleNo = overrides.cycleNo ?? cycleId;
  return {
    id: overrides.id ?? 12,
    docNo: overrides.docNo ?? "RS-26-0012",
    salesOrderId: overrides.salesOrderId ?? 45,
    cycleId,
    cycle: overrides.cycle ?? { id: cycleId, cycleNo },
    periodKey: overrides.periodKey ?? "2026-07",
    version: overrides.version ?? 1,
    status: "LOCKED",
    salesOrder: { id: overrides.salesOrderId ?? 45, docNo: "SO-26-0045", orderType: "NO_QTY" },
    lines: overrides.lines ?? [fgLine()],
    ...overrides,
  };
}

function createReadOnlyMockDb(sheets) {
  const models = [
    "requirementSheet",
    "requirementSheetLine",
    "salesOrderCycle",
    "workOrder",
    "productionMaterialRequest",
    "materialRequirement",
  ];
  const db = {
    requirementSheet: {
      findMany: async ({ where }) => {
        return sheets.filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.periodKey && s.periodKey !== where.periodKey) return false;
          if (where.salesOrder?.orderType && s.salesOrder?.orderType !== where.salesOrder.orderType) {
            return false;
          }
          return true;
        });
      },
    },
  };
  for (const model of models) {
    if (!db[model]) db[model] = {};
    for (const method of WRITE_METHODS) {
      db[model][method] = throwOnWrite(`${model}.${method}`);
    }
  }
  db.$transaction = throwOnWrite("$transaction");
  return db;
}

describe("monthlyPlanningRsSuggestionsService.lineProductionRequirement", () => {
  it("derives production requirement as schedule + carry forward when snapshot missing", () => {
    const res = lineProductionRequirement({
      requirementQty: 20000,
      shortfallQtySnapshot: 1000,
      suggestedWoQtySnapshot: null,
    });
    assert.equal(res.scheduleQty, 20000);
    assert.equal(res.carryForwardQty, 1000);
    assert.equal(res.productionRequirementQty, 21000);
  });

  it("uses suggestedWoQtySnapshot when present on lock", () => {
    const res = lineProductionRequirement({
      requirementQty: 20000,
      shortfallQtySnapshot: 1000,
      suggestedWoQtySnapshot: 21000,
    });
    assert.equal(res.productionRequirementQty, 21000);
  });
});

describe("monthlyPlanningRsSuggestionsService.pickLatestLockedSheets", () => {
  it("keeps highest version per sales order + cycle + period", () => {
    const picked = pickLatestLockedSheets([
      lockedSheet({ id: 1, version: 1 }),
      lockedSheet({ id: 2, version: 2 }),
      lockedSheet({ id: 3, salesOrderId: 99, version: 1 }),
    ]);
    assert.equal(picked.length, 2);
    assert.equal(picked.find((s) => s.salesOrderId === 45).id, 2);
  });
});

describe("monthlyPlanningRsSuggestionsService.getRsSuggestionsForPeriod", () => {
  it("reads LOCKED NO_QTY sheets for the period and ignores DRAFT", async () => {
    const db = createReadOnlyMockDb([
      lockedSheet({ id: 12 }),
      lockedSheet({ id: 13, status: "DRAFT", salesOrderId: 46 }),
      lockedSheet({ id: 14, periodKey: "2026-08" }),
    ]);
    const res = await getRsSuggestionsForPeriod({ db, periodKey: "2026-07" });
    assert.equal(res.periodKey, "2026-07");
    assert.equal(res.sheetCount, 1);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].itemId, 101);
    assert.equal(res.items[0].scheduleQty, 20000);
    assert.equal(res.items[0].carryForwardQty, 1000);
    assert.equal(res.items[0].productionRequirementQty, 21000);
  });

  it("aggregates multiple locked RS for the same FG item", async () => {
    const db = createReadOnlyMockDb([
      lockedSheet({
        id: 12,
        salesOrderId: 45,
        lines: [fgLine({ requirementQty: 10000, shortfallQtySnapshot: 500, suggestedWoQtySnapshot: 10500 })],
      }),
      lockedSheet({
        id: 20,
        salesOrderId: 50,
        cycleId: 4,
        lines: [fgLine({ requirementQty: 8000, shortfallQtySnapshot: 200, suggestedWoQtySnapshot: 8200 })],
      }),
    ]);
    const res = await getRsSuggestionsForPeriod({ db, periodKey: "2026-07" });
    assert.equal(res.sheetCount, 2);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].scheduleQty, 18000);
    assert.equal(res.items[0].carryForwardQty, 700);
    assert.equal(res.items[0].productionRequirementQty, 18700);
    assert.equal(res.items[0].sources.length, 2);
  });

  it("aggregates multiple locked RS cycles on the same NO_QTY sales order for the period", async () => {
    const db = createReadOnlyMockDb([
      lockedSheet({
        id: 12,
        salesOrderId: 45,
        cycleId: 10,
        cycleNo: 1,
        docNo: "RS-26-0001",
        lines: [fgLine({ requirementQty: 5000, shortfallQtySnapshot: 0, suggestedWoQtySnapshot: 5000 })],
      }),
      lockedSheet({
        id: 20,
        salesOrderId: 45,
        cycleId: 11,
        cycleNo: 2,
        docNo: "RS-26-0002",
        lines: [fgLine({ requirementQty: 8000, shortfallQtySnapshot: 0, suggestedWoQtySnapshot: 8000 })],
      }),
    ]);
    const res = await getRsSuggestionsForPeriod({ db, periodKey: "2026-07" });
    assert.equal(res.sheetCount, 2);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].scheduleQty, 13000);
    assert.equal(res.items[0].productionRequirementQty, 13000);
    assert.equal(res.items[0].sources.length, 2);
    const cycleIds = res.items[0].sources.map((s) => s.cycleId).sort();
    assert.deepEqual(cycleIds, [10, 11]);
    const byDoc = Object.fromEntries(res.items[0].sources.map((s) => [s.requirementSheetDocNo, s]));
    assert.equal(byDoc["RS-26-0001"].cycleNo, 1);
    assert.equal(byDoc["RS-26-0001"].requirementQty, 5000);
    assert.equal(byDoc["RS-26-0002"].cycleNo, 2);
    assert.equal(byDoc["RS-26-0002"].requirementQty, 8000);
  });

  it("includes traceability fields on each source", async () => {
    const db = createReadOnlyMockDb([lockedSheet()]);
    const res = await getRsSuggestionsForPeriod({ db, periodKey: "2026-07" });
    const src = res.items[0].sources[0];
    assert.equal(src.requirementSheetId, 12);
    assert.equal(src.salesOrderId, 45);
    assert.equal(src.cycleId, 3);
    assert.equal(src.cycleNo, 3);
    assert.equal(src.requirementQty, 20000);
    assert.equal(src.shortfallQtySnapshot, 1000);
    assert.equal(src.suggestedWoQtySnapshot, 21000);
    assert.ok(src.requirementSheetDocNo);
    assert.ok(src.salesOrderDocNo);
  });

  it("skips non-FG lines", async () => {
    const db = createReadOnlyMockDb([
      lockedSheet({
        lines: [
          fgLine(),
          {
            itemId: 202,
            requirementQty: 99,
            shortfallQtySnapshot: 0,
            suggestedWoQtySnapshot: 99,
            item: { id: 202, itemName: "RM X", itemType: "RM", unit: "KG" },
          },
        ],
      }),
    ]);
    const res = await getRsSuggestionsForPeriod({ db, periodKey: "2026-07" });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].itemId, 101);
  });

  it("ignores CANCELLED sheets in MPRS reads", async () => {
    const db = createReadOnlyMockDb([
      lockedSheet({ id: 12, cycleId: 3, lines: [fgLine({ requirementQty: 5000 })], version: 1 }),
      lockedSheet({
        id: 13,
        status: "CANCELLED",
        cycleId: 3,
        lines: [fgLine({ requirementQty: 9999 })],
        version: 2,
      }),
      lockedSheet({ id: 20, cycleId: 4, lines: [fgLine({ requirementQty: 3000 })], version: 1 }),
    ]);
    const res = await getRsSuggestionsForPeriod({ db, periodKey: "2026-07" });
    assert.equal(res.sheetCount, 2);
    assert.equal(res.items[0].scheduleQty, 8000);
  });

  it("rejects invalid period keys", async () => {
    const db = createReadOnlyMockDb([]);
    await assert.rejects(
      () => getRsSuggestionsForPeriod({ db, periodKey: "bad" }),
      (e) => e.code === "INVALID_PERIOD",
    );
  });
});
