const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  REGULAR_SO_PROCUREMENT_SOURCE,
  regularSoProcurementSourceTypes,
  isRegularSoProcurementSource,
} = require("../../src/services/regularSoProcurementSource");
const {
  findPendingWoPlanningMaterialRequirements,
  REGULAR_SO_PROCUREMENT_SOURCE: EXPORTED_SOURCE,
} = require("../../src/services/materialPlanningService");
const { computeNetToBuy } = require("../../src/services/procurementPlanningService");
const { assembleRmPoProcurementTrace } = require("../../src/services/procurementTraceService");
const { NO_QTY_PROCUREMENT_DEMAND_CODE } = require("../../src/services/procurementPipelineFirewall");
const { bulkAddProductionShortageMrLines } = require("../../src/services/productionShortageMrService");

describe("regularSoProcurementSource", () => {
  it("defines SALES_ORDER as REGULAR procurement anchor", () => {
    assert.equal(REGULAR_SO_PROCUREMENT_SOURCE, "SALES_ORDER");
    assert.ok(regularSoProcurementSourceTypes().includes("SALES_ORDER"));
    assert.ok(regularSoProcurementSourceTypes().includes("WORK_ORDER_PLANNING"));
    assert.equal(isRegularSoProcurementSource("SALES_ORDER"), true);
    assert.equal(isRegularSoProcurementSource("MONTHLY_PLAN"), false);
  });
});

describe("REGULAR SO procurement queries", () => {
  it("findPendingWoPlanningMaterialRequirements queries SO-anchored source types", async () => {
    let capturedWhere = null;
    const db = {
      materialRequirement: {
        findMany: async ({ where }) => {
          capturedWhere = where;
          return [{ id: 1, docNo: "MR-1", workOrderId: null, createdAt: new Date() }];
        },
      },
    };
    const rows = await findPendingWoPlanningMaterialRequirements(55, {}, db);
    assert.equal(rows.length, 1);
    assert.deepEqual(capturedWhere.sourceType, { in: regularSoProcurementSourceTypes() });
    assert.equal(capturedWhere.salesOrderId, 55);
    assert.equal(EXPORTED_SOURCE, "SALES_ORDER");
  });
});

describe("procurement trace — PO → MR → SO", () => {
  it("surfaces sales order in trace chain for SALES_ORDER MR", () => {
    const poRow = {
      id: 101,
      status: "PENDING",
      supplierId: 1,
      supplierLocationId: null,
      remarks: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      supplier: null,
      supplierLocation: null,
      grns: [],
      lines: [
        {
          id: 10,
          qty: 100,
          rate: 10,
          item: { id: 1, itemName: "RM", unit: "KG", itemType: "RM", hsnCode: "7208" },
          procurementLinks: [
            {
              id: 1,
              allocatedQty: 100,
              purchaseRequestLine: null,
              materialRequirementLine: {
                id: 201,
                materialRequirement: {
                  id: 2,
                  docNo: "MR-26-0099",
                  sourceType: "SALES_ORDER",
                  sourceRevision: null,
                  quotation: null,
                  salesOrder: { id: 8, docNo: "SO-26-0008" },
                  workOrder: { id: 7, docNo: "WO-7" },
                  monthlyProductionPlan: null,
                },
              },
            },
          ],
        },
      ],
    };

    const trace = assembleRmPoProcurementTrace(poRow, [], []);
    const chain = trace.lines[0].traceChain;
    assert.ok(chain.includes("SO-26-0008"));
    assert.ok(chain.includes("MR-26-0099"));
    assert.equal(trace.lines[0].demandSources[0].salesOrder.docNo, "SO-26-0008");
  });
});

describe("P0 guardrails preserved under P1", () => {
  it("open PO remains informational in procurement pool net-to-buy", () => {
    assert.equal(computeNetToBuy(6000, 2000), 6000);
  });

  it("NO_QTY WO shortage MR remains blocked", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 5,
          salesOrderId: 99,
          salesOrder: { id: 99, orderType: "NO_QTY" },
        }),
      },
    };
    await assert.rejects(
      () =>
        bulkAddProductionShortageMrLines(
          {
            workOrderId: 5,
            deps: {
              aggregateRmDemandForFgLines: async () => ({ rmNeeded: new Map([[10, 1]]), missingChildBoms: [] }),
              getMaterialAvailabilityByItems: async () => [
                {
                  itemId: 10,
                  requiredQty: 10,
                  freeStockQty: 0,
                  shortageAfterReservationQty: 10,
                  netShortageAfterIncomingQty: 10,
                },
              ],
            },
          },
          { userId: 1 },
          db,
        ),
      (e) => e && e.code === NO_QTY_PROCUREMENT_DEMAND_CODE,
    );
  });
});
