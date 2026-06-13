const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MONTHLY_PLAN_SOURCE,
  MPRS_RESET_DOC_TYPES,
  MPRS_RESET_CONFIRM_TEXT,
  buildMprsCountSummary,
  collectMonthlyPlanProcurementScope,
  getMprsResetMetricCounts,
} = require("../../src/services/mprsTestResetService");

describe("mprsTestResetService", () => {
  it("exports confirm text and doc types for MPRS reset", () => {
    assert.equal(MPRS_RESET_CONFIRM_TEXT, "RESET MPRS");
    assert.ok(MPRS_RESET_DOC_TYPES.includes("MONTHLY_PRODUCTION_PLAN"));
    assert.ok(MPRS_RESET_DOC_TYPES.includes("REQUIREMENT_SHEET"));
    assert.ok(MPRS_RESET_DOC_TYPES.includes("MATERIAL_REQUIREMENT"));
    assert.ok(MPRS_RESET_DOC_TYPES.includes("PURCHASE_REQUEST"));
  });

  it("buildMprsCountSummary formats before/after rows", () => {
    const rows = buildMprsCountSummary(
      { requirementSheets: 12, monthlyPlans: 8, rmSnapshots: 8 },
      { requirementSheets: 0, monthlyPlans: 0, rmSnapshots: 0 },
    );
    const rs = rows.find((r) => r.key === "requirementSheets");
    assert.equal(rs?.before, 12);
    assert.equal(rs?.after, 0);
    assert.equal(rs?.label, "Requirement Sheets");
  });

  it("collectMonthlyPlanProcurementScope returns empty scope when no monthly MRs", async () => {
    const tx = {
      materialRequirement: {
        findMany: async () => [],
      },
    };
    const scope = await collectMonthlyPlanProcurementScope(tx);
    assert.deepEqual(scope.mrIds, []);
    assert.deepEqual(scope.grnIds, []);
  });

  it("collectMonthlyPlanProcurementScope walks MR → PR → PO → GRN chain", async () => {
    const tx = {
      materialRequirement: {
        findMany: async ({ where }) => {
          assert.equal(where.sourceType, MONTHLY_PLAN_SOURCE);
          return [{ id: 10 }];
        },
      },
      materialRequirementLine: {
        findMany: async () => [{ id: 100 }],
      },
      purchaseRequestLineSourceLink: {
        findMany: async () => [{ purchaseRequestLineId: 200 }],
      },
      purchaseRequestLine: {
        findMany: async () => [{ purchaseRequestId: 300 }],
      },
      rmPoLineProcurementLink: {
        findMany: async () => [{ rmPoLineId: 400 }],
      },
      rmPurchaseOrderLine: {
        findMany: async () => [{ rmPoId: 500 }],
      },
      grn: {
        findMany: async () => [{ id: 600 }],
      },
    };
    const scope = await collectMonthlyPlanProcurementScope(tx);
    assert.deepEqual(scope.mrIds, [10]);
    assert.deepEqual(scope.mrLineIds, [100]);
    assert.deepEqual(scope.prLineIds, [200]);
    assert.deepEqual(scope.prIds, [300]);
    assert.deepEqual(scope.rmPoLineIds, [400]);
    assert.deepEqual(scope.rmPoIds, [500]);
    assert.deepEqual(scope.grnIds, [600]);
  });

  it("getMprsResetMetricCounts queries monthly-plan scoped procurement", async () => {
    const calls = [];
    const tx = {
      requirementSheet: { count: async () => 3 },
      monthlyProductionPlan: { count: async () => 2 },
      rmPlan: { count: async () => 2 },
      materialRequirement: {
        count: async (args) => {
          calls.push(args);
          return 1;
        },
      },
      purchaseRequest: { count: async () => 1 },
      rmPurchaseOrder: { count: async () => 1 },
      grn: { count: async () => 1 },
    };
    const counts = await getMprsResetMetricCounts(tx);
    assert.equal(counts.requirementSheets, 3);
    assert.equal(counts.monthlyPlans, 2);
    assert.equal(counts.materialRequirementsMonthlyPlan, 1);
    assert.equal(calls[0]?.where?.sourceType, MONTHLY_PLAN_SOURCE);
  });
});
