/**
 * Batch 3C — RS recovery integration tests (in-memory).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  reverseRecovery,
  getAvailableRecovery,
  commitReservedAllocationsForSheet,
} = require("../../src/services/noQtyRecoveryService");
const {
  autoAllocateProductionShortfallForSheet,
  allocateQcRecoveryToSheet,
  finalizeRecoveryOnRequirementSheetLock,
  reverseRecoveryOnRequirementSheetCancel,
  reverseRecoveryOnDraftRequirementSheetDelete,
  syncRequirementSheetLineComponents,
} = require("../../src/services/noQtyRsRecoveryIntegrationService");
const { consumeCarryForwardPendingForRequirementSheet } = require("../../src/services/carryForwardPendingService");

function makeDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  let nextLineId = 1;
  const sources = [];
  const allocations = [];
  const sheets = [{ id: 10, status: "DRAFT", salesOrderId: 42 }];
  const lines = [
    {
      id: 100,
      sheetId: 10,
      itemId: 501,
      requirementQty: "0",
      baseDemandQty: "0",
      productionShortfallQty: "0",
      qcRejectionRecoveryQty: "0",
      approvedManualAdjustmentQty: "0",
      totalRsQty: "0",
      shortfallQtySnapshot: null,
    },
  ];
  const salesOrders = { 42: { id: 42, orderType: "NO_QTY" } };

  const db = {
    salesOrder: {
      findUnique: async ({ where }) => salesOrders[where.id] ?? null,
    },
    requirementSheet: {
      findUnique: async ({ where, include }) => {
        const sheet = sheets.find((s) => s.id === where.id);
        if (!sheet) return null;
        return {
          ...sheet,
          lines: include?.lines ? lines.filter((l) => l.sheetId === sheet.id) : undefined,
          salesOrder: include?.salesOrder ? salesOrders[sheet.salesOrderId] : undefined,
        };
      },
      update: async ({ where, data }) => {
        const sheet = sheets.find((s) => s.id === where.id);
        Object.assign(sheet, data);
        return { ...sheet };
      },
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
      findFirst: async ({ where }) =>
        lines.find((l) => l.sheetId === where.sheetId && l.itemId === where.itemId) ?? null,
      findMany: async ({ where }) => lines.filter((l) => l.sheetId === where.sheetId),
      create: async ({ data }) => {
        const row = {
          id: nextLineId++,
          productionShortfallQty: "0",
          qcRejectionRecoveryQty: "0",
          approvedManualAdjustmentQty: "0",
          totalRsQty: "0",
          shortfallQtySnapshot: null,
          ...data,
        };
        lines.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = lines.find((l) => l.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        for (const row of lines.filter((l) => l.sheetId === where.sheetId && l.itemId === where.itemId)) {
          Object.assign(row, data);
        }
        return { count: 1 };
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
            if (where.itemId != null && s.itemId !== where.itemId) return false;
            if (where.recoveryType != null && s.recoveryType !== where.recoveryType) return false;
            if (where.recoveryStatus?.notIn?.includes(s.recoveryStatus)) return false;
            return true;
          })
          .map((r) => ({
            ...r,
            allocations: include?.allocations
              ? allocations.filter((a) => a.recoverySourceId === r.id)
              : undefined,
            item: include?.item ? { id: r.itemId, itemName: `Item-${r.itemId}`, unit: "Kg" } : undefined,
          })),
      create: async ({ data }) => {
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
      findMany: async ({ where, include }) => {
        let rows = allocations.filter((a) => {
          if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          if (where.requirementSheetId != null && a.requirementSheetId !== where.requirementSheetId) return false;
          if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) {
            return false;
          }
          if (where.status != null) {
            if (where.status.in && !where.status.in.includes(a.status)) return false;
            if (typeof where.status === "string" && a.status !== where.status) return false;
          }
          if (where.recoverySource?.recoveryType) {
            const src = sources.find((s) => s.id === a.recoverySourceId);
            if (!src || src.recoveryType !== where.recoverySource.recoveryType) return false;
          }
          return true;
        });
        return rows.map((a) => ({
          ...a,
          recoverySource: include?.recoverySource
            ? sources.find((s) => s.id === a.recoverySourceId)
            : undefined,
          requirementSheet: include?.requirementSheet
            ? sheets.find((s) => s.id === a.requirementSheetId)
            : undefined,
        }));
      },
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
      deleteMany: async ({ where }) => {
        for (let i = allocations.length - 1; i >= 0; i--) {
          if (allocations[i].requirementSheetId === where.requirementSheetId) allocations.splice(i, 1);
        }
        return { count: 1 };
      },
    },
    _sources: sources,
    _allocations: allocations,
    _lines: lines,
    _sheets: sheets,
  };
  return db;
}

describe("Batch 3C RS recovery integration", () => {
  it("auto-allocates production shortfall even when base demand is 0", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 75,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 11,
    });

    const result = await autoAllocateProductionShortfallForSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    assert.equal(result.allocated.length, 1);
    assert.equal(result.allocated[0].qty, 75);

    const line = db._lines.find((l) => l.itemId === 501);
    assert.equal(Number(line.baseDemandQty), 0);
    assert.equal(Number(line.productionShortfallQty), 75);
    assert.equal(Number(line.totalRsQty), 75);
    assert.equal(db._allocations[0].status, "RESERVED");

    const available = await getAvailableRecovery(db, { salesOrderId: 42, recoveryType: "PRODUCTION_SHORTFALL" });
    assert.equal(available.length, 0);
  });

  it("does not duplicate previously allocated shortfall on second create pass", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 40,
      productionShortfallResolutionId: 12,
    });
    await consumeCarryForwardPendingForRequirementSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    const again = await consumeCarryForwardPendingForRequirementSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    assert.equal(again.allocated.length, 0);
    assert.equal(db._allocations.filter((a) => a.status === "RESERVED").length, 1);
  });

  it("supports partial QC allocation across multiple sources and items", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 30,
      sourceDocumentId: 201,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 20,
      sourceDocumentId: 202,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 502,
      sourceQty: 15,
      sourceDocumentId: 203,
    });

    const srcs = await getAvailableRecovery(db, { salesOrderId: 42, recoveryType: "QC_FINAL_REJECTION" });
    assert.equal(srcs.length, 3);

    const a = await allocateQcRecoveryToSheet(db, {
      requirementSheetId: 10,
      recoverySourceId: srcs.find((s) => s.sourceDocumentId === 201).recoverySourceId,
      qty: 10,
    });
    assert.equal(Number(a.line.qcRejectionRecoveryQty), 10);

    await allocateQcRecoveryToSheet(db, {
      requirementSheetId: 10,
      recoverySourceId: srcs.find((s) => s.sourceDocumentId === 202).recoverySourceId,
      qty: 20,
    });
    await allocateQcRecoveryToSheet(db, {
      requirementSheetId: 10,
      recoverySourceId: srcs.find((s) => s.sourceDocumentId === 203).recoverySourceId,
      qty: 15,
    });

    const line501 = db._lines.find((l) => l.itemId === 501);
    const line502 = db._lines.find((l) => l.itemId === 502);
    assert.equal(Number(line501.qcRejectionRecoveryQty), 30);
    assert.equal(Number(line502.qcRejectionRecoveryQty), 15);
    assert.equal(db._allocations.filter((x) => x.status === "RESERVED").length, 3);
  });

  it("draft base edit syncs total without reversing shortfall reservation", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 50,
      productionShortfallResolutionId: 13,
    });
    await autoAllocateProductionShortfallForSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    const line = db._lines.find((l) => l.itemId === 501);
    await db.requirementSheetLine.update({
      where: { id: line.id },
      data: { requirementQty: "25", baseDemandQty: "25" },
    });
    const synced = await syncRequirementSheetLineComponents(db, line.id);
    assert.equal(Number(synced.baseDemandQty), 25);
    assert.equal(Number(synced.productionShortfallQty), 50);
    assert.equal(Number(synced.totalRsQty), 75);
    assert.equal(db._allocations.filter((a) => a.status === "RESERVED").length, 1);
  });

  it("lock commits RESERVED allocations and snapshots totalRsQty", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 60,
      productionShortfallResolutionId: 14,
    });
    await autoAllocateProductionShortfallForSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    await db.requirementSheetLine.update({
      where: { id: 100 },
      data: { requirementQty: "10", baseDemandQty: "10" },
    });

    const { committed, lines } = await finalizeRecoveryOnRequirementSheetLock(db, {
      requirementSheetId: 10,
      actorUserId: 1,
    });
    assert.equal(committed.length, 1);
    assert.equal(committed[0].status, "COMMITTED");
    assert.equal(Number(lines[0].totalRsQty), 70);
    assert.equal(Number(lines[0].suggestedWoQtySnapshot ?? lines[0].totalRsQty), 70);
  });

  it("cancel reverses COMMITTED allocations after sheet is CANCELLED", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 30,
      productionShortfallResolutionId: 15,
    });
    await autoAllocateProductionShortfallForSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    await commitReservedAllocationsForSheet(db, { requirementSheetId: 10 });
    db._sheets[0].status = "LOCKED";

    await assert.rejects(
      () => reverseRecovery(db, { allocationId: db._allocations[0].id }),
      (err) => err.code === "RECOVERY_IRREVERSIBLE",
    );

    db._sheets[0].status = "CANCELLED";
    await reverseRecoveryOnRequirementSheetCancel(db, { requirementSheetId: 10 });
    assert.equal(db._allocations[0].status, "REVERSED");
    const available = await getAvailableRecovery(db, { salesOrderId: 42, recoveryType: "PRODUCTION_SHORTFALL" });
    assert.equal(available[0].availableQty, 30);
  });

  it("draft delete reverses and removes allocation rows", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 12,
      productionShortfallResolutionId: 16,
    });
    await autoAllocateProductionShortfallForSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    await reverseRecoveryOnDraftRequirementSheetDelete(db, { requirementSheetId: 10 });
    assert.equal(db._allocations.length, 0);
    const available = await getAvailableRecovery(db, { salesOrderId: 42, recoveryType: "PRODUCTION_SHORTFALL" });
    assert.equal(available[0].availableQty, 12);
  });

  it("rejects over-allocation of QC recovery", async () => {
    const db = makeDb();
    const src = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 5,
      sourceDocumentId: 301,
    });
    await assert.rejects(
      () =>
        allocateQcRecoveryToSheet(db, {
          requirementSheetId: 10,
          recoverySourceId: src.id,
          qty: 6,
        }),
      (err) => err.code === "RECOVERY_OVER_ALLOC",
    );
  });

  it("auto-adds shortfall-only item line when base demand item set omits it", async () => {
    const db = makeDb();
    // Only item 501 on sheet initially; shortfall on 502
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42 },
      workOrderLine: { fgItemId: 502 },
      remainderQty: 18,
      productionShortfallResolutionId: 17,
    });
    const result = await autoAllocateProductionShortfallForSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    assert.ok(result.createdItemIds.includes(502));
    const line502 = db._lines.find((l) => l.itemId === 502);
    assert.ok(line502);
    assert.equal(Number(line502.productionShortfallQty), 18);
    assert.equal(Number(line502.baseDemandQty), 0);
  });
});

describe("Batch 3C concurrent RS allocation", () => {
  it("serializes competing QC allocations against one source", async () => {
    const db = makeDb();
    const src = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 100,
      sourceDocumentId: 401,
    });

    /** @type {Map<number, Promise<void>>} */
    const locks = new Map();
    async function withLock(id, fn) {
      const prev = locks.get(id) || Promise.resolve();
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      locks.set(
        id,
        prev.then(() => gate),
      );
      await prev;
      try {
        return await fn();
      } finally {
        release();
      }
    }

    const results = await Promise.allSettled([
      withLock(src.id, () =>
        allocateQcRecoveryToSheet(db, { requirementSheetId: 10, recoverySourceId: src.id, qty: 70 }),
      ),
      withLock(src.id, () =>
        allocateQcRecoveryToSheet(db, { requirementSheetId: 10, recoverySourceId: src.id, qty: 70 }),
      ),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].reason.code, "RECOVERY_OVER_ALLOC");
  });
});
