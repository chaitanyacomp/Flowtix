const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  issueRmStockForProductionBatchAtProductionLocations,
} = require("../../src/services/productionRmReadinessService");
const { RM_CONSUMPTION_ROUNDING_TOLERANCE_KG } = require("../../src/services/productionRmConsumptionService");

const PP_ITEM_ID = 63;
const PROD_LOC_ID = 2;

/** Mock tx: full WO issue 4.035, first batch consumed 2.018, on-hand 2.017 for second 500 FG batch. */
function makeProductionLocationTx(onHandKg = 2.017) {
  const created = [];
  const tx = {
    materialIssueNote: {
      findMany: async () => [{ toLocationId: PROD_LOC_ID }],
    },
    stockTransaction: {
      aggregate: async () => ({
        _sum: { qtyIn: String(onHandKg), qtyOut: "0" },
      }),
      create: async ({ data }) => {
        created.push(data);
        return { id: created.length };
      },
    },
  };
  return { tx, created };
}

describe("NO_QTY production approve — RM issue rounding tolerance", () => {
  it("passes second 500 FG batch when PP shortage is 0.001 Kg (2.017 on-hand, 2.018 need)", async () => {
    const { tx, created } = makeProductionLocationTx(2.017);
    await issueRmStockForProductionBatchAtProductionLocations(tx, {
      productionId: 277,
      workOrderId: 249,
      actualQtyByItemId: new Map([[PP_ITEM_ID, 2.018]]),
      roundingToleranceKg: RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
    });
    const totalOut = created.reduce((s, row) => s + Number(row.qtyOut), 0);
    assert.ok(Math.abs(totalOut - 2.018) < 1e-6, `expected 2.018 Kg issued, got ${totalOut}`);
    assert.equal(created.length, 2, "main drain + tolerance top-up");
    assert.ok(Number(created[1].qtyOut) <= RM_CONSUMPTION_ROUNDING_TOLERANCE_KG + 1e-6);
  });

  it("blocks same batch when tolerance is zero (NO_QTY path before fix)", async () => {
    const { tx } = makeProductionLocationTx(2.017);
    await assert.rejects(
      () =>
        issueRmStockForProductionBatchAtProductionLocations(tx, {
          productionId: 277,
          workOrderId: 249,
          actualQtyByItemId: new Map([[PP_ITEM_ID, 2.018]]),
          roundingToleranceKg: 0,
        }),
      (err) => {
        assert.equal(err.code, "PRODUCTION_RM_INSUFFICIENT");
        const m = String(err.message).match(/short:\s*([\d.]+)/i);
        assert.ok(m, err.message);
        assert.ok(Number(m[1]) < 0.002, `expected sub-0.002 Kg short, got ${m[1]}`);
        return true;
      },
    );
  });

  it("still blocks when shortage exceeds 0.01 Kg tolerance", async () => {
    const { tx } = makeProductionLocationTx(2);
    await assert.rejects(
      () =>
        issueRmStockForProductionBatchAtProductionLocations(tx, {
          productionId: 277,
          workOrderId: 249,
          actualQtyByItemId: new Map([[PP_ITEM_ID, 2.018]]),
          roundingToleranceKg: RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
        }),
      (err) => err.code === "PRODUCTION_RM_INSUFFICIENT",
    );
  });
});
