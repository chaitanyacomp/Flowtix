const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  PROCUREMENT_DEMAND_POOL,
  MIXED_PROCUREMENT_DEMAND_POOL_CODE,
  LEGACY_DEMAND_POOL_EXCLUDED_CODE,
  resolveDemandPoolForSourceType,
  sourceTypesForDemandPool,
  assertSingleDemandPoolFromSourceTypes,
  filterMrsByDemandPool,
} = require("../../src/services/procurementDemandPoolService");
const {
  buildProcurementPool,
  buildAllProcurementDemandPools,
  computeNetToBuy,
} = require("../../src/services/procurementPlanningService");
const { NO_QTY_PROCUREMENT_DEMAND_CODE } = require("../../src/services/procurementPipelineFirewall");
const { REGULAR_SO_PROCUREMENT_SOURCE } = require("../../src/services/regularSoProcurementSource");

function mrLine(id, sourceType, rmItemId = 70, remaining = 10) {
  return {
    id,
    rmItemId,
    requiredQty: remaining,
    shortageQty: remaining,
    procuredQty: 0,
    rmItem: { id: rmItemId, itemName: `RM ${rmItemId}`, unit: "KG" },
    materialRequirement: {
      id: 100 + id,
      docNo: `MR-${id}`,
      sourceType,
      salesOrder: sourceType === "SALES_ORDER" ? { id: 5, docNo: "SO-5" } : null,
      monthlyProductionPlan:
        sourceType === "MONTHLY_PLAN"
          ? { id: 1, periodKey: "2026-05", status: "APPROVED", currentRevision: 1, planSequenceNo: 1, planKind: "REGULAR" }
          : null,
    },
  };
}

function mockPoolDb(lines) {
  return {
    materialRequirementLine: {
      findMany: async ({ where }) => {
        const types = where?.materialRequirement?.sourceType?.in;
        let rows = lines;
        if (types?.length) {
          rows = rows.filter((ln) => types.includes(ln.materialRequirement.sourceType));
        }
        return rows;
      },
    },
    purchaseRequestLineSourceLink: { findMany: async () => [] },
    rmPurchaseOrder: { findMany: async () => [] },
    stockTransaction: { groupBy: async () => [] },
    location: { findFirst: async () => ({ id: 1 }) },
  };
}

describe("procurementDemandPoolService", () => {
  it("maps source types to separated demand pools", () => {
    assert.equal(resolveDemandPoolForSourceType("SALES_ORDER"), PROCUREMENT_DEMAND_POOL.REGULAR_SO);
    assert.equal(resolveDemandPoolForSourceType("MONTHLY_PLAN"), PROCUREMENT_DEMAND_POOL.MPRS);
    assert.equal(resolveDemandPoolForSourceType("STOCK_REPLENISHMENT"), PROCUREMENT_DEMAND_POOL.STOCK_REPLENISHMENT);
    assert.equal(resolveDemandPoolForSourceType("WORK_ORDER_PLANNING"), null);
  });

  it("REGULAR pool source types include SALES_ORDER only", () => {
    assert.deepEqual(sourceTypesForDemandPool(PROCUREMENT_DEMAND_POOL.REGULAR_SO), ["SALES_ORDER"]);
  });

  it("rejects mixed-pool procurement selections", () => {
    assert.throws(
      () => assertSingleDemandPoolFromSourceTypes(["SALES_ORDER", "MONTHLY_PLAN"], "purchase request"),
      (e) => e && e.code === MIXED_PROCUREMENT_DEMAND_POOL_CODE,
    );
  });

  it("rejects legacy-only pool selections", () => {
    assert.throws(
      () => assertSingleDemandPoolFromSourceTypes(["WORK_ORDER_PLANNING"], "purchase request"),
      (e) => e && e.code === LEGACY_DEMAND_POOL_EXCLUDED_CODE,
    );
  });

  it("filterMrsByDemandPool keeps SALES_ORDER in REGULAR pool only", () => {
    const mrs = [
      { sourceType: "SALES_ORDER" },
      { sourceType: "MONTHLY_PLAN" },
      { sourceType: "WORK_ORDER_PLANNING" },
    ];
    const regular = filterMrsByDemandPool(mrs, PROCUREMENT_DEMAND_POOL.REGULAR_SO);
    assert.deepEqual(regular.map((m) => m.sourceType), ["SALES_ORDER"]);
  });
});

describe("buildProcurementPool — separated pools", () => {
  const lines = [
    mrLine(1, "SALES_ORDER", 70, 12),
    mrLine(2, "MONTHLY_PLAN", 70, 8),
    mrLine(3, "STOCK_REPLENISHMENT", 80, 5),
    mrLine(4, "WORK_ORDER_PLANNING", 90, 99),
  ];

  it("REGULAR pool includes SALES_ORDER MR only", async () => {
    const pool = await buildProcurementPool(mockPoolDb(lines), { demandPool: "REGULAR_SO" });
    assert.equal(pool.demandPool, PROCUREMENT_DEMAND_POOL.REGULAR_SO);
    assert.equal(pool.items.length, 1);
    assert.equal(pool.items[0].origins.length, 1);
    assert.equal(pool.items[0].origins[0].sourceType, "SALES_ORDER");
  });

  it("MPRS pool includes MONTHLY_PLAN MR only", async () => {
    const pool = await buildProcurementPool(mockPoolDb(lines), { demandPool: "MPRS" });
    assert.equal(pool.items.length, 1);
    assert.equal(pool.items[0].origins[0].sourceType, "MONTHLY_PLAN");
  });

  it("stock replenishment pool includes STOCK_REPLENISHMENT only", async () => {
    const pool = await buildProcurementPool(mockPoolDb(lines), { demandPool: "STOCK_REPLENISHMENT" });
    assert.equal(pool.items.length, 1);
    assert.equal(pool.items[0].origins[0].sourceType, "STOCK_REPLENISHMENT");
  });

  it("buildAllProcurementDemandPools returns three isolated pools", async () => {
    const pools = await buildAllProcurementDemandPools(mockPoolDb(lines));
    assert.ok(pools.REGULAR_SO);
    assert.ok(pools.MPRS);
    assert.ok(pools.STOCK_REPLENISHMENT);
    assert.equal(pools.REGULAR_SO.summary.originCount, 1);
    assert.equal(pools.MPRS.summary.originCount, 1);
    assert.equal(pools.STOCK_REPLENISHMENT.summary.originCount, 1);
  });
});

describe("P0/P1 guardrails preserved under P2", () => {
  it("open PO remains informational in net-to-buy", () => {
    assert.equal(computeNetToBuy(500, 400), 500);
  });

  it("REGULAR anchor constant unchanged", () => {
    assert.equal(REGULAR_SO_PROCUREMENT_SOURCE, "SALES_ORDER");
  });

  it("NO_QTY firewall code unchanged", () => {
    assert.equal(NO_QTY_PROCUREMENT_DEMAND_CODE, "NO_QTY_PROCUREMENT_DEMAND_BLOCKED");
  });
});
