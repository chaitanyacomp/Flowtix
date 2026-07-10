/**
 * Batch 3A — migration mapping + SQL presence tests (no live DB required).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  mapLegacyCfStatusToRecoveryStatus,
  mapLegacySoStatus,
  mapCfProvenance,
  mapRsLineComponents,
  shouldReconstructCommittedAllocation,
  markDuplicateProvenanceIncomplete,
} = require("../../src/services/noQtyRecoveryMigrationMap");

const MIGRATION_SQL = path.join(
  __dirname,
  "../../prisma/migrations/20260710120000_no_qty_recovery_foundation/migration.sql",
);

describe("Batch 3A NO_QTY recovery migration map", () => {
  it("maps CF PENDING → OPEN and CONSUMED → FULLY_ALLOCATED", () => {
    assert.equal(mapLegacyCfStatusToRecoveryStatus("PENDING"), "OPEN");
    assert.equal(mapLegacyCfStatusToRecoveryStatus("CONSUMED"), "FULLY_ALLOCATED");
  });

  it("maps MANUALLY_CLOSED → CLOSED_WITH_WAIVER and leaves others", () => {
    assert.equal(mapLegacySoStatus("MANUALLY_CLOSED"), "CLOSED_WITH_WAIVER");
    assert.equal(mapLegacySoStatus("COMPLETED"), "COMPLETED");
    assert.equal(mapLegacySoStatus("IN_PROCESS"), "IN_PROCESS");
  });

  it("prefers ProductionShortfallResolution provenance over WO", () => {
    assert.deepEqual(
      mapCfProvenance({ productionShortfallResolutionId: 9, sourceWorkOrderId: 3 }),
      { sourceDocumentType: "PRODUCTION_SHORTFALL_RESOLUTION", sourceDocumentId: 9 },
    );
    assert.deepEqual(mapCfProvenance({ sourceWorkOrderId: 3 }), {
      sourceDocumentType: "WORK_ORDER",
      sourceDocumentId: 3,
    });
    assert.deepEqual(mapCfProvenance({}), { sourceDocumentType: null, sourceDocumentId: null });
  });

  it("maps RS line components from legacy snapshots without data loss", () => {
    const mapped = mapRsLineComponents({
      requirementQty: 100,
      shortfallQtySnapshot: 25,
      suggestedWoQtySnapshot: 125,
    });
    assert.deepEqual(mapped, {
      baseDemandQty: 100,
      productionShortfallQty: 25,
      qcRejectionRecoveryQty: 0,
      approvedManualAdjustmentQty: 0,
      totalRsQty: 125,
    });
    const noSuggested = mapRsLineComponents({
      requirementQty: 50,
      shortfallQtySnapshot: 10,
      suggestedWoQtySnapshot: null,
    });
    assert.equal(noSuggested.totalRsQty, 60);
  });

  it("reconstructs COMMITTED allocation only for CONSUMED + target RS", () => {
    assert.equal(
      shouldReconstructCommittedAllocation({
        status: "CONSUMED",
        targetRequirementSheetId: 1,
        sourceQty: 10,
      }),
      true,
    );
    assert.equal(
      shouldReconstructCommittedAllocation({ status: "PENDING", targetRequirementSheetId: 1, sourceQty: 10 }),
      false,
    );
    assert.equal(
      shouldReconstructCommittedAllocation({ status: "CONSUMED", targetRequirementSheetId: null, sourceQty: 10 }),
      false,
    );
  });

  it("dedupes provenance keys without dropping rows", () => {
    const rows = markDuplicateProvenanceIncomplete([
      {
        id: 1,
        recoveryType: "PRODUCTION_SHORTFALL",
        sourceDocumentType: "WORK_ORDER",
        sourceDocumentId: 5,
      },
      {
        id: 2,
        recoveryType: "PRODUCTION_SHORTFALL",
        sourceDocumentType: "WORK_ORDER",
        sourceDocumentId: 5,
      },
    ]);
    assert.equal(rows[0].sourceDocumentId, 5);
    assert.equal(rows[0].migrationIncomplete, false);
    assert.equal(rows[1].sourceDocumentId, null);
    assert.equal(rows[1].migrationIncomplete, true);
  });
});

describe("Batch 3A migration SQL artifact", () => {
  it("exists and contains required DDL / backfill steps", () => {
    assert.ok(fs.existsSync(MIGRATION_SQL), "migration.sql missing");
    const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
    for (const needle of [
      "CLOSED_WITH_WAIVER",
      "UPDATE `SalesOrder`",
      "MANUALLY_CLOSED",
      "baseDemandQty",
      "productionShortfallQty",
      "qcRejectionRecoveryQty",
      "totalRsQty",
      "recoveryStatus",
      "sourceQty",
      "CarryForwardPending_recovery_source_key",
      "CREATE TABLE `RecoveryAllocation`",
      "CREATE TABLE `NoQtySoWaiver`",
      "CREATE TABLE `NoQtySoWaiverLine`",
      "CREATE TABLE `NoQtyAcceptedFgDisposition`",
      "INSERT INTO `RecoveryAllocation`",
      "migrationIncomplete",
    ]) {
      assert.ok(sql.includes(needle), `migration missing: ${needle}`);
    }
  });

  it("keeps MANUALLY_CLOSED in enum for dual-read / rollback window", () => {
    const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
    assert.match(sql, /'MANUALLY_CLOSED',\s*'CLOSED_WITH_WAIVER'/s);
  });

  it("does not drop legacy CarryForwardPending.status or remainingQty", () => {
    const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
    assert.doesNotMatch(sql, /DROP COLUMN `status`/);
    assert.doesNotMatch(sql, /DROP COLUMN `remainingQty`/);
  });
});
