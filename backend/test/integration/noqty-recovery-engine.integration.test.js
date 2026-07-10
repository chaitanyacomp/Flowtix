/**
 * Batch 3B — Recovery Engine integration-style tests (in-memory transactional flow).
 * Covers production-short + final-QC scrap → allocate → reverse without live MySQL.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createProductionShortRecovery,
  appendTerminalQcScrapRecovery,
  allocateRecovery,
  reverseRecovery,
  getAvailableRecovery,
  getRecoverySummary,
  recomputeRecoveryStatus,
} = require("../../src/services/noQtyRecoveryService");
const { createCarryForwardPendingFromProductionShortfall } = require("../../src/services/carryForwardPendingService");

function makeIntegrationDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  const sources = [];
  const allocations = [];
  const sheets = [{ id: 10, status: "DRAFT", salesOrderId: 42 }];
  const lines = [{ id: 100, sheetId: 10, itemId: 501 }];

  return {
    salesOrder: {
      findUnique: async ({ where }) =>
        where.id === 42 ? { id: 42, orderType: "NO_QTY" } : { id: where.id, orderType: "REGULAR" },
    },
    requirementSheet: {
      findUnique: async ({ where }) => sheets.find((s) => s.id === where.id) ?? null,
    },
    requirementSheetLine: {
      findUnique: async ({ where }) => {
        if (where.id != null) return lines.find((l) => l.id === where.id) ?? null;
        if (where.sheetId_itemId) {
          return (
            lines.find(
              (l) => l.sheetId === where.sheetId_itemId.sheetId && l.itemId === where.sheetId_itemId.itemId,
            ) ?? null
          );
        }
        return null;
      },
    },
    carryForwardPending: {
      findFirst: async ({ where }) =>
        sources.find(
          (s) =>
            s.recoveryType === where.recoveryType &&
            s.sourceDocumentType === where.sourceDocumentType &&
            Number(s.sourceDocumentId) === Number(where.sourceDocumentId),
        ) ?? null,
      findUnique: async ({ where, include }) => {
        const row = sources.find((s) => s.id === where.id);
        if (!row) return null;
        return {
          ...row,
          allocations: include?.allocations
            ? allocations.filter((a) => a.recoverySourceId === row.id)
            : undefined,
        };
      },
      findMany: async ({ where, include }) =>
        sources
          .filter((s) => {
            if (where.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
            if (where.recoveryStatus?.notIn?.includes(s.recoveryStatus)) return false;
            return true;
          })
          .map((r) => ({
            ...r,
            allocations: include?.allocations
              ? allocations.filter((a) => a.recoverySourceId === r.id)
              : undefined,
            item: include?.item ? { id: r.itemId, itemName: "FG", unit: "Kg" } : undefined,
          })),
      create: async ({ data }) => {
        const dup = sources.find(
          (s) =>
            s.recoveryType === data.recoveryType &&
            s.sourceDocumentType === data.sourceDocumentType &&
            Number(s.sourceDocumentId) === Number(data.sourceDocumentId),
        );
        if (dup) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextCfId++, waivedQty: "0", ...data };
        sources.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = sources.find((s) => s.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    recoveryAllocation: {
      findMany: async ({ where }) =>
        allocations.filter((a) => a.recoverySourceId === where.recoverySourceId),
      findFirst: async ({ where }) =>
        allocations.find(
          (a) =>
            a.recoverySourceId === where.recoverySourceId &&
            a.requirementSheetLineId === where.requirementSheetLineId &&
            (!where.status?.in || where.status.in.includes(a.status)),
        ) ?? null,
      findUnique: async ({ where, include }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        return {
          ...row,
          requirementSheet: include?.requirementSheet
            ? sheets.find((s) => s.id === row.requirementSheetId)
            : undefined,
        };
      },
      create: async ({ data }) => {
        const row = { id: nextAllocId++, ...data };
        allocations.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = allocations.find((a) => a.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
    _sources: sources,
  };
}

describe("Batch 3B recovery engine integration flow", () => {
  it("production finish facade + final QC scrap → allocate partial → reverse", async () => {
    const db = makeIntegrationDb();

    const short = await createCarryForwardPendingFromProductionShortfall(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 2 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 100,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 9001,
      actorUserId: 1,
    });
    assert.equal(short.recoveryType, "PRODUCTION_SHORTFALL");

    const qc = await appendTerminalQcScrapRecovery(db, {
      disposition: {
        id: 44,
        itemId: 501,
        workOrderId: 7,
        workOrder: { id: 7, salesOrderId: 42, cycleId: 2 },
      },
      scrapQty: 15,
      actorUserId: 1,
    });
    assert.equal(qc.recoveryType, "QC_FINAL_REJECTION");
    assert.equal(Number(qc.sourceQty), 15);

    // First-pass scrap must NOT be created by callers — engine still allows explicit create,
    // but integration contract is: only appendTerminalQcScrapRecovery from disposition terminals.
    assert.equal(db._sources.filter((s) => s.recoveryType === "QC_FINAL_REJECTION").length, 1);

    const { allocation, availableQty } = await allocateRecovery(db, {
      recoverySourceId: short.id,
      requirementSheetId: 10,
      qty: 40,
    });
    assert.equal(availableQty, 60);

    const available = await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 });
    assert.equal(available.reduce((s, r) => s + r.availableQty, 0), 75);

    await reverseRecovery(db, { allocationId: allocation.id, reason: "draft edit" });
    const after = await recomputeRecoveryStatus(db, short.id);
    assert.equal(after.recoveryStatus, "OPEN");
    assert.equal(Number(after.remainingQty), 100);

    const summary = await getRecoverySummary(db, 42);
    assert.equal(summary.totals.productionShortfallAvailableQty, 100);
    assert.equal(summary.totals.qcFinalRejectionAvailableQty, 15);
    assert.equal(summary.totals.activeAllocatedQty, 0);
  });

  it("duplicate production short recovery via facade is a no-op", async () => {
    const db = makeIntegrationDb();
    const args = {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 2 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 50,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 42,
    };
    const a = await createProductionShortRecovery(db, args);
    const b = await createCarryForwardPendingFromProductionShortfall(db, args);
    assert.equal(a.id, b.id);
    assert.equal(db._sources.length, 1);
  });
});
