/**
 * Batch 3F — End-to-end reconciliation audit for NO_QTY recovery identity.
 * Source Qty = Active Allocated Qty + Waived Qty + Available Qty
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAvailableQty,
  sumActiveAllocatedQty,
  buildRecoverySummaryFromRows,
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  allocateRecovery,
  reverseRecovery,
} = require("../../src/services/noQtyRecoveryService");
const { reconciliationOk } = require("../../src/services/noQtyRecoveryAnalyticsService");
const { closeNoQtySoWithWaiver, assessNoQtySoClosure } = require("../../src/services/noQtySoClosureService");

const EPS = 1e-6;

function assertIdentity(source, allocations, label) {
  const available = computeAvailableQty(source, allocations);
  const active = sumActiveAllocatedQty(allocations);
  const waived = Number(source.waivedQty || 0);
  const sourceQty = Number(source.sourceQty || source.remainingQty || 0);
  const sum = Math.round((active + waived + available) * 1000) / 1000;
  const src = Math.round(sourceQty * 1000) / 1000;
  assert.ok(
    Math.abs(src - sum) <= EPS,
    `${label}: source ${src} != alloc ${active} + waived ${waived} + avail ${available} (=${sum})`,
  );
  assert.equal(
    reconciliationOk({
      sourceQty: src,
      activeAllocatedQty: active,
      waivedQty: waived,
      availableQty: available,
    }),
    true,
    `${label}: reconciliationOk failed`,
  );
}

function makeEngineDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  let nextWaiverId = 1;
  let nextSnapId = 1;
  const sources = [];
  const allocations = [];
  const waivers = [];
  const waiverLines = [];
  const snapshots = [];
  const snapshotLines = [];
  const sheets = [{ id: 10, status: "DRAFT", salesOrderId: 42 }];
  const lines = [{ id: 100, sheetId: 10, itemId: 501 }];
  let so = { id: 42, orderType: "NO_QTY", internalStatus: "OPEN", docNo: "SO-42", currentCycleId: null };

  const db = {
    $queryRaw: async () => [{ id: so.id }],
    auditLog: { create: async () => ({ id: 1 }) },
    salesOrder: {
      findUnique: async ({ where }) => (where.id === so.id ? { ...so } : null),
      update: async ({ where, data }) => {
        if (where.id === so.id) Object.assign(so, data);
        return { ...so };
      },
    },
    salesOrderCycle: { findMany: async () => [], findFirst: async () => null, findUnique: async () => null },
    workOrder: { findMany: async () => [], count: async () => 0 },
    productionEntry: { findMany: async () => [], groupBy: async () => [] },
    qcEntry: { findMany: async () => [] },
    qcRejectedDisposition: { count: async () => 0 },
    dispatch: { count: async () => 0, findMany: async () => [] },
    requirementSheet: {
      count: async () => 0,
      findFirst: async () => null,
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
    productionMaterialRequest: { findFirst: async () => null },
    salesBill: { count: async () => 0 },
    noQtyAcceptedFgDisposition: { findMany: async () => [] },
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
            if (where?.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
            if (where?.recoveryStatus?.notIn?.includes(s.recoveryStatus)) return false;
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
        const row = {
          id: nextCfId++,
          waivedQty: "0",
          remainingQty: data.remainingQty ?? data.sourceQty,
          recoveryStatus: data.recoveryStatus ?? "OPEN",
          status: data.status ?? "PENDING",
          migrationIncomplete: false,
          createdAt: new Date(),
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
          if (where?.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          return true;
        }),
      findFirst: async ({ where }) =>
        allocations.find((a) => {
          if (where?.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          if (where?.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) {
            return false;
          }
          if (where?.status?.in && !where.status.in.includes(a.status)) return false;
          return true;
        }) ?? null,
      findUnique: async ({ where, include }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        const sheet = sheets.find((s) => s.id === row.requirementSheetId);
        return { ...row, requirementSheet: include?.requirementSheet ? sheet : undefined };
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
    noQtySoWaiver: {
      create: async ({ data }) => {
        const row = { id: nextWaiverId++, ...data };
        waivers.push(row);
        return row;
      },
    },
    noQtySoWaiverLine: {
      create: async ({ data }) => {
        waiverLines.push(data);
        return data;
      },
    },
    noQtySoCloseSnapshot: {
      aggregate: async () => ({ _max: { closeVersion: snapshots.length } }),
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        const row = { id: nextSnapId++, ...data };
        snapshots.push(row);
        return row;
      },
      findFirst: async () => snapshots[snapshots.length - 1] ?? null,
    },
    noQtySoClosedShortageLine: {
      create: async ({ data }) => {
        snapshotLines.push(data);
        return data;
      },
      findMany: async () => snapshotLines,
    },
    _so: () => so,
    _sources: sources,
  };
  return db;
}

describe("Batch 3F reconciliation audit", () => {
  it("production shortfall create maintains identity", async () => {
    const db = makeEngineDb();
    const src = await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 42, cycleId: 9 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 40,
      productionShortfallResolutionId: 11,
    });
    assertIdentity(src, [], "PS create");
  });

  it("QC final rejection create maintains identity", async () => {
    const db = makeEngineDb();
    const src = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 12,
      sourceDocumentId: 88,
      cycleId: 2,
    });
    assertIdentity(src, [], "QC create");
  });

  it("partial and full allocation maintain identity", async () => {
    const db = makeEngineDb();
    const src = await createProductionShortRecovery(db, {
      workOrder: { id: 2, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 30,
      productionShortfallResolutionId: 22,
    });
    await allocateRecovery(db, { recoverySourceId: src.id, requirementSheetId: 10, qty: 10 });
    let allocs = await db.recoveryAllocation.findMany({ where: { recoverySourceId: src.id } });
    let fresh = await db.carryForwardPending.findUnique({ where: { id: src.id } });
    assertIdentity(fresh, allocs, "partial alloc");

    await allocateRecovery(db, { recoverySourceId: src.id, requirementSheetId: 10, qty: 20 });
    allocs = await db.recoveryAllocation.findMany({ where: { recoverySourceId: src.id } });
    fresh = await db.carryForwardPending.findUnique({ where: { id: src.id } });
    assertIdentity(fresh, allocs, "full alloc");
    assert.equal(computeAvailableQty(fresh, allocs), 0);
  });

  it("reversal restores available and keeps identity", async () => {
    const db = makeEngineDb();
    const src = await createProductionShortRecovery(db, {
      workOrder: { id: 3, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 18,
      productionShortfallResolutionId: 33,
    });
    const { allocation } = await allocateRecovery(db, {
      recoverySourceId: src.id,
      requirementSheetId: 10,
      qty: 8,
    });
    await reverseRecovery(db, { allocationId: allocation.id, reason: "RS cancel" });
    const allocs = await db.recoveryAllocation.findMany({ where: { recoverySourceId: src.id } });
    const fresh = await db.carryForwardPending.findUnique({ where: { id: src.id } });
    assertIdentity(fresh, allocs, "after reverse");
    assert.equal(computeAvailableQty(fresh, allocs), 18);
  });

  it("waiver close zeros available and keeps identity", async () => {
    const db = makeEngineDb();
    const src = await createProductionShortRecovery(db, {
      workOrder: { id: 4, salesOrderId: 42 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 14,
      productionShortfallResolutionId: 44,
    });
    await closeNoQtySoWithWaiver(db, {
      salesOrderId: 42,
      reasonCode: "MANAGEMENT_DECISION",
      remarks: "3F recon audit",
      waiverLines: [{ recoverySourceId: src.id, waivedQty: 14 }],
      actorUserId: 99,
      skipPasswordCheck: true,
    });
    const fresh = await db.carryForwardPending.findUnique({ where: { id: src.id } });
    const allocs = await db.recoveryAllocation.findMany({ where: { recoverySourceId: src.id } });
    assertIdentity(fresh, allocs, "after waiver");
    assert.ok(Number(fresh.waivedQty) >= 14 - EPS);
    assert.equal(db._so().internalStatus, "CLOSED_WITH_WAIVER");
  });

  it("migrated MANUALLY_CLOSED treated as closed (compat)", async () => {
    const db = makeEngineDb();
    db._so().internalStatus = "MANUALLY_CLOSED";
    const a = await assessNoQtySoClosure(db, 42);
    assert.ok(a.blockers.some((b) => b.code === "ALREADY_CLOSED"));
  });

  it("summary builder preserves identity across mixed types", () => {
    const rows = [
      {
        id: 1,
        salesOrderId: 1,
        itemId: 1,
        recoveryType: "PRODUCTION_SHORTFALL",
        recoveryStatus: "OPEN",
        sourceQty: "100",
        waivedQty: "20",
        allocations: [{ status: "COMMITTED", allocatedQty: "30" }],
        item: { id: 1, itemName: "A", unit: "Kg" },
      },
      {
        id: 2,
        salesOrderId: 1,
        itemId: 2,
        recoveryType: "QC_FINAL_REJECTION",
        recoveryStatus: "PARTIALLY_ALLOCATED",
        sourceQty: "50",
        waivedQty: "0",
        allocations: [{ status: "RESERVED", allocatedQty: "15" }],
        item: { id: 2, itemName: "B", unit: "Kg" },
      },
    ];
    const summary = buildRecoverySummaryFromRows(1, rows);
    for (const s of summary.sources) assert.equal(reconciliationOk(s), true);
    assert.equal(summary.totals.productionShortfallAvailableQty, 50);
    assert.equal(summary.totals.qcFinalRejectionAvailableQty, 35);
  });

  it("exception summary: broken identity is detected", () => {
    assert.equal(
      reconciliationOk({
        sourceQty: 100,
        activeAllocatedQty: 10,
        waivedQty: 10,
        availableQty: 50,
      }),
      false,
    );
  });
});
