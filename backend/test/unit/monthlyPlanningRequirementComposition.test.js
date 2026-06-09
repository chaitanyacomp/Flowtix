const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  getRequirementComposition,
  computeSuggestedProduction,
} = require("../../src/services/monthlyPlanningRequirementCompositionService");

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

function createWriteGuardDb() {
  const models = [
    "requirementSheet",
    "requirementSheetLine",
    "item",
    "salesOrderCycle",
    "workOrder",
    "productionMaterialRequest",
    "materialRequirement",
    "stockTransaction",
    "dispatch",
    "purchaseRequest",
    "materialRequirement",
  ];
  const db = {};
  for (const model of models) {
    db[model] = {};
    for (const method of WRITE_METHODS) {
      db[model][method] = throwOnWrite(`${model}.${method}`);
    }
  }
  db.$transaction = throwOnWrite("$transaction");
  return db;
}

function rsResponse(items, overrides = {}) {
  return {
    periodKey: overrides.periodKey ?? "2026-07",
    sheetCount: overrides.sheetCount ?? items.length,
    items,
  };
}

function greenResponse(items, overrides = {}) {
  return {
    anchorPeriodKey: overrides.anchorPeriodKey ?? "2026-07",
    historyPeriodKeys: overrides.historyPeriodKeys ?? ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
    items,
  };
}

describe("monthlyPlanningRequirementCompositionService.computeSuggestedProduction", () => {
  it("adds three components (no MAX)", () => {
    assert.equal(computeSuggestedProduction(100, 50, 25), 175);
    assert.equal(computeSuggestedProduction(0, 0, 11750), 11750);
  });
});

describe("monthlyPlanningRequirementCompositionService.getRequirementComposition", () => {
  it("T1 RS-only recommendation uses scheduleQty not productionRequirementQty", async () => {
    const db = createWriteGuardDb();
    const res = await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () =>
        rsResponse([
          {
            itemId: 101,
            itemName: "Part A",
            unit: "NOS",
            scheduleQty: 20000,
            carryForwardQty: 0,
            productionRequirementQty: 20000,
            sources: [],
          },
        ]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].rsRequirement, 20000);
    assert.equal(res.items[0].carryForward, 0);
    assert.equal(res.items[0].greenShortage, 0);
    assert.equal(res.items[0].suggestedProduction, 20000);
  });

  it("T2 carry-forward-only recommendation", async () => {
    const res = await getRequirementComposition({
      periodKey: "2026-07",
      loadRsSuggestions: async () =>
        rsResponse([
          {
            itemId: 102,
            itemName: "Part B",
            unit: "NOS",
            scheduleQty: 0,
            carryForwardQty: 1500,
            productionRequirementQty: 1500,
            sources: [],
          },
        ]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.equal(res.items[0].rsRequirement, 0);
    assert.equal(res.items[0].carryForward, 1500);
    assert.equal(res.items[0].greenShortage, 0);
    assert.equal(res.items[0].suggestedProduction, 1500);
  });

  it("T3 green-shortage-only recommendation", async () => {
    const res = await getRequirementComposition({
      periodKey: "2026-07",
      loadRsSuggestions: async () => rsResponse([]),
      loadGreenLevels: async () =>
        greenResponse([
          {
            itemId: 65,
            itemName: "Cap",
            unit: "Nos",
            greenQty: 11800,
            shortageForGreenTarget: 11750,
            freeFgStock: 50,
            status: "CRITICAL",
          },
        ]),
    });
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].rsRequirement, 0);
    assert.equal(res.items[0].carryForward, 0);
    assert.equal(res.items[0].greenShortage, 11750);
    assert.equal(res.items[0].suggestedProduction, 11750);
  });

  it("T4 combined additive recommendation", async () => {
    const res = await getRequirementComposition({
      periodKey: "2026-07",
      loadRsSuggestions: async () =>
        rsResponse([
          {
            itemId: 101,
            itemName: "Part A",
            unit: "NOS",
            scheduleQty: 20000,
            carryForwardQty: 1000,
            productionRequirementQty: 21000,
            sources: [],
          },
        ]),
      loadGreenLevels: async () =>
        greenResponse([
          {
            itemId: 101,
            itemName: "Part A",
            unit: "NOS",
            greenQty: 5000,
            shortageForGreenTarget: 4800,
            freeFgStock: 200,
            status: "CRITICAL",
          },
        ]),
    });
    assert.equal(res.items[0].rsRequirement, 20000);
    assert.equal(res.items[0].carryForward, 1000);
    assert.equal(res.items[0].greenShortage, 4800);
    assert.equal(res.items[0].suggestedProduction, 25800);
  });

  it("T5 union of RS-only and Green-only items", async () => {
    const res = await getRequirementComposition({
      periodKey: "2026-07",
      loadRsSuggestions: async () =>
        rsResponse([
          {
            itemId: 101,
            itemName: "RS Only",
            unit: "NOS",
            scheduleQty: 500,
            carryForwardQty: 0,
            productionRequirementQty: 500,
            sources: [],
          },
        ]),
      loadGreenLevels: async () =>
        greenResponse([
          {
            itemId: 66,
            itemName: "Green Only",
            unit: "Nos",
            greenQty: 9300,
            shortageForGreenTarget: 9150,
            freeFgStock: 150,
            status: "CRITICAL",
          },
        ]),
    });
    assert.equal(res.items.length, 2);
    const rsOnly = res.items.find((i) => i.itemId === 101);
    const greenOnly = res.items.find((i) => i.itemId === 66);
    assert.equal(rsOnly.suggestedProduction, 500);
    assert.equal(greenOnly.suggestedProduction, 9150);
  });

  it("T6 no double counting of carry forward (schedule + CF + green, not productionRequirement + CF)", async () => {
    const res = await getRequirementComposition({
      periodKey: "2026-07",
      loadRsSuggestions: async () =>
        rsResponse([
          {
            itemId: 101,
            itemName: "Part A",
            unit: "NOS",
            scheduleQty: 20000,
            carryForwardQty: 1000,
            productionRequirementQty: 21000,
            sources: [],
          },
        ]),
      loadGreenLevels: async () =>
        greenResponse([
          {
            itemId: 101,
            itemName: "Part A",
            unit: "NOS",
            greenQty: 0,
            shortageForGreenTarget: 0,
            freeFgStock: 0,
            status: null,
          },
        ]),
    });
    assert.equal(res.items[0].suggestedProduction, 21000);
    assert.notEqual(res.items[0].suggestedProduction, 22000);
    assert.equal(res.items[0].productionRequirementQty, 21000);
  });

  it("T7 performs no RS writes", async () => {
    const db = createWriteGuardDb();
    await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () => rsResponse([]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.ok(true);
  });

  it("T8 performs no WO writes", async () => {
    const db = createWriteGuardDb();
    await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () => rsResponse([]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.ok(true);
  });

  it("T9 performs no PMR writes", async () => {
    const db = createWriteGuardDb();
    await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () => rsResponse([]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.ok(true);
  });

  it("T10 performs no stock writes", async () => {
    const db = createWriteGuardDb();
    await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () => rsResponse([]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.ok(true);
  });

  it("T11 performs no procurement creation", async () => {
    const db = createWriteGuardDb();
    await getRequirementComposition({
      db,
      periodKey: "2026-07",
      loadRsSuggestions: async () => rsResponse([]),
      loadGreenLevels: async () => greenResponse([]),
    });
    assert.ok(true);
  });

  it("rejects invalid period keys", async () => {
    await assert.rejects(
      () =>
        getRequirementComposition({
          periodKey: "bad",
          loadRsSuggestions: async () => rsResponse([]),
          loadGreenLevels: async () => greenResponse([]),
        }),
      (e) => e.code === "INVALID_PERIOD",
    );
  });
});
