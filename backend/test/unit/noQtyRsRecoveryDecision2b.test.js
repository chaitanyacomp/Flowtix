/**
 * Phase 2B — Keep/Waive recovery decisions (unit, no live DB).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  getAvailableRecovery,
  getRecoverySummary,
} = require("../../src/services/noQtyRecoveryService");
const {
  syncPendingRecoveryDecisionsForSheet,
  keepItemRecovery,
  waiveItemRecovery,
  reverseItemRecoveryDecision,
  assertNoPendingRecoveryDecisionsOrThrow,
  finalizeRecoveryDecisionsOnRequirementSheetLock,
} = require("../../src/services/noQtyRsRecoveryDecisionService");

function makeDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  let nextDecisionId = 1;
  let nextDecisionLineId = 1;
  /** @type {any[]} */
  const sources = [];
  /** @type {any[]} */
  const allocations = [];
  /** @type {any[]} */
  const decisions = [];
  /** @type {any[]} */
  const decisionLines = [];
  /** @type {any[]} */
  const audits = [];
  /** @type {any[]} */
  const sheets = [{ id: 10, status: "DRAFT", salesOrderId: 42 }];
  /** @type {any[]} */
  const lines = [
    { id: 100, sheetId: 10, itemId: 501, requirementQty: "10", baseDemandQty: "10", productionShortfallQty: "0", qcRejectionRecoveryQty: "0", approvedManualAdjustmentQty: "0", totalRsQty: "10" },
  ];
  const salesOrders = { 42: { id: 42, orderType: "NO_QTY" }, 99: { id: 99, orderType: "REGULAR" } };
  const items = { 501: { id: 501, itemName: "Nozzle", unit: "Pcs" }, 502: { id: 502, itemName: "Cap", unit: "Pcs" } };

  const db = {
    auditLog: {
      create: async ({ data }) => {
        const row = { id: audits.length + 1, ...data };
        audits.push(row);
        return { id: row.id };
      },
    },
    salesOrder: { findUnique: async ({ where }) => salesOrders[where.id] ?? null },
    requirementSheet: {
      findUnique: async ({ where, include, select }) => {
        const sheet = sheets.find((s) => s.id === where.id);
        if (!sheet) return null;
        const so = salesOrders[sheet.salesOrderId];
        const sheetLines = lines.filter((l) => l.sheetId === sheet.id);
        if (select) {
          return {
            id: sheet.id,
            status: sheet.status,
            salesOrderId: sheet.salesOrderId,
            salesOrder: select.salesOrder ? { orderType: so?.orderType } : undefined,
            lines: select.lines ? sheetLines.map((l) => ({ id: l.id, itemId: l.itemId })) : undefined,
          };
        }
        return {
          ...sheet,
          salesOrder: include?.salesOrder ? { id: so.id, orderType: so.orderType } : undefined,
          lines: include?.lines ? sheetLines.map((l) => ({ ...l })) : undefined,
        };
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
      findMany: async ({ where }) => lines.filter((l) => l.sheetId === where.sheetId),
      create: async ({ data }) => {
        const row = { id: 200 + lines.length, ...data };
        lines.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = lines.find((l) => l.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
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
          sourceWorkOrder: include?.sourceWorkOrder ? { id: r.sourceWorkOrderId, docNo: `WO-${r.sourceWorkOrderId}` } : undefined,
          sourceRequirementSheet: include?.sourceRequirementSheet
            ? { id: r.sourceRequirementSheetId, docNo: `RS-${r.sourceRequirementSheetId}`, cycleId: r.cycleId }
            : undefined,
          cycle: include?.cycle ? { id: r.cycleId, cycleNo: r.cycleId } : undefined,
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
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    recoveryAllocation: {
      findMany: async ({ where }) =>
        allocations.filter((a) => {
          if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          if (where.requirementSheetId != null && a.requirementSheetId !== where.requirementSheetId) return false;
          if (where.status != null && a.status !== where.status) return false;
          return true;
        }),
      findFirst: async ({ where }) => {
        return (
          allocations.find((a) => {
            if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
            if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) return false;
            if (where.status?.in && !where.status.in.includes(a.status)) return false;
            return true;
          }) ?? null
        );
      },
      findUnique: async ({ where, include }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        return {
          ...row,
          requirementSheet: include?.requirementSheet ? sheets.find((s) => s.id === row.requirementSheetId) : undefined,
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
    noQtyRsItemRecoveryDecision: {
      findMany: async ({ where, include }) => {
        let rows = decisions.filter((d) => {
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
          decidedBy: include?.decidedBy ? null : undefined,
        }));
      },
      findUnique: async ({ where, include }) => {
        let row = null;
        if (where.id != null) row = decisions.find((d) => d.id === where.id);
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
        const row = { id: nextDecisionId++, createdAt: new Date(), updatedAt: new Date(), ...data };
        decisions.push(row);
        return { ...row };
      },
      update: async ({ where, data, include }) => {
        const row = decisions.find((d) => d.id === where.id);
        if (!row) return null;
        Object.assign(row, data, { updatedAt: new Date() });
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
        for (const row of data) {
          decisionLines.push({ id: nextDecisionLineId++, ...row });
        }
        return { count: data.length };
      },
    },
    _sources: sources,
    _allocations: allocations,
    _decisions: decisions,
    _audits: audits,
    _lines: lines,
    _sheets: sheets,
  };
  return db;
}

describe("Phase 2B — discovery does not allocate", () => {
  it("RS sync seeds PENDING only; RS qty stays customer demand", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 200,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 88,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 2,
      sourceDocumentId: 55,
      workOrderId: 7,
    });

    await syncPendingRecoveryDecisionsForSheet(db, { requirementSheetId: 10 });
    assert.equal(db._decisions.length, 1);
    assert.equal(db._decisions[0].status, "PENDING");
    assert.equal(Number(db._decisions[0].pendingRecoveryQty), 202);
    assert.equal(db._allocations.length, 0);

    const available = await getAvailableRecovery(db, { salesOrderId: 42 });
    assert.equal(available.length, 2);
  });
});

describe("Phase 2B — Keep / Waive", () => {
  it("Keep allocates PS + QC atomically and updates line components path", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 200,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 88,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 2,
      sourceDocumentId: 55,
    });

    const kept = await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501 });
    assert.equal(kept.decision.status, "KEPT");
    assert.equal(db._allocations.length, 2);
    assert.ok(db._allocations.every((a) => a.status === "RESERVED"));
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 })).length, 0);
  });

  it("Waive requires reason and zeros available", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 50,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 89,
    });
    await assert.rejects(
      () => waiveItemRecovery(db, { requirementSheetId: 10, itemId: 501, reason: "no" }),
      (err) => err.code === "WAIVE_REASON_REQUIRED",
    );
    await assert.rejects(
      () => waiveItemRecovery(db, { requirementSheetId: 10, itemId: 501, reason: "  " }),
      (err) => err.code === "WAIVE_REASON_REQUIRED",
    );
    const waived = await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Customer cancelled excess demand",
      actorUserId: 2,
      actorRole: "STORE",
    });
    assert.equal(waived.decision.status, "WAIVED");
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42 })).length, 0);
    const summary = await getRecoverySummary(db, 42);
    assert.ok(summary.totals.waivedQty >= 50);
  });

  it("Store can Waive and audit records STORE role", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 40,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 101,
    });
    const waived = await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Store waived excess recovery",
      actorUserId: 22,
      actorRole: "STORE",
    });
    assert.equal(waived.decision.status, "WAIVED");
    assert.equal(waived.decision.decidedByUserId, 22);
    assert.ok(waived.decision.decidedAt);
    assert.equal(db._audits.length, 1);
    assert.equal(db._audits[0].actorRole, "STORE");
    assert.equal(db._audits[0].actorUserId, 22);
    assert.equal(db._audits[0].payload.decidedByRole, "STORE");
    assert.equal(db._audits[0].payload.actionLabel, "WAIVE");
    assert.equal(db._audits[0].payload.requirementSheetId, 10);
    assert.ok(Array.isArray(db._audits[0].payload.sources));
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 })).length, 0);
  });

  it("Admin can Waive and audit records ADMIN role", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 15,
      sourceDocumentId: 91,
    });
    const waived = await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Admin waived QC recovery",
      actorUserId: 1,
      actorRole: "ADMIN",
    });
    assert.equal(waived.decision.status, "WAIVED");
    assert.equal(db._audits[0].actorRole, "ADMIN");
    assert.equal(db._audits[0].payload.decidedByRole, "ADMIN");
  });

  it("waived recovery never reappears as available", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 25,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 102,
    });
    await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Permanent waiver",
      actorUserId: 22,
      actorRole: "STORE",
    });
    await syncPendingRecoveryDecisionsForSheet(db, { requirementSheetId: 10 });
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 })).length, 0);
    const pending = db._decisions.filter((d) => d.status === "PENDING");
    assert.equal(pending.length, 0);
  });

  it("no partial / concurrent Waive — second call is already decided", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 30,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 103,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 10,
      sourceDocumentId: 92,
    });
    const a = await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Full item waiver first",
      actorUserId: 22,
      actorRole: "STORE",
    });
    const b = await waiveItemRecovery(db, {
      requirementSheetId: 10,
      itemId: 501,
      reason: "Full item waiver second",
      actorUserId: 22,
      actorRole: "STORE",
    });
    assert.equal(a.alreadyDecided, false);
    assert.equal(b.alreadyDecided, true);
    assert.equal(Number(a.decision.pendingRecoveryQty), 40);
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 })).length, 0);
  });

  it("no partial keep — second concurrent keep is already decided", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 8,
      sourceDocumentId: 77,
    });
    const a = await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501 });
    const b = await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501 });
    assert.equal(a.alreadyDecided, false);
    assert.equal(b.alreadyDecided, true);
    assert.equal(db._allocations.length, 1);
  });

  it("lock blocked while PENDING", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 12,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 90,
    });
    await syncPendingRecoveryDecisionsForSheet(db, { requirementSheetId: 10 });
    await assert.rejects(
      () => assertNoPendingRecoveryDecisionsOrThrow(db, 10),
      (err) => err.code === "RECOVERY_DECISION_PENDING" && Array.isArray(err.details?.pendingItems),
    );
  });

  it("lock succeeds after Keep and commits reservations", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 12,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 91,
    });
    await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501 });
    const finalized = await finalizeRecoveryDecisionsOnRequirementSheetLock(db, {
      requirementSheetId: 10,
    });
    assert.ok(finalized.committed);
    assert.ok(db._allocations.every((a) => a.status === "COMMITTED"));
  });

  it("reverse Keep restores PENDING availability", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 5,
      sourceDocumentId: 80,
    });
    await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501 });
    await reverseItemRecoveryDecision(db, { requirementSheetId: 10, itemId: 501 });
    const available = await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 });
    assert.equal(available.length, 1);
    assert.equal(available[0].availableQty, 5);
  });

  it("items without recovery never create PENDING decisions", async () => {
    const db = makeDb();
    await syncPendingRecoveryDecisionsForSheet(db, { requirementSheetId: 10 });
    assert.equal(db._decisions.length, 0);
  });
});
