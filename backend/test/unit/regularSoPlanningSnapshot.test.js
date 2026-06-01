const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { computePlannedQtyFromCustomerBuffer } = require("../../src/services/regularSoBufferQty");
const {
  fgDemandInputFromPlanningView,
  fgShortageDemandInputFromPlanningView,
  snapshotLineFromSalesOrderLine,
} = require("../../src/services/regularSoPlanningSnapshotService");

describe("regular SO buffer planning", () => {
  it("preserves decimal buffer percentages end-to-end", () => {
    assert.equal(computePlannedQtyFromCustomerBuffer(15000, 0.5), 15075);
    assert.equal(computePlannedQtyFromCustomerBuffer(15000, 0.25), 15037.5);
    assert.equal(computePlannedQtyFromCustomerBuffer(15000, 1.75), 15262.5);
    assert.equal(computePlannedQtyFromCustomerBuffer(15000, 2.5), 15375);
  });
});

describe("snapshotLineFromSalesOrderLine (DERIVED line shape contract)", () => {
  const soLine = { id: 139, itemId: 66, item: { itemName: "Nozzle" }, customerPoQty: 10000, qty: 10000 };

  it("exposes both legacy and FG-identity fields mapped to the same values", () => {
    const line = snapshotLineFromSalesOrderLine(soLine, 0, 0);
    // legacy fields preserved
    assert.equal(line.itemId, 66);
    assert.equal(line.salesOrderLineId, 139);
    assert.equal(line.itemName, "Nozzle");
    // FG identity contract expected by the demand helpers
    assert.equal(line.fgItemId, 66);
    assert.equal(line.lineId, 139);
    assert.equal(line.fgName, "Nozzle");
  });

  it("fresh pilot: DERIVED line (itemId=66, rmPlanningQty=10000) survives helper filtering with fgItemId=66", () => {
    const line = snapshotLineFromSalesOrderLine(soLine, 0, 0);
    assert.equal(line.rmPlanningQty, 10000);

    const view = { lines: [line] };
    const shortage = fgShortageDemandInputFromPlanningView(view);
    assert.equal(shortage.length, 1);
    assert.equal(shortage[0].fgItemId, 66);
    assert.equal(shortage[0].fgQty, 10000);

    // The planning-contract helper also resolves identity now (qty path still plannedProductionQty-first).
    const planning = fgDemandInputFromPlanningView(view);
    assert.equal(planning.length, 1);
    assert.equal(planning[0].fgItemId, 66);
  });

  it("keeps full planned production as RM planning qty (surplus FG is informational only)", () => {
    const line = snapshotLineFromSalesOrderLine({ id: 1, itemId: 7, item: { itemName: "X" }, customerPoQty: 1000, qty: 1000 }, 0, 250);
    assert.equal(line.plannedProductionQty, 1000);
    assert.equal(line.fgStockAdjustmentQty, 250);
    assert.equal(line.rmPlanningQty, 1000);
  });
});

describe("fgShortageDemandInputFromPlanningView (operational shortage detection)", () => {
  it("uses rmPlanningQty when plannedProductionQty is 0 (explicit 0 must not suppress fallback)", () => {
    const view = {
      lines: [
        { lineId: 1, fgItemId: 100, fgName: "Nozzle", plannedProductionQty: 0, rmPlanningQty: 10000, toProduce: 10000 },
      ],
    };
    const out = fgShortageDemandInputFromPlanningView(view);
    assert.equal(out.length, 1);
    assert.equal(out[0].fgItemId, 100);
    assert.equal(out[0].fgQty, 10000);

    // Contrast: the planning-contract helper drops this line (the bug being fixed).
    assert.equal(fgDemandInputFromPlanningView(view).length, 0);
  });

  it("leaves equal/positive plannedProductionQty and rmPlanningQty unchanged", () => {
    const view = {
      lines: [
        { lineId: 1, fgItemId: 100, fgName: "Nozzle", plannedProductionQty: 8160, rmPlanningQty: 8160, toProduce: 8160 },
      ],
    };
    assert.equal(fgShortageDemandInputFromPlanningView(view)[0].fgQty, 8160);
  });

  it("uses full plannedProductionQty for operational demand (not net of FG stock)", () => {
    const view = {
      lines: [
        { lineId: 1, fgItemId: 100, fgName: "Nozzle", plannedProductionQty: 10000, rmPlanningQty: 6000, toProduce: 6000 },
      ],
    };
    assert.equal(fgShortageDemandInputFromPlanningView(view)[0].fgQty, 10000);
  });

  it("falls back to plannedProductionQty, then toProduce, when earlier candidates are non-positive", () => {
    assert.equal(
      fgShortageDemandInputFromPlanningView({
        lines: [{ fgItemId: 1, rmPlanningQty: 0, plannedProductionQty: 500, toProduce: 0 }],
      })[0].fgQty,
      500,
    );
    assert.equal(
      fgShortageDemandInputFromPlanningView({
        lines: [{ fgItemId: 1, rmPlanningQty: 0, plannedProductionQty: 0, toProduce: 250 }],
      })[0].fgQty,
      250,
    );
  });

  it("filters out all-zero quantity rows and note rows", () => {
    const out = fgShortageDemandInputFromPlanningView({
      lines: [
        { fgItemId: 1, rmPlanningQty: 0, plannedProductionQty: 0, toProduce: 0 },
        { fgItemId: 2, note: "FG stock already covers demand", rmPlanningQty: 999 },
        { fgItemId: 3, rmPlanningQty: 7 },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].fgItemId, 3);
    assert.equal(out[0].fgQty, 7);
  });
});
