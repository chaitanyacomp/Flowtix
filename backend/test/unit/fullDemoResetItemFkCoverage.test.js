/**
 * Full Demo Reset / cleanup coverage regression tests.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  assertCleanupRegistryValid,
  assertFullDemoResetCoverageValid,
  validateFullDemoResetCoverage,
  getFullDemoDeletedPrismaModelSet,
} = require("../../src/services/cleanup/cleanupDependencyValidator");
const {
  findRegistryEntryByPrismaModel,
  FULL_DEMO_PRESERVED_MODELS,
} = require("../../src/services/cleanup/cleanupRegistry");
const {
  buildMonthlyPlanningCleanupSteps,
  buildProductionRmFlowCleanupSteps,
  buildProductionReportCleanupSteps,
  buildResetTransactionDataCleanupSteps,
} = require("../../src/routes/adminDatabaseCleanup");

describe("Full Demo Reset Item FK coverage", () => {
  it("1. RmPlanLine is registered and deleted before Item (rmItemId)", () => {
    const entry = findRegistryEntryByPrismaModel("RmPlanLine");
    assert.ok(entry, "RmPlanLine must be in CLEANUP_REGISTRY");
    const monthly = buildMonthlyPlanningCleanupSteps({}).map((s) => s.table);
    assert.ok(monthly.indexOf("rmPlanLine") < monthly.indexOf("rmPlan"));
    assert.ok(getFullDemoDeletedPrismaModelSet().has("RmPlanLine"));
    assert.ok(getFullDemoDeletedPrismaModelSet().has("Item"));
  });

  it("2–3. Full Demo source deletes monthly planning + allowance before item", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/routes/adminDatabaseCleanup.js"), "utf8");
    const start = src.indexOf("async function runFullDemoResetDeletes");
    const end = src.indexOf("async function runResetTransactionDataInTransaction");
    const body = src.slice(start, end);
    const itemIdx = body.indexOf('["item"');
    assert.ok(itemIdx > 0);
    assert.ok(body.indexOf("monthlyPlanning") > 0 && body.indexOf("monthlyPlanning") < itemIdx);
    assert.ok(body.indexOf("rmAllowanceApprovalRequest") > 0 && body.indexOf("rmAllowanceApprovalRequest") < itemIdx);
    assert.ok(body.includes("buildMonthlyPlanningCleanupSteps"));
  });

  it("5–7. Full Demo preserves User, AppSetting, State (documented)", () => {
    for (const m of ["User", "AppSetting", "State", "Location", "WastageType"]) {
      assert.ok(FULL_DEMO_PRESERVED_MODELS.includes(m), `expected preserved ${m}`);
      assert.equal(getFullDemoDeletedPrismaModelSet().has(m), false, `${m} must not be wiped`);
    }
  });

  it("8. Transaction Reset preserves Items/customers/suppliers (no master wipe steps)", () => {
    const names = buildResetTransactionDataCleanupSteps({}).map((s) => s.table);
    assert.ok(!names.includes("item"));
    assert.ok(!names.includes("customer"));
    assert.ok(!names.includes("supplier"));
    assert.ok(names.includes("rmPlanLine"));
    assert.ok(names.includes("salesBillDispatchAllocation"));
  });

  it("10. Full Demo coverage fails when an Item child is unclassified", () => {
    assert.doesNotThrow(() => assertFullDemoResetCoverageValid());
    const incomplete = new Set(getFullDemoDeletedPrismaModelSet());
    incomplete.delete("RmPlanLine");
    const gap = validateFullDemoResetCoverage({ deletedModels: incomplete });
    assert.equal(gap.ok, false);
    assert.ok(gap.missingModels.some((i) => i.details?.child === "RmPlanLine"));
    assert.ok(gap.missingModels.some((i) => String(i.details?.fromFields || i.details?.field || "").includes("rmItemId") || i.details?.field));
  });

  it("9. NO_QTY reset scopes to orderType NO_QTY only (Regular SO preserved)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/routes/adminDatabaseCleanup.js"), "utf8");
    const start = src.indexOf("async function runResetNoQtyTransactionalDeletes");
    const end = src.indexOf("async function runFullDemoResetDeletes");
    const body = src.slice(start, end > start ? end : undefined);
    assert.ok(body.includes('orderType: "NO_QTY"'));
    assert.ok(!/salesOrder\.deleteMany\(\s*\{\s*\}\s*\)/.test(body), "NO_QTY must not wipe all sales orders");
  });

  it("11. No reset implementation disables foreign-key checks", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/routes/adminDatabaseCleanup.js"), "utf8");
    assert.equal(/FOREIGN_KEY_CHECKS/i.test(src), false);
    assert.equal(/\bTRUNCATE\b/i.test(src), false);
  });

  it("transaction reset includes RmAllowance before PMR lines", () => {
    const names = buildProductionRmFlowCleanupSteps({}).map((s) => s.table);
    const allowIdx = names.indexOf("rmAllowanceApprovalRequest");
    const pmrLineIdx = names.indexOf("productionMaterialRequestLine");
    assert.ok(allowIdx >= 0 && allowIdx < pmrLineIdx);
  });

  it("transaction reset includes wastage detail before report", () => {
    const names = buildProductionReportCleanupSteps({}).map((s) => s.table);
    assert.ok(names.indexOf("productionWorkOrderReportWastageDetail") < names.indexOf("productionWorkOrderReport"));
  });

  it("registry + full-demo schema coverage both pass", () => {
    assert.doesNotThrow(() => assertCleanupRegistryValid());
    assert.doesNotThrow(() => assertFullDemoResetCoverageValid());
  });
});
