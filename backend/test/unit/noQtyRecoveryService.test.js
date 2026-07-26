/**
 * Batch 3B — Recovery Engine unit tests (no live DB).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAvailableQty,
  deriveRecoveryStatus,
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  appendTerminalQcScrapRecovery,
  getAvailableRecovery,
  allocateRecovery,
  reverseRecovery,
  recomputeRecoveryStatus,
  getRecoverySummary,
} = require("../../src/services/noQtyRecoveryService");

function makeDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  /** @type {any[]} */
  const sources = [];
  /** @type {any[]} */
  const allocations = [];
  /** @type {any[]} */
  const sheets = [
    { id: 10, status: "DRAFT", salesOrderId: 42 },
    { id: 11, status: "LOCKED", salesOrderId: 42 },
  ];
  /** @type {any[]} */
  const lines = [
    { id: 100, sheetId: 10, itemId: 501 },
    { id: 101, sheetId: 11, itemId: 501 },
  ];
  const salesOrders = {
    42: { id: 42, orderType: "NO_QTY" },
    99: { id: 99, orderType: "REGULAR" },
  };

  const db = {
    salesOrder: {
      findUnique: async ({ where }) => salesOrders[where.id] ?? null,
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
      findFirst: async ({ where }) => {
        return (
          sources.find(
            (s) =>
              s.recoveryType === where.recoveryType &&
              s.sourceDocumentType === where.sourceDocumentType &&
              Number(s.sourceDocumentId) === Number(where.sourceDocumentId),
          ) ?? null
        );
      },
      findUnique: async ({ where, include }) => {
        const row = sources.find((s) => s.id === where.id);
        if (!row) return null;
        if (include?.allocations) {
          return {
            ...row,
            allocations: allocations.filter((a) => a.recoverySourceId === row.id),
          };
        }
        return { ...row };
      },
      findMany: async ({ where, include }) => {
        let rows = sources.filter((s) => {
          if (where.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
          if (where.itemId != null && s.itemId !== where.itemId) return false;
          if (where.recoveryType != null && s.recoveryType !== where.recoveryType) return false;
          if (where.recoveryStatus?.notIn && where.recoveryStatus.notIn.includes(s.recoveryStatus)) {
            return false;
          }
          return true;
        });
        return rows.map((r) => ({
          ...r,
          allocations: include?.allocations
            ? allocations.filter((a) => a.recoverySourceId === r.id)
            : undefined,
          item: include?.item ? { id: r.itemId, itemName: `Item-${r.itemId}`, unit: "Kg" } : undefined,
        }));
      },
      create: async ({ data }) => {
        const row = {
          id: nextCfId++,
          waivedQty: "0",
          remainingQty: data.remainingQty ?? data.sourceQty,
          recoveryStatus: data.recoveryStatus ?? "OPEN",
          status: data.status ?? "PENDING",
          migrationIncomplete: false,
          ...data,
        };
        // Unique provenance
        const dup = sources.find(
          (s) =>
            s.recoveryType === row.recoveryType &&
            s.sourceDocumentType === row.sourceDocumentType &&
            Number(s.sourceDocumentId) === Number(row.sourceDocumentId),
        );
        if (dup) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        sources.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = sources.find((s) => s.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    recoveryAllocation: {
      findMany: async ({ where }) =>
        allocations.filter((a) => {
          if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          return true;
        }),
      findFirst: async ({ where }) => {
        return (
          allocations.find((a) => {
            if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
            if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) {
              return false;
            }
            if (where.status?.in && !where.status.in.includes(a.status)) return false;
            return true;
          }) ?? null
        );
      },
      findUnique: async ({ where, include }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        const sheet = sheets.find((s) => s.id === row.requirementSheetId);
        return {
          ...row,
          requirementSheet: include?.requirementSheet ? sheet : undefined,
        };
      },
      create: async ({ data }) => {
        const row = { id: nextAllocId++, ...data };
        allocations.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    _sources: sources,
    _allocations: allocations,
    _sheets: sheets,
  };

  return db;
}

describe("noQtyRecoveryService — available qty & status", () => {
  it("computes available = source − active alloc − waived", () => {
    const source = { sourceQty: "100", waivedQty: "10", remainingQty: "100" };
    assert.equal(
      computeAvailableQty(source, [
        { status: "RESERVED", allocatedQty: "20" },
        { status: "COMMITTED", allocatedQty: "15" },
        { status: "REVERSED", allocatedQty: "50" },
      ]),
      55,
    );
  });

  it("derives recovery statuses", () => {
    const base = { sourceQty: "100", waivedQty: "0", recoveryStatus: "OPEN" };
    assert.equal(deriveRecoveryStatus(base, []), "OPEN");
    assert.equal(
      deriveRecoveryStatus(base, [{ status: "RESERVED", allocatedQty: "40" }]),
      "PARTIALLY_ALLOCATED",
    );
    assert.equal(
      deriveRecoveryStatus(base, [{ status: "COMMITTED", allocatedQty: "100" }]),
      "FULLY_ALLOCATED",
    );
    assert.equal(
      deriveRecoveryStatus({ ...base, waivedQty: "100" }, []),
      "WAIVED",
    );
    assert.equal(
      deriveRecoveryStatus({ ...base, waivedQty: "20" }, [{ status: "RESERVED", allocatedQty: "10" }]),
      "PARTIALLY_WAIVED",
    );
    assert.equal(deriveRecoveryStatus({ ...base, recoveryStatus: "CANCELLED" }, []), "CANCELLED");
  });
});

describe("noQtyRecoveryService — create sources", () => {
  it("creates production shortfall recovery for NO_QTY", async () => {
    const db = makeDb();
    const row = await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 25,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 88,
      actorUserId: 1,
    });
    assert.ok(row);
    assert.equal(row.recoveryType, "PRODUCTION_SHORTFALL");
    assert.equal(Number(row.sourceQty), 25);
    assert.equal(row.sourceDocumentType, "PRODUCTION_SHORTFALL_RESOLUTION");
    assert.equal(row.sourceDocumentId, 88);
    assert.equal(row.recoveryStatus, "OPEN");
  });

  it("skips production recovery for REGULAR SO", async () => {
    const db = makeDb();
    const row = await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 99 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 25,
      productionShortfallResolutionId: 1,
    });
    assert.equal(row, null);
  });

  it("prevents duplicate production recovery (idempotent)", async () => {
    const db = makeDb();
    const args = {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 25,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 88,
    };
    const a = await createProductionShortRecovery(db, args);
    const b = await createProductionShortRecovery(db, args);
    assert.equal(a.id, b.id);
    assert.equal(db._sources.length, 1);
  });

  it("records exact WO planned − finalized production shortage on RS-1 (idempotent retries)", async () => {
    const db = makeDb();
    const planned = 2000;
    const finalized = 1972;
    const shortage = Math.max(0, planned - finalized);
    assert.equal(shortage, 28);
    const args = {
      workOrder: {
        id: 71,
        salesOrderId: 42,
        requirementSheetId: 1,
        cycleId: 3,
      },
      workOrderLine: { fgItemId: 501 },
      remainderQty: shortage,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 901,
      actorUserId: 1,
    };
    const first = await createProductionShortRecovery(db, args);
    const retry = await createProductionShortRecovery(db, args);
    assert.ok(first);
    assert.equal(first.id, retry.id);
    assert.equal(Number(first.sourceQty), 28);
    assert.equal(Number(first.remainingQty), 28);
    assert.equal(first.sourceRequirementSheetId, 1);
    assert.equal(first.salesOrderId, 42);
    assert.equal(first.itemId, 501);
    assert.equal(first.recoveryType, "PRODUCTION_SHORTFALL");
    assert.equal(first.recoveryStatus, "OPEN");
    assert.equal(db._sources.length, 1);
  });

  it("creates QC final rejection recovery (first-pass SCRAP uses same producer via append)", async () => {
    const db = makeDb();
    const row = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 12,
      workOrderId: 7,
      sourceDocumentId: 55,
      actorUserId: 2,
    });
    assert.equal(row.recoveryType, "QC_FINAL_REJECTION");
    assert.equal(row.sourceDocumentType, "QC_REJECTED_DISPOSITION");
    assert.equal(Number(row.sourceQty), 12);
  });

  it("appends terminal scrap deltas onto same disposition without duplicate rows", async () => {
    const db = makeDb();
    const disposition = {
      id: 55,
      itemId: 501,
      workOrderId: 7,
      workOrder: { id: 7, salesOrderId: 42, cycleId: 3 },
    };
    const a = await appendTerminalQcScrapRecovery(db, { disposition, scrapQty: 5 });
    const b = await appendTerminalQcScrapRecovery(db, { disposition, scrapQty: 3 });
    assert.equal(a.id, b.id);
    assert.equal(db._sources.length, 1);
    assert.equal(Number(b.sourceQty), 8);
  });

  it("does not create QC_FINAL_REJECTION for WO surplus scrap (plan already accepted)", async () => {
    const db = makeDb();
    db.workOrderLine = {
      findFirst: async () => ({
        qty: 2000,
        plannedQty: 2000,
        productions: [
          {
            producedQty: 2005,
            qcEntries: [{ acceptedQty: 2000, rejectedQty: 5 }],
          },
        ],
      }),
    };
    const row = await appendTerminalQcScrapRecovery(db, {
      disposition: {
        id: 90,
        itemId: 501,
        workOrderId: 7,
        workOrder: { id: 7, salesOrderId: 42, cycleId: 3 },
      },
      scrapQty: 5,
    });
    assert.equal(row, null);
    assert.equal(db._sources.length, 0);
  });

  it("duplicate QC create is idempotent under unique race", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 10,
      sourceDocumentId: 77,
    });
    const again = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 10,
      sourceDocumentId: 77,
    });
    assert.equal(db._sources.length, 1);
    assert.equal(Number(again.sourceQty), 10);
  });
});

describe("noQtyRecoveryService — allocate / reverse", () => {
  async function seedOpenSource(db, qty = 100) {
    return createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: qty,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 201,
    });
  }

  it("supports partial allocation and prevents over-allocation", async () => {
    const db = makeDb();
    const source = await seedOpenSource(db, 100);

    const first = await allocateRecovery(db, {
      recoverySourceId: source.id,
      requirementSheetId: 10,
      qty: 40,
      actorUserId: 1,
    });
    assert.equal(Number(first.allocation.allocatedQty), 40);
    assert.equal(first.availableQty, 60);
    assert.equal(first.recoverySource.recoveryStatus, "PARTIALLY_ALLOCATED");

    const second = await allocateRecovery(db, {
      recoverySourceId: source.id,
      requirementSheetId: 10,
      qty: 30,
    });
    assert.equal(Number(second.allocation.allocatedQty), 70);
    assert.equal(second.availableQty, 30);

    await assert.rejects(
      () =>
        allocateRecovery(db, {
          recoverySourceId: source.id,
          requirementSheetId: 10,
          qty: 31,
        }),
      (err) => err.code === "RECOVERY_OVER_ALLOC",
    );
  });

  it("reverses RESERVED allocation and restores availability", async () => {
    const db = makeDb();
    const source = await seedOpenSource(db, 50);
    const { allocation } = await allocateRecovery(db, {
      recoverySourceId: source.id,
      requirementSheetId: 10,
      qty: 20,
    });
    const reversed = await reverseRecovery(db, { allocationId: allocation.id, reason: "edit" });
    assert.equal(reversed.status, "REVERSED");
    const refreshed = await recomputeRecoveryStatus(db, source.id);
    assert.equal(refreshed.recoveryStatus, "OPEN");
    assert.equal(Number(refreshed.remainingQty), 50);
  });

  it("blocks reverse of COMMITTED allocation on locked RS", async () => {
    const db = makeDb();
    const source = await seedOpenSource(db, 50);
    const { allocation } = await allocateRecovery(db, {
      recoverySourceId: source.id,
      requirementSheetId: 10,
      qty: 20,
    });
    // Force committed + locked sheet
    const alloc = db._allocations.find((a) => a.id === allocation.id);
    alloc.status = "COMMITTED";
    alloc.requirementSheetId = 11;
    await assert.rejects(
      () => reverseRecovery(db, { allocationId: allocation.id }),
      (err) => err.code === "RECOVERY_IRREVERSIBLE",
    );
  });

  it("getAvailableRecovery and getRecoverySummary reflect math", async () => {
    const db = makeDb();
    const source = await seedOpenSource(db, 80);
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 20,
      sourceDocumentId: 9,
    });
    await allocateRecovery(db, { recoverySourceId: source.id, requirementSheetId: 10, qty: 30 });

    const available = await getAvailableRecovery(db, { salesOrderId: 42 });
    assert.equal(available.length, 2);
    const short = available.find((r) => r.recoveryType === "PRODUCTION_SHORTFALL");
    const qc = available.find((r) => r.recoveryType === "QC_FINAL_REJECTION");
    assert.equal(short.availableQty, 50);
    assert.equal(qc.availableQty, 20);

    const summary = await getRecoverySummary(db, 42);
    assert.equal(summary.totals.productionShortfallSourceQty, 80);
    assert.equal(summary.totals.productionShortfallAvailableQty, 50);
    assert.equal(summary.totals.qcFinalRejectionSourceQty, 20);
    assert.equal(summary.totals.activeAllocatedQty, 30);
  });
});
