const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAcceptedSurplusBalance,
  loadNoQtyAcceptedSurplusForCycle,
} = require("../../src/services/noQtyAcceptedSurplusService");

function balance(overrides = {}) {
  return computeAcceptedSurplusBalance({
    priorAcceptedQty: 6500,
    priorCustomerDemandQty: 6000,
    priorNetDispatchedQty: 6000,
    currentGrossRequirementQty: 3500,
    ...overrides,
  });
}

function mockDb({ sheets = [], productions = [], dispatches = [], orderType = "NO_QTY" } = {}) {
  return {
    salesOrder: { findUnique: async () => ({ orderType }) },
    salesOrderCycle: {
      findFirst: async () => ({ id: 2, cycleNo: 2 }),
      findMany: async () => [{ id: 1 }],
    },
    requirementSheet: { findMany: async () => sheets },
    productionEntry: { findMany: async () => productions },
    dispatch: { findMany: async () => dispatches },
  };
}

describe("NO_QTY accepted surplus carry-forward", () => {
  it("1-2: derives 500 excess and a 3,000 next-cycle net requirement", () => {
    const result = balance();
    assert.equal(result.availableAcceptedSurplusQty, 500);
    assert.equal(result.allocatedAcceptedSurplusQty, 500);
    assert.equal(result.netProductionRequirementQty, 3000);
  });

  it("4-5: only QC-accepted quantity creates surplus", () => {
    assert.equal(balance({ priorAcceptedQty: 6300 }).availableAcceptedSurplusQty, 300);
    assert.equal(balance({ priorAcceptedQty: 6000 }).availableAcceptedSurplusQty, 0);
  });

  it("6-7: partially allocates once and leaves the cumulative remainder for the following cycle", () => {
    const cycle2 = balance({ currentGrossRequirementQty: 300 });
    assert.equal(cycle2.netProductionRequirementQty, 0);
    assert.equal(cycle2.unusedAcceptedSurplusQty, 200);
    const cycle3 = balance({ priorCustomerDemandQty: 6300, currentGrossRequirementQty: 1000 });
    assert.equal(cycle3.allocatedAcceptedSurplusQty, 200);
    assert.equal(cycle3.netProductionRequirementQty, 800);
  });

  it("8: dispatch/consumption caps usable excess without double-counting demand", () => {
    assert.equal(balance({ priorNetDispatchedQty: 6200 }).availableAcceptedSurplusQty, 300);
    assert.equal(balance({ priorNetDispatchedQty: 5900 }).availableAcceptedSurplusQty, 500);
  });

  it("3, 9, 10, 14: aggregates multiple WOs per FG, excludes pending/rejected, and reports zero pending after disposition", async () => {
    const sheets = [{ id: 1, cycleId: 1, version: 1, lines: [
      { itemId: 10, baseDemandQty: 6000 },
      { itemId: 20, baseDemandQty: 1000 },
    ] }];
    const productions = [
      { producedQty: 2000, workOrderLine: { fgItemId: 10 }, qcEntries: [{ acceptedQty: 2000, rejectedQty: 0 }] },
      { producedQty: 2000, workOrderLine: { fgItemId: 10 }, qcEntries: [{ acceptedQty: 2000, rejectedQty: 0 }] },
      { producedQty: 2500, workOrderLine: { fgItemId: 10 }, qcEntries: [{ acceptedQty: 2300, rejectedQty: 200 }] },
      { producedQty: 1200, workOrderLine: { fgItemId: 20 }, qcEntries: [{ acceptedQty: 1000, rejectedQty: 0 }] },
    ];
    const result = await loadNoQtyAcceptedSurplusForCycle(mockDb({ sheets, productions }), {
      salesOrderId: 1,
      targetCycleId: 2,
      grossRequirementByItem: new Map([[10, 3500], [20, 500]]),
    });
    assert.equal(result.get(10).availableAcceptedSurplusQty, 300);
    assert.equal(result.get(10).pendingQcQty, 0);
    assert.equal(result.get(20).availableAcceptedSurplusQty, 0);
    assert.equal(result.get(20).pendingQcQty, 200);
  });

  it("11: only the highest locked active RS version contributes prior demand", async () => {
    const db = mockDb({
      sheets: [
        { id: 2, cycleId: 1, version: 2, lines: [{ itemId: 10, baseDemandQty: 6000 }] },
        { id: 1, cycleId: 1, version: 1, lines: [{ itemId: 10, baseDemandQty: 9999 }] },
      ],
      productions: [{ producedQty: 6500, workOrderLine: { fgItemId: 10 }, qcEntries: [{ acceptedQty: 6500, rejectedQty: 0 }] }],
    });
    const result = await loadNoQtyAcceptedSurplusForCycle(db, {
      salesOrderId: 1, targetCycleId: 2, grossRequirementByItem: new Map([[10, 3500]]),
    });
    assert.equal(result.get(10).availableAcceptedSurplusQty, 500);
  });

  it("18: regular and Green Level flows are outside this NO_QTY resolver", async () => {
    const result = await loadNoQtyAcceptedSurplusForCycle(mockDb({ orderType: "NORMAL" }), {
      salesOrderId: 1, targetCycleId: 2, grossRequirementByItem: new Map([[10, 3500]]),
    });
    assert.equal(result.size, 0);
  });
});
