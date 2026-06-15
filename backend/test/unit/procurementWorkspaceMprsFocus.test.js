const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadOpenMaterialRequirements } = require("../../src/services/procurementWorkspaceService");

const monthlyPlanMr = {
  id: 101,
  docNo: "MR-26-0001",
  status: "APPROVED",
  sourceType: "MONTHLY_PLAN",
  salesOrderId: null,
  workOrderId: null,
  monthlyProductionPlanId: 5,
  lines: [
    {
      id: 1001,
      rmItemId: 10,
      requiredQty: "100",
      shortageQty: "100",
      procuredQty: "0",
      rmItem: { id: 10, itemName: "Powder", unit: "KG" },
    },
  ],
};

describe("procurementWorkspace MPRS MR visibility", () => {
  it("loadOpenMaterialRequirements omits salesOrderId filter when salesOrderId is null (MPRS path)", async () => {
    let capturedWhere = null;
    const db = {
      materialRequirement: {
        findMany: async ({ where }) => {
          capturedWhere = where;
          return [monthlyPlanMr];
        },
        findFirst: async () => null,
      },
    };

    const rows = await loadOpenMaterialRequirements(db, {
      salesOrderId: null,
      sourceTypes: ["MONTHLY_PLAN"],
    });

    assert.equal(capturedWhere.salesOrderId, undefined);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 101);
  });

  it("loadOpenMaterialRequirements applies salesOrderId filter for Regular SO loads", async () => {
    let capturedWhere = null;
    const db = {
      materialRequirement: {
        findMany: async ({ where }) => {
          capturedWhere = where;
          return [];
        },
        findFirst: async () => null,
      },
    };

    await loadOpenMaterialRequirements(db, {
      salesOrderId: 42,
      sourceTypes: ["SALES_ORDER"],
    });

    assert.equal(capturedWhere.salesOrderId, 42);
    assert.deepEqual(capturedWhere.sourceType, { in: ["SALES_ORDER"] });
  });

  it("ensureMaterialRequirementId includes plan-scoped MR when not returned by findMany", async () => {
    const db = {
      materialRequirement: {
        findMany: async () => [],
        findFirst: async ({ where }) => {
          assert.equal(where.id, 101);
          assert.deepEqual(where.sourceType, { in: ["MONTHLY_PLAN"] });
          return monthlyPlanMr;
        },
      },
    };

    const rows = await loadOpenMaterialRequirements(db, {
      salesOrderId: null,
      sourceTypes: ["MONTHLY_PLAN"],
      ensureMaterialRequirementId: 101,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].docNo, "MR-26-0001");
  });
});
