/**
 * Phase 2B — RS recovery integration (discovery-only sync; Keep allocates).
 * Replaces obsolete Batch 3C auto-allocate expectations.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  getAvailableRecovery,
} = require("../../src/services/noQtyRecoveryService");
const {
  syncDraftRsWithAvailableRecovery,
  syncEligibleDraftRsAfterProductionShortfallCreated,
  consumeCarryForwardPendingForRequirementSheet,
  finalizeRecoveryOnRequirementSheetLock,
} = require("../../src/services/noQtyRsRecoveryIntegrationService");
const {
  keepItemRecovery,
  waiveItemRecovery,
} = require("../../src/services/noQtyRsRecoveryDecisionService");
const { shouldSuppressRecoveryPendingAction } = require("../../src/services/noQtyRecoveryAnalyticsService");

function makeDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  let nextLineId = 1;
  let nextDecisionId = 1;
  let nextDecisionLineId = 1;
  const sources = [];
  const allocations = [];
  const decisions = [];
  const decisionLines = [];
  const sheets = [{ id: 10, status: "DRAFT", salesOrderId: 42, cycleId: 2, cycleNo: 2, cycleStatus: "ACTIVE" }];
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
  const salesOrders = { 42: { id: 42, orderType: "NO_QTY", currentCycleId: 2 } };
  const items = { 501: { id: 501, itemName: "Nozzle", unit: "Pcs" }, 502: { id: 502, itemName: "Cap", unit: "Pcs" } };

  const db = {
    salesOrder: { findUnique: async ({ where }) => salesOrders[where.id] ?? null },
    requirementSheet: {
      findUnique: async ({ where, include, select }) => {
        const sheet = sheets.find((s) => s.id === where.id);
        if (!sheet) return null;
        const wantSalesOrder = Boolean(include?.salesOrder || select?.salesOrder);
        const wantLines = Boolean(include?.lines || select?.lines);
        return {
          ...sheet,
          lines: wantLines
            ? lines.filter((l) => l.sheetId === sheet.id).map((l) =>
                select?.lines?.select ? { id: l.id, itemId: l.itemId } : { ...l },
              )
            : undefined,
          salesOrder: wantSalesOrder
            ? select?.salesOrder?.select
              ? { orderType: salesOrders[sheet.salesOrderId].orderType }
              : salesOrders[sheet.salesOrderId]
            : undefined,
        };
      },
      findMany: async ({ where, select }) => {
        const rows = sheets.filter((s) => {
          if (where.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
          if (where.status != null && s.status !== where.status) return false;
          return true;
        });
        return rows.map((s) => ({
          ...s,
          cycle: select?.cycle
            ? { id: s.cycleId ?? 1, cycleNo: s.cycleNo ?? 2, status: s.cycleStatus ?? "ACTIVE" }
            : undefined,
        }));
      },
      findFirst: async ({ where, select }) => {
        const rows = sheets.filter((s) => {
          if (where?.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
          if (where?.status != null && s.status !== where.status) return false;
          return true;
        });
        const s = rows[0];
        if (!s) return null;
        return {
          ...s,
          cycle: select?.cycle
            ? { id: s.cycleId ?? 1, cycleNo: s.cycleNo ?? 2, status: s.cycleStatus ?? "ACTIVE" }
            : undefined,
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
      findMany: async ({ where }) => lines.filter((l) => !where?.sheetId || l.sheetId === where.sheetId),
      create: async ({ data }) => {
        const row = { id: 100 + nextLineId++, ...data };
        lines.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = lines.find((l) => l.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      deleteMany: async () => ({ count: 0 }),
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
          allocations: include?.allocations ? allocations.filter((a) => a.recoverySourceId === row.id) : undefined,
        };
      },
      findMany: async ({ where, include }) => {
        const rows = sources.filter((s) => {
          if (where.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
          if (where.itemId != null && s.itemId !== where.itemId) return false;
          if (where.recoveryType != null && s.recoveryType !== where.recoveryType) return false;
          if (where.id?.in && !where.id.in.includes(s.id)) return false;
          if (where.recoveryStatus?.notIn && where.recoveryStatus.notIn.includes(s.recoveryStatus)) return false;
          return true;
        });
        return rows.map((r) => ({
          ...r,
          allocations: include?.allocations ? allocations.filter((a) => a.recoverySourceId === r.id) : undefined,
          item: include?.item ? items[r.itemId] : undefined,
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
        allocations.filter((a) => {
          if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          if (where.requirementSheetId != null && a.requirementSheetId !== where.requirementSheetId) return false;
          if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) return false;
          if (where.status != null && a.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(a.status)) return false;
          return true;
        }),
      findFirst: async ({ where }) => {
        const rows = await db.recoveryAllocation.findMany({ where });
        return rows[0] ?? null;
      },
      findUnique: async ({ where, include }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        return {
          ...row,
          requirementSheet: include?.requirementSheet ? sheets.find((s) => s.id === row.requirementSheetId) : undefined,
          recoverySource: include?.recoverySource ? sources.find((s) => s.id === row.recoverySourceId) : undefined,
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
          if (where.requirementSheetId != null && allocations[i].requirementSheetId === where.requirementSheetId) {
            allocations.splice(i, 1);
          }
        }
        return { count: 0 };
      },
    },
    noQtyRsItemRecoveryDecision: {
      findMany: async ({ where, include }) => {
        const rows = decisions.filter((d) => {
          if (where.requirementSheetId != null && d.requirementSheetId !== where.requirementSheetId) return false;
          if (where.status != null && d.status !== where.status) return false;
          if (where.status?.not && d.status === where.status.not) return false;
          if (where.status?.in && !where.status.in.includes(d.status)) return false;
          return true;
        });
        return rows.map((d) => ({
          ...d,
          item: include?.item ? items[d.itemId] : undefined,
          lines: include?.lines ? decisionLines.filter((l) => l.decisionId === d.id) : undefined,
        }));
      },
      findUnique: async ({ where, include }) => {
        let row = null;
        if (where.requirementSheetId_itemId) {
          row = decisions.find(
            (d) =>
              d.requirementSheetId === where.requirementSheetId_itemId.requirementSheetId &&
              d.itemId === where.requirementSheetId_itemId.itemId,
          );
        }
        if (!row) return null;
        return {
          ...row,
          lines: include?.lines ? decisionLines.filter((l) => l.decisionId === row.id) : undefined,
        };
      },
      create: async ({ data }) => {
        const row = { id: nextDecisionId++, ...data };
        decisions.push(row);
        return { ...row };
      },
      update: async ({ where, data, include }) => {
        const row = decisions.find((d) => d.id === where.id);
        Object.assign(row, data);
        return {
          ...row,
          lines: include?.lines ? decisionLines.filter((l) => l.decisionId === row.id) : undefined,
        };
      },
      delete: async ({ where }) => {
        const idx = decisions.findIndex((d) => d.id === where.id);
        if (idx >= 0) decisions.splice(idx, 1);
        return { id: where.id };
      },
    },
    noQtyRsItemRecoveryDecisionLine: {
      deleteMany: async ({ where }) => {
        for (let i = decisionLines.length - 1; i >= 0; i--) {
          if (decisionLines[i].decisionId === where.decisionId) decisionLines.splice(i, 1);
        }
        return { count: 0 };
      },
      createMany: async ({ data }) => {
        for (const row of data) decisionLines.push({ id: nextDecisionLineId++, ...row });
        return { count: data.length };
      },
    },
    _sources: sources,
    _allocations: allocations,
    _decisions: decisions,
    _lines: lines,
    _sheets: sheets,
  };
  return db;
}

describe("Phase 2B RS recovery integration", () => {
  it("sync discovers PENDING and does not allocate production shortfall", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 25,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 1,
    });
    const sync = await syncDraftRsWithAvailableRecovery(db, { requirementSheetId: 10, salesOrderId: 42 });
    assert.equal(sync.allocated.length, 0);
    assert.equal(db._decisions.length, 1);
    assert.equal(db._decisions[0].status, "PENDING");
    assert.equal(db._allocations.length, 0);
  });

  it("consumeCarryForwardPendingForRequirementSheet seeds PENDING only", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 10,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 2,
    });
    const result = await consumeCarryForwardPendingForRequirementSheet(db, {
      salesOrderId: 42,
      requirementSheetId: 10,
      itemIds: [501],
    });
    assert.equal(result.allocated.length, 0);
    assert.equal(db._decisions[0].status, "PENDING");
  });

  it("Keep then lock commits both PS and QC", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 20,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 3,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 5,
      sourceDocumentId: 99,
    });
    await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501 });
    assert.equal(db._allocations.length, 2);
    const fin = await finalizeRecoveryOnRequirementSheetLock(db, { requirementSheetId: 10 });
    assert.ok(fin.committed);
    assert.ok(db._allocations.every((a) => a.status === "COMMITTED"));
  });

  it("late shortfall seeds PENDING only for FG items already on the draft cycle", async () => {
    const db = makeDb();
    // Item 502 is not on draft sheet 10 — must not be auto-injected (cycle-specific FG sets).
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 502 },
      remainderQty: 8,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 4,
    });
    const lateOther = await syncEligibleDraftRsAfterProductionShortfallCreated(db, {
      salesOrderId: 42,
      excludeRequirementSheetIds: [1],
    });
    assert.equal(lateOther.synced, true);
    assert.equal(lateOther.allocated.length, 0);
    assert.equal(db._lines.filter((l) => l.itemId === 502).length, 0);
    assert.equal(db._decisions.filter((d) => d.itemId === 502).length, 0);

    // Same late shortfall for an item already on the draft → PENDING, no allocate.
    await createProductionShortRecovery(db, {
      workOrder: { id: 8, salesOrderId: 42, requirementSheetId: 1, cycleId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 6,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 5,
    });
    const lateOnSheet = await syncEligibleDraftRsAfterProductionShortfallCreated(db, {
      salesOrderId: 42,
      excludeRequirementSheetIds: [1],
    });
    assert.equal(lateOnSheet.synced, true);
    assert.equal(lateOnSheet.allocated.length, 0);
    assert.equal(db._decisions.find((d) => d.itemId === 501)?.status, "PENDING");
  });

  it("Waive leaves RS line totals without recovery components", async () => {
    const db = makeDb();
    db._lines[0].requirementQty = "100";
    db._lines[0].baseDemandQty = "100";
    db._lines[0].totalRsQty = "100";
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 7,
      sourceDocumentId: 55,
    });
    await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Customer waived recovery qty",
    });
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42 })).length, 0);
    assert.equal(db._decisions[0].status, "WAIVED");
  });

  it("PA suppression still treats draft/create-next as covered for per-source CTAs", () => {
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "PRODUCTION_SHORTFALL",
        nextRsDraftExists: true,
      }),
      true,
    );
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "QC_FINAL_REJECTION",
        createNextRsEligible: true,
      }),
      true,
    );
  });
});
