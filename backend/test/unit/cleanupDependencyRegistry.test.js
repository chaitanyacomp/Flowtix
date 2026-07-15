/**
 * Cleanup registry ↔ schema dependency tests (migration-aware).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertCleanupRegistryValid,
  validateCleanupRegistryAgainstSchema,
  describeCarryForwardPendingDependencyGraph,
} = require("../../src/services/cleanup/cleanupDependencyValidator");
const {
  getRecoveryClusterClientKeys,
  findRegistryEntryByPrismaModel,
} = require("../../src/services/cleanup/cleanupRegistry");
const { NO_QTY_RECOVERY_CLEANUP_TABLES } = require("../../src/services/noQtyRecoveryCleanupService");
const { RESET_TRANSACTION_VERIFY_TABLES, buildProductionExecutionCleanupSteps } = require("../../src/routes/adminDatabaseCleanup");

describe("cleanup dependency registry", () => {
  it("passes schema validation (fails CI when new Restrict FK/model is unregistered)", () => {
    assert.doesNotThrow(() => assertCleanupRegistryValid());
    const result = validateCleanupRegistryAgainstSchema();
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
  });

  it("registers every CarryForwardPending Restrict child before CFP", () => {
    const cfp = findRegistryEntryByPrismaModel("CarryForwardPending");
    assert.ok(cfp);
    const children = describeCarryForwardPendingDependencyGraph();
    assert.ok(children.length >= 3);
    for (const row of children) {
      assert.equal(row.registered, true, `missing registry entry for ${row.child}`);
      assert.ok(
        row.registryPhase < cfp.phase,
        `${row.child} phase ${row.registryPhase} must be < CarryForwardPending ${cfp.phase}`,
      );
    }
  });

  it("recovery cleanup service order matches registry cluster", () => {
    assert.deepEqual([...NO_QTY_RECOVERY_CLEANUP_TABLES], getRecoveryClusterClientKeys());
    const expected = [
      "noQtyRsItemRecoveryDecisionLine",
      "noQtyRsItemRecoveryDecision",
      "recoveryAllocation",
      "noQtySoWaiverLine",
      "noQtySoWaiver",
      "noQtyAcceptedFgDisposition",
      "carryForwardPending",
      "productionShortfallResolution",
    ];
    assert.deepEqual([...NO_QTY_RECOVERY_CLEANUP_TABLES], expected);
  });

  it("production execution steps delete decision lines before CarryForwardPending", () => {
    const names = buildProductionExecutionCleanupSteps({}).map((s) => s.table);
    const lineIdx = names.indexOf("noQtyRsItemRecoveryDecisionLine");
    const decisionIdx = names.indexOf("noQtyRsItemRecoveryDecision");
    const allocIdx = names.indexOf("recoveryAllocation");
    const cfIdx = names.indexOf("carryForwardPending");
    assert.ok(lineIdx >= 0 && lineIdx < cfIdx);
    assert.ok(decisionIdx >= 0 && decisionIdx < cfIdx);
    assert.ok(allocIdx >= 0 && allocIdx < cfIdx);
  });

  it("verify tables include Phase 2B recovery decision models", () => {
    for (const table of [
      "noQtyRsItemRecoveryDecisionLine",
      "noQtyRsItemRecoveryDecision",
      "noQtyAcceptedFgDisposition",
      "recoveryAllocation",
      "carryForwardPending",
    ]) {
      assert.ok(RESET_TRANSACTION_VERIFY_TABLES.includes(table), `missing ${table}`);
    }
  });
});
