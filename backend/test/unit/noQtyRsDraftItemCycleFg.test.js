/**
 * Cycle-specific FG item management on NO_QTY draft Requirement Sheets.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  addDraftRequirementSheetItem,
  removeDraftRequirementSheetItem,
  assertNoDuplicateItemIds,
  DUPLICATE_ITEM_MESSAGE,
} = require("../../src/services/noQtyRsDraftItemService");
const {
  createProductionShortRecovery,
  getAvailableRecovery,
} = require("../../src/services/noQtyRecoveryService");
const {
  keepItemRecovery,
  syncPendingRecoveryDecisionsForSheet,
} = require("../../src/services/noQtyRsRecoveryDecisionService");

function makeDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  let nextDecisionId = 1;
  let nextDecisionLineId = 1;
  let nextLineId = 200;
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
  const sheets = [
    { id: 10, status: "DRAFT", salesOrderId: 42, cycleId: 1 },
    { id: 20, status: "DRAFT", salesOrderId: 42, cycleId: 2 },
    { id: 30, status: "LOCKED", salesOrderId: 42, cycleId: 3 },
  ];
  /** @type {any[]} */
  const lines = [
    {
      id: 100,
      sheetId: 10,
      itemId: 501,
      requirementQty: "10",
      baseDemandQty: "10",
      productionShortfallQty: "0",
      qcRejectionRecoveryQty: "0",
      approvedManualAdjustmentQty: "0",
      totalRsQty: "10",
    },
  ];
  const cycles = { 1: { id: 1, cycleNo: 1 }, 2: { id: 2, cycleNo: 2 }, 3: { id: 3, cycleNo: 3 } };
  const salesOrders = {
    42: {
      id: 42,
      orderType: "NO_QTY",
      lines: [
        { itemId: 501, item: { id: 501, itemType: "FG", itemName: "Square Box" } },
        { itemId: 502, item: { id: 502, itemType: "FG", itemName: "Nozzle" } },
        { itemId: 503, item: { id: 503, itemType: "FG", itemName: "Cap" } },
      ],
    },
    99: { id: 99, orderType: "REGULAR", lines: [] },
  };
  const items = {
    501: { id: 501, itemName: "Square Box", unit: "Pcs" },
    502: { id: 502, itemName: "Nozzle", unit: "Pcs" },
    503: { id: 503, itemName: "Cap", unit: "Pcs" },
  };

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
            cycleId: sheet.cycleId,
            salesOrder: select.salesOrder ? { orderType: so?.orderType } : undefined,
            lines: select.lines ? sheetLines.map((l) => ({ id: l.id, itemId: l.itemId })) : undefined,
          };
        }
        return {
          ...sheet,
          salesOrder: include?.salesOrder
            ? {
                id: so.id,
                orderType: so.orderType,
                lines: so.lines,
              }
            : undefined,
          lines: include?.lines ? sheetLines.map((l) => ({ ...l })) : undefined,
          cycle: include?.cycle ? cycles[sheet.cycleId] : undefined,
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
        const dup = lines.find((l) => l.sheetId === data.sheetId && Number(l.itemId) === Number(data.itemId));
        if (dup) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextLineId++, ...data };
        lines.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = lines.find((l) => l.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }) => {
        const idx = lines.findIndex((l) => l.id === where.id);
        if (idx < 0) throw new Error("line not found");
        const [removed] = lines.splice(idx, 1);
        return removed;
      },
    },
    item: { findUnique: async ({ where }) => items[where.id] ?? null },
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
          sourceWorkOrder: include?.sourceWorkOrder
            ? { id: r.sourceWorkOrderId, docNo: `WO-${r.sourceWorkOrderId}` }
            : undefined,
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
          if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) {
            return false;
          }
          if (where.status != null && a.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(a.status)) return false;
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
      deleteMany: async ({ where }) => {
        let count = 0;
        for (let i = allocations.length - 1; i >= 0; i--) {
          const a = allocations[i];
          if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) continue;
          if (where.status != null && a.status !== where.status) continue;
          allocations.splice(i, 1);
          count += 1;
        }
        return { count };
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

describe("NO_QTY RS draft cycle FG item management", () => {
  it("rejects same item twice in one draft cycle", async () => {
    const db = makeDb();
    await assert.rejects(
      () => addDraftRequirementSheetItem(db, { requirementSheetId: 10, itemId: 501, actorUserId: 1 }),
      (err) => err.code === "DUPLICATE_RS_ITEM" && err.message === DUPLICATE_ITEM_MESSAGE,
    );
  });

  it("backend duplicate validation works even if frontend is bypassed", async () => {
    const db = makeDb();
    await addDraftRequirementSheetItem(db, { requirementSheetId: 10, itemId: 502 });
    await assert.rejects(
      () => addDraftRequirementSheetItem(db, { requirementSheetId: 10, itemId: 502 }),
      (err) => err.code === "DUPLICATE_RS_ITEM" && err.message === DUPLICATE_ITEM_MESSAGE,
    );
  });

  it("allows same item in different cycles", async () => {
    const db = makeDb();
    const added = await addDraftRequirementSheetItem(db, {
      requirementSheetId: 20,
      itemId: 501,
      actorUserId: 1,
      actorRole: "STORE",
    });
    assert.equal(added.itemId, 501);
    assert.equal(added.requirementSheetId, 20);
    assert.ok(db._lines.some((l) => l.sheetId === 20 && l.itemId === 501));
    assert.ok(db._lines.some((l) => l.sheetId === 10 && l.itemId === 501));
  });

  it("remove draft item performs recovery cleanup without deleting historical sources", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 40,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 88,
    });
    await keepItemRecovery(db, { requirementSheetId: 10, itemId: 501, actorUserId: 1 });
    assert.ok(db._allocations.some((a) => a.status === "RESERVED"));
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 })).length, 0);
    const sourceCountBefore = db._sources.length;

    const result = await removeDraftRequirementSheetItem(db, {
      requirementSheetId: 10,
      itemId: 501,
      actorUserId: 1,
      actorRole: "STORE",
    });
    assert.equal(result.removed, true);
    assert.equal(result.recoveryDecisionCleaned, true);
    assert.equal(db._lines.filter((l) => l.sheetId === 10 && l.itemId === 501).length, 0);
    assert.equal(db._decisions.filter((d) => d.requirementSheetId === 10 && d.itemId === 501).length, 0);
    assert.equal(db._sources.length, sourceCountBefore);
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 })).length, 1);
  });

  it("locked cycle cannot add or remove items", async () => {
    const db = makeDb();
    await assert.rejects(
      () => addDraftRequirementSheetItem(db, { requirementSheetId: 30, itemId: 502 }),
      (err) => err.code === "RS_NOT_DRAFT",
    );
    db._lines.push({
      id: 301,
      sheetId: 30,
      itemId: 501,
      requirementQty: "5",
      baseDemandQty: "5",
      productionShortfallQty: "0",
      qcRejectionRecoveryQty: "0",
      approvedManualAdjustmentQty: "0",
      totalRsQty: "5",
    });
    await assert.rejects(
      () => removeDraftRequirementSheetItem(db, { requirementSheetId: 30, itemId: 501 }),
      (err) => err.code === "RS_NOT_DRAFT",
    );
  });

  it("assertNoDuplicateItemIds rejects repeated ids in create payload", () => {
    assert.throws(
      () => assertNoDuplicateItemIds([501, 502, 501]),
      (err) => err.code === "DUPLICATE_RS_ITEM" && err.message === DUPLICATE_ITEM_MESSAGE,
    );
    assert.deepEqual(assertNoDuplicateItemIds([501, 502]), [501, 502]);
  });

  it("sync does not auto-inject FG items that are not on the draft cycle", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 8, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 503 },
      remainderQty: 12,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 99,
    });
    await syncPendingRecoveryDecisionsForSheet(db, { requirementSheetId: 10 });
    assert.equal(db._lines.filter((l) => l.sheetId === 10 && l.itemId === 503).length, 0);
    assert.equal(db._decisions.filter((d) => d.itemId === 503).length, 0);
    assert.equal((await getAvailableRecovery(db, { salesOrderId: 42, itemId: 503 })).length, 1);
  });
});
