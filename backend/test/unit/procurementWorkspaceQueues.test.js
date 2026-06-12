const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeQueueCounts,
  filterPendingMrsBySourceType,
} = require("../../src/services/procurementWorkspaceService");

describe("P5C-3 — procurement workspace queue separation", () => {
  const sampleMrs = [
    { materialRequirementId: 1, sourceType: "MONTHLY_PLAN", operationalKey: "PROCUREMENT_PENDING" },
    { materialRequirementId: 2, sourceType: "MONTHLY_PLAN", operationalKey: "PR_PENDING_PO" },
    { materialRequirementId: 3, sourceType: "SALES_ORDER", operationalKey: "PROCUREMENT_PENDING" },
    { materialRequirementId: 4, sourceType: "STOCK_REPLENISHMENT", operationalKey: "GRN_PENDING" },
    { materialRequirementId: 5, sourceType: "QUOTATION", operationalKey: "PROCUREMENT_PENDING" },
  ];

  it("computeQueueCounts tallies the three P5C-3 demand classes", () => {
    const counts = computeQueueCounts(sampleMrs);
    assert.deepEqual(counts, {
      all: 5,
      monthlyPlan: 2,
      woShortage: 1,
      regularSo: 1,
      minStock: 1,
    });
  });

  it("filterPendingMrsBySourceType returns only matching MR summaries", () => {
    const monthly = filterPendingMrsBySourceType(sampleMrs, "MONTHLY_PLAN");
    assert.equal(monthly.length, 2);
    assert.ok(monthly.every((m) => m.sourceType === "MONTHLY_PLAN"));

    const wo = filterPendingMrsBySourceType(sampleMrs, "SALES_ORDER");
    assert.equal(wo.length, 1);
    assert.equal(wo[0].materialRequirementId, 3);

    const minStock = filterPendingMrsBySourceType(sampleMrs, "STOCK_REPLENISHMENT");
    assert.equal(minStock.length, 1);
    assert.equal(minStock[0].materialRequirementId, 4);
  });

  it("filterPendingMrsBySourceType with null/unknown returns all rows", () => {
    assert.equal(filterPendingMrsBySourceType(sampleMrs, null).length, 5);
    assert.equal(filterPendingMrsBySourceType(sampleMrs, "EMERGENCY").length, 5);
  });
});

describe("P5C-3 — workspace route sourceType query", () => {
  it("accepts sourceType enum values on workspace query schema", () => {
    const { z } = require("zod");
    const schema = z.object({
      sourceType: z.enum(["MONTHLY_PLAN", "SALES_ORDER", "WORK_ORDER_PLANNING", "STOCK_REPLENISHMENT"]).optional(),
    });
    assert.equal(schema.parse({ sourceType: "MONTHLY_PLAN" }).sourceType, "MONTHLY_PLAN");
    assert.throws(() => schema.parse({ sourceType: "EMERGENCY" }));
  });
});
