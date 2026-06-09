const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  getGreenLevels,
  getLast6PeriodKeysBefore,
  aggregateMonthlyScheduleTotals,
  computeGreenBaseByItem,
  computeZoneQuantities,
  resolveZonePercents,
  shortageForGreenTarget,
  classifyGreenLevelStatus,
  STOCK_SCOPE,
} = require("../../src/services/monthlyPlanningGreenLevelService");

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
    item: {
      id: overrides.itemId ?? 101,
      itemName: overrides.itemName ?? "Part A",
      itemType: "FG",
      unit: "NOS",
      redThresholdPercent: overrides.redThresholdPercent ?? 40,
      yellowThresholdPercent: overrides.yellowThresholdPercent ?? 70,
    },
  };
}

function lockedSheet(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    salesOrderId: overrides.salesOrderId ?? 45,
    cycleId: overrides.cycleId ?? 3,
    periodKey: overrides.periodKey ?? "2026-03",
    version: overrides.version ?? 1,
    status: "LOCKED",
    lines: overrides.lines ?? [fgLine()],
    ...overrides,
  };
}

function createReadOnlyMockDb({ sheets = [], fgItems = [] } = {}) {
  const models = [
    "requirementSheet",
    "requirementSheetLine",
    "item",
    "salesOrderCycle",
    "workOrder",
    "productionMaterialRequest",
    "materialRequirement",
  ];
  const db = {
    requirementSheet: {
      findMany: async ({ where }) =>
        sheets.filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.periodKey?.in && !where.periodKey.in.includes(s.periodKey)) return false;
          return true;
        }),
    },
    item: {
      findMany: async () => fgItems,
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

describe("monthlyPlanningGreenLevelService.getLast6PeriodKeysBefore", () => {
  it("T1: returns six months immediately before anchor (anchor excluded)", () => {
    const keys = getLast6PeriodKeysBefore("2026-07");
    assert.deepEqual(keys, [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });
});

describe("monthlyPlanningGreenLevelService.computeGreenBaseByItem", () => {
  it("T1: uses MAX of monthly totals across the six-month window", () => {
    const monthlyByItem = new Map([
      [
        101,
        new Map([
          ["2026-01", 18000],
          ["2026-02", 20000],
          ["2026-03", 21000],
          ["2026-04", 17000],
          ["2026-05", 19000],
          ["2026-06", 16000],
        ]),
      ],
    ]);
    const history = getLast6PeriodKeysBefore("2026-07");
    const baseByItem = computeGreenBaseByItem(monthlyByItem, history);
    assert.equal(baseByItem.get(101), 21000);
  });
});

describe("monthlyPlanningGreenLevelService.aggregateMonthlyScheduleTotals", () => {
  it("T2: aggregates multiple locked RS in the same month for the same FG", () => {
    const totals = aggregateMonthlyScheduleTotals([
      lockedSheet({
        id: 1,
        salesOrderId: 10,
        periodKey: "2026-03",
        lines: [fgLine({ requirementQty: 12000 })],
      }),
      lockedSheet({
        id: 2,
        salesOrderId: 20,
        periodKey: "2026-03",
        lines: [fgLine({ requirementQty: 9000 })],
      }),
    ]);
    assert.equal(totals.get(101).get("2026-03"), 21000);
  });
});

describe("monthlyPlanningGreenLevelService.computeZoneQuantities", () => {
  it("T5: calculates green, yellow, and red quantities from base and item percents", () => {
    const zones = computeZoneQuantities(21000, {
      greenPercent: 100,
      yellowPercent: 70,
      redPercent: 40,
    });
    assert.equal(zones.baseQty, 21000);
    assert.equal(zones.greenQty, 21000);
    assert.equal(zones.yellowQty, 14700);
    assert.equal(zones.redQty, 8400);
  });
});

describe("monthlyPlanningGreenLevelService.getGreenLevels", () => {
  it("T3/T4: ignores DRAFT RS and uses LOCKED schedule history only", async () => {
    const history = getLast6PeriodKeysBefore("2026-07");
    const db = createReadOnlyMockDb({
      sheets: [
        lockedSheet({ id: 1, periodKey: "2026-03", lines: [fgLine({ requirementQty: 21000 })] }),
        lockedSheet({
          id: 2,
          periodKey: "2026-04",
          status: "DRAFT",
          lines: [fgLine({ requirementQty: 99999 })],
        }),
      ],
      fgItems: [
        {
          id: 101,
          itemName: "Part A",
          unit: "NOS",
          redThresholdPercent: 40,
          yellowThresholdPercent: 70,
        },
      ],
    });
    const res = await getGreenLevels({
      db,
      periodKey: "2026-07",
      loadGlobalStockBreakdown: emptyStockBreakdown,
    });
    assert.equal(res.anchorPeriodKey, "2026-07");
    assert.deepEqual(res.historyPeriodKeys, history);
    const row = res.items.find((i) => i.itemId === 101);
    assert.equal(row.baseQty, 21000);
    assert.equal(row.freeFgStock, 0);
    assert.equal(row.greenQty, 21000);
    assert.equal(row.yellowQty, 14700);
    assert.equal(row.redQty, 8400);
    assert.equal(row.monthlyScheduleTotals["2026-03"], 21000);
    assert.equal(row.monthlyScheduleTotals["2026-04"], undefined);
  });

  it("T2: multiple locked RS in same month aggregate before MAX selection", async () => {
    const db = createReadOnlyMockDb({
      sheets: [
        lockedSheet({
          id: 1,
          salesOrderId: 10,
          periodKey: "2026-02",
          lines: [fgLine({ requirementQty: 18000 })],
        }),
        lockedSheet({
          id: 2,
          salesOrderId: 20,
          periodKey: "2026-02",
          lines: [fgLine({ requirementQty: 2000 })],
        }),
        lockedSheet({
          id: 3,
          salesOrderId: 30,
          periodKey: "2026-03",
          lines: [fgLine({ requirementQty: 15000 })],
        }),
      ],
      fgItems: [
        {
          id: 101,
          itemName: "Part A",
          unit: "NOS",
          redThresholdPercent: 40,
          yellowThresholdPercent: 70,
        },
      ],
    });
    const res = await getGreenLevels({
      db,
      periodKey: "2026-07",
      loadGlobalStockBreakdown: emptyStockBreakdown,
    });
    const row = res.items.find((i) => i.itemId === 101);
    assert.equal(row.monthlyScheduleTotals["2026-02"], 20000);
    assert.equal(row.baseQty, 20000);
  });

  it("T6: performs no write operations (read-only)", async () => {
    const db = createReadOnlyMockDb({
      sheets: [lockedSheet()],
      fgItems: [
        {
          id: 101,
          itemName: "Part A",
          unit: "NOS",
          redThresholdPercent: 40,
          yellowThresholdPercent: 70,
        },
      ],
    });
    await getGreenLevels({
      db,
      periodKey: "2026-07",
      loadGlobalStockBreakdown: emptyStockBreakdown,
    });
    assert.ok(true, "no write methods invoked");
  });

  it("T7: does not call RS update paths", async () => {
    let updateCalled = false;
    const db = createReadOnlyMockDb({
      sheets: [lockedSheet()],
      fgItems: [
        {
          id: 101,
          itemName: "Part A",
          unit: "NOS",
          redThresholdPercent: 40,
          yellowThresholdPercent: 70,
        },
      ],
    });
    db.requirementSheet.update = async () => {
      updateCalled = true;
      return {};
    };
    await getGreenLevels({
      db,
      periodKey: "2026-07",
      loadGlobalStockBreakdown: emptyStockBreakdown,
    });
    assert.equal(updateCalled, false);
  });
});

describe("monthlyPlanningGreenLevelService.resolveZonePercents", () => {
  it("defaults green to 100% and uses item master yellow/red when set", () => {
    const p = resolveZonePercents({
      yellowThresholdPercent: 70,
      redThresholdPercent: 40,
    });
    assert.equal(p.greenPercent, 100);
    assert.equal(p.yellowPercent, 70);
    assert.equal(p.redPercent, 40);
  });
});

function mockStockBreakdown(overrides = {}) {
  const byItem = overrides.byItem ?? new Map();
  return async () => byItem;
}

const emptyStockBreakdown = mockStockBreakdown();

describe("monthlyPlanningGreenLevelService.classifyGreenLevelStatus", () => {
  const green = 21000;
  const yellow = 16800;
  const red = 10500;

  it("T1: GREEN when free FG >= green qty", () => {
    assert.equal(classifyGreenLevelStatus(25000, green, yellow, red), "GREEN");
    assert.equal(classifyGreenLevelStatus(21000, green, yellow, red), "GREEN");
  });

  it("T2: YELLOW when free FG >= yellow and < green", () => {
    assert.equal(classifyGreenLevelStatus(18000, green, yellow, red), "YELLOW");
  });

  it("T3: RED when free FG >= red and < yellow", () => {
    assert.equal(classifyGreenLevelStatus(12000, green, yellow, red), "RED");
  });

  it("T4: CRITICAL when free FG < red qty", () => {
    assert.equal(classifyGreenLevelStatus(8000, green, yellow, red), "CRITICAL");
  });

  it("returns null when green target is zero", () => {
    assert.equal(classifyGreenLevelStatus(1000, 0, 0, 0), null);
  });
});

describe("monthlyPlanningGreenLevelService.shortageForGreenTarget", () => {
  it("T5: shortage = max(0, greenQty - freeFgStock)", () => {
    assert.equal(shortageForGreenTarget(21000, 18000), 3000);
    assert.equal(shortageForGreenTarget(21000, 25000), 0);
    assert.equal(shortageForGreenTarget(21000, 21000), 0);
  });
});

describe("monthlyPlanningGreenLevelService.getGreenLevels status integration", () => {
  const fgItem = {
    id: 101,
    itemName: "Part A",
    unit: "NOS",
    redThresholdPercent: 50,
    yellowThresholdPercent: 80,
  };

  it("T6: free FG reused from planning breakdown freeSurplusUsableQty", async () => {
    const db = createReadOnlyMockDb({
      sheets: [lockedSheet({ periodKey: "2026-03", lines: [fgLine({ requirementQty: 21000 })] })],
      fgItems: [fgItem],
    });
    const res = await getGreenLevels({
      db,
      periodKey: "2026-07",
      loadGlobalStockBreakdown: mockStockBreakdown({
        byItem: new Map([
          [
            101,
            {
              totalUsableQty: 24000,
              reservedForNormalDispatchQty: 3000,
              reservedForActiveNoQtyDispatchQty: 3000,
              freeSurplusUsableQty: 18000,
            },
          ],
        ]),
      }),
    });
    assert.equal(res.stockScope, STOCK_SCOPE);
    const row = res.items.find((i) => i.itemId === 101);
    assert.equal(row.freeFgStock, 18000);
    assert.equal(row.totalUsableFgStock, 24000);
    assert.equal(row.reservedNormalDispatchQty, 3000);
    assert.equal(row.reservedNoQtyDispatchQty, 3000);
    assert.equal(row.status, "YELLOW");
    assert.equal(row.shortageForGreenTarget, 3000);
  });

  it("T1–T4: status tiers via getGreenLevels join", async () => {
    const db = createReadOnlyMockDb({
      sheets: [lockedSheet({ lines: [fgLine({ requirementQty: 21000 })] })],
      fgItems: [fgItem],
    });
    const cases = [
      { free: 25000, status: "GREEN", shortage: 0 },
      { free: 18000, status: "YELLOW", shortage: 3000 },
      { free: 12000, status: "RED", shortage: 9000 },
      { free: 8000, status: "CRITICAL", shortage: 13000 },
    ];
    for (const c of cases) {
      const res = await getGreenLevels({
        db,
        periodKey: "2026-07",
        loadGlobalStockBreakdown: mockStockBreakdown({
          byItem: new Map([[101, { freeSurplusUsableQty: c.free }]]),
        }),
      });
      const row = res.items.find((i) => i.itemId === 101);
      assert.equal(row.status, c.status, `free=${c.free}`);
      assert.equal(row.shortageForGreenTarget, c.shortage, `free=${c.free}`);
    }
  });

  it("T7–T11: no stock, RS, WO, PMR, or procurement writes", async () => {
    const db = createReadOnlyMockDb({
      sheets: [lockedSheet()],
      fgItems: [fgItem],
    });
    let stockWrite = false;
    db.stockTransaction = { create: async () => { stockWrite = true; } };
    await getGreenLevels({
      db,
      periodKey: "2026-07",
      loadGlobalStockBreakdown: mockStockBreakdown({
        byItem: new Map([[101, { freeSurplusUsableQty: 5000 }]]),
      }),
    });
    assert.equal(stockWrite, false);
  });
});
