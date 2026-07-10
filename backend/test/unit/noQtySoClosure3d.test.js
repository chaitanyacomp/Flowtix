/**
 * Batch 3D — NO_QTY SO closure assessment & waiver tests (in-memory).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assessNoQtySoClosure,
  closeNoQtySoWithWaiver,
  closeNoQtySoComplete,
  recordAcceptedFgDisposition,
  CLOSURE_MODES,
} = require("../../src/services/noQtySoClosureService");
const { computeNoQtyManualCloseEligibility } = require("../../src/services/noQtySoManualCloseEligibility");
const {
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  computeAvailableQty,
  recomputeRecoveryStatus,
} = require("../../src/services/noQtyRecoveryService");

function makeClosureDb(overrides = {}) {
  let nextCfId = 1;
  let nextWaiverId = 1;
  let nextSnapId = 1;
  let nextDispId = 1;
  const sources = overrides.sources || [];
  const allocations = overrides.allocations || [];
  const dispositions = overrides.dispositions || [];
  const snapshots = [];
  const snapshotLines = [];
  const waivers = [];
  const waiverLines = [];

  let so = {
    id: 1,
    orderType: "NO_QTY",
    internalStatus: "OPEN",
    docNo: "SO-1",
    currentCycleId: null,
    ...(overrides.so || {}),
  };

  const db = {
    $queryRaw: async () => [{ id: so.id }],
    auditLog: {
      create: async () => ({ id: 1 }),
    },
    salesOrder: {
      findUnique: async ({ where }) => (where.id === so.id ? { ...so } : null),
      update: async ({ where, data }) => {
        if (where.id === so.id) Object.assign(so, data);
        return { ...so };
      },
    },
    salesOrderCycle: {
      findMany: async () => overrides.cycles || [],
      findFirst: async () => overrides.activeCycle ?? null,
      findUnique: async () => null,
    },
    workOrder: {
      findMany: async () => overrides.workOrders ?? [],
      count: async () => overrides.woCount ?? 0,
    },
    productionEntry: {
      findMany: async () => overrides.prodEntries ?? [],
      groupBy: async () => overrides.productionGroupBy ?? [],
    },
    qcEntry: {
      findMany: async () => overrides.qcEntries ?? [],
    },
    qcRejectedDisposition: {
      count: async () => overrides.openDispositionCount ?? 0,
    },
    dispatch: {
      count: async () => overrides.unlockedDispatchCount ?? 0,
      findMany: async (args) => {
        if (args?.where?.workflowStatus === "LOCKED") return overrides.lockedDispatch ?? [];
        if (args?.where?.workflowStatus === "UNLOCKED") return [];
        return overrides.allDispatch ?? [];
      },
    },
    requirementSheet: {
      count: async () => overrides.draftRsCount ?? 0,
      findFirst: async (args) => {
        if (args?.where?.status === "LOCKED") return overrides.lockedRs ?? null;
        return null;
      },
    },
    productionMaterialRequest: {
      findFirst: async () => overrides.openPmr ?? null,
    },
    salesBill: {
      count: async () => overrides.draftBillCount ?? 0,
    },
    noQtyAcceptedFgDisposition: {
      findMany: async () => dispositions,
      create: async ({ data }) => {
        const row = { id: nextDispId++, ...data };
        dispositions.push(row);
        return row;
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
      findMany: async ({ where }) =>
        allocations.filter((a) => {
          if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          return true;
        }),
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
        const row = { ...data };
        waiverLines.push(row);
        return row;
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
    user: {
      findMany: async () => [{ id: 99, passwordHash: "$2a$10$invalid" }],
    },
    _so: () => so,
    _sources: sources,
    _dispositions: dispositions,
    _waivers: waivers,
    _snapshots: snapshots,
  };

  // bcrypt will fail — tests use skipPasswordCheck
  return db;
}

describe("Batch 3D assessNoQtySoClosure", () => {
  it("returns COMPLETE when operationally clear and no recovery", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      workOrders: [],
      woCount: 0,
    });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.mode, CLOSURE_MODES.COMPLETE);
    assert.equal(a.eligible, true);
    assert.equal(a.blockers.length, 0);
  });

  it("blocks on each major operational gate", async () => {
    const cases = [
      { unlockedDispatchCount: 1, code: "DRAFT_DISPATCH_EXISTS" },
      { draftRsCount: 1, code: "ACTIVE_RS_DRAFT" },
      { draftBillCount: 1, code: "DRAFT_BILLING" },
      {
        activeCycle: { id: 10, cycleNo: 1 },
        lockedRs: { id: 1 },
        woCount: 0,
        code: "WO_PENDING",
      },
      {
        activeCycle: { id: 10, cycleNo: 1 },
        openPmr: { status: "REQUESTED" },
        code: "PMR_WAITING_STORE_ISSUE",
      },
    ];
    for (const c of cases) {
      const db = makeClosureDb(c);
      const a = await assessNoQtySoClosure(db, 1);
      assert.equal(a.mode, CLOSURE_MODES.BLOCKED, c.code);
      assert.ok(
        a.blockers.some((b) => b.code === c.code),
        `expected ${c.code}, got ${a.blockers.map((b) => b.code).join(",")}`,
      );
    }
  });

  it("returns WAIVER_REQUIRED when recovery is available and gates clear", async () => {
    const db = makeClosureDb({ activeCycle: null });
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 40,
      productionShortfallResolutionId: 1,
    });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.mode, CLOSURE_MODES.WAIVER_REQUIRED);
    assert.equal(a.proposedWaiverQty, 40);
    assert.equal(a.pendingProductionShortfallQty, 40);
  });

  it("blocks when accepted FG pending disposition", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      cycles: [{ id: 10, cycleNo: 1 }],
      workOrders: [{ id: 5 }],
      qcEntries: [
        {
          acceptedQty: "100",
          production: { workOrderLine: { fgItemId: 501 } },
        },
      ],
      lockedDispatch: [],
    });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.mode, CLOSURE_MODES.BLOCKED);
    assert.ok(a.blockers.some((b) => b.code === "FG_DISPOSITION_REQUIRED"));
  });
});

describe("Batch 3D FG disposition", () => {
  it("records disposition and clears FG blocker", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      cycles: [{ id: 10, cycleNo: 1 }],
      workOrders: [{ id: 5 }],
      qcEntries: [
        {
          acceptedQty: "25",
          production: { workOrderLine: { fgItemId: 501 } },
        },
      ],
      lockedDispatch: [],
    });
    let a = await assessNoQtySoClosure(db, 1);
    assert.ok(a.blockers.some((b) => b.code === "FG_DISPOSITION_REQUIRED"));

    await recordAcceptedFgDisposition(db, {
      salesOrderId: 1,
      itemId: 501,
      qty: 25,
      dispositionType: "TRANSFER_TO_GENERAL_STOCK",
      actorUserId: null,
    });
    a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.acceptedFgPendingDispositionQty, 0);
    assert.ok(!a.blockers.some((b) => b.code === "FG_DISPOSITION_REQUIRED"));
  });

  it("rejects Green Level transfer disposition type", async () => {
    const db = makeClosureDb({ activeCycle: null });
    await assert.rejects(
      () =>
        recordAcceptedFgDisposition(db, {
          salesOrderId: 1,
          itemId: 501,
          qty: 1,
          dispositionType: "TRANSFER_TO_GREEN_LEVEL",
        }),
      (err) => err.code === "INVALID_DISPOSITION_TYPE" || err.code === "GREEN_LEVEL_TRANSFER_FORBIDDEN",
    );
  });
});

describe("Batch 3D close with waiver", () => {
  it("successfully waives multiple recovery sources and closes", async () => {
    const db = makeClosureDb({ activeCycle: null });
    const s1 = await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 30,
      productionShortfallResolutionId: 11,
    });
    const s2 = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 1,
      itemId: 502,
      sourceQty: 20,
      sourceDocumentId: 22,
    });

    const result = await closeNoQtySoWithWaiver(db, {
      salesOrderId: 1,
      reasonCode: "MANAGEMENT_DECISION",
      remarks: "Customer cancelled remaining balance",
      waiverLines: [
        { recoverySourceId: s1.id, itemId: 501, waivedQty: 30 },
        { recoverySourceId: s2.id, itemId: 502, waivedQty: 20 },
      ],
      actorUserId: 99,
      skipPasswordCheck: true,
    });

    assert.equal(db._so().internalStatus, "CLOSED_WITH_WAIVER");
    assert.equal(result.waiver.reasonCode, "MANAGEMENT_DECISION");
    assert.equal(result.applied.length, 2);
    assert.equal(Number(db._sources.find((s) => s.id === s1.id).waivedQty), 30);
    assert.equal(db._sources.find((s) => s.id === s1.id).recoveryStatus, "WAIVED");
  });

  it("supports partial available waiver when source already partially allocated", async () => {
    const db = makeClosureDb({ activeCycle: null });
    const s1 = await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 100,
      productionShortfallResolutionId: 33,
    });
    // Simulate prior COMMITTED allocation of 40
    db._sources; // touch
    const allocations = [];
    allocations.push({
      recoverySourceId: s1.id,
      allocatedQty: "40",
      status: "COMMITTED",
    });
    // inject into db recoveryAllocation findMany via mutating shared array — recreate with allocations
    const db2 = makeClosureDb({
      activeCycle: null,
      sources: [
        {
          id: s1.id,
          salesOrderId: 1,
          itemId: 501,
          recoveryType: "PRODUCTION_SHORTFALL",
          sourceDocumentType: "PRODUCTION_SHORTFALL_RESOLUTION",
          sourceDocumentId: 33,
          sourceQty: "100",
          remainingQty: "60",
          waivedQty: "0",
          recoveryStatus: "PARTIALLY_ALLOCATED",
          status: "PENDING",
        },
      ],
      allocations: [{ recoverySourceId: s1.id, allocatedQty: "40", status: "COMMITTED" }],
    });
    // Force next cf id
    const a = await assessNoQtySoClosure(db2, 1);
    assert.equal(a.proposedWaiverQty, 60);

    await closeNoQtySoWithWaiver(db2, {
      salesOrderId: 1,
      reasonCode: "COMMERCIAL_SETTLEMENT",
      remarks: "Waive remaining unallocated recovery",
      waiverLines: [{ recoverySourceId: s1.id, itemId: 501, waivedQty: 60 }],
      actorUserId: 99,
      skipPasswordCheck: true,
    });
    assert.equal(db2._so().internalStatus, "CLOSED_WITH_WAIVER");
    assert.equal(Number(db2._sources[0].waivedQty), 60);
  });

  it("rejects waiver beyond available", async () => {
    const db = makeClosureDb({ activeCycle: null });
    const s1 = await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 10,
      productionShortfallResolutionId: 44,
    });
    await assert.rejects(
      () =>
        closeNoQtySoWithWaiver(db, {
          salesOrderId: 1,
          reasonCode: "OTHER",
          remarks: "too much",
          waiverLines: [{ recoverySourceId: s1.id, waivedQty: 11 }],
          actorUserId: 99,
          skipPasswordCheck: true,
        }),
      (err) => err.code === "WAIVER_QTY_MISMATCH",
    );
  });

  it("complete close succeeds without waiver when no recovery", async () => {
    const db = makeClosureDb({ activeCycle: null });
    const result = await closeNoQtySoComplete(db, { salesOrderId: 1, actorUserId: null });
    assert.equal(db._so().internalStatus, "COMPLETED");
    assert.equal(result.assessment.mode, CLOSURE_MODES.COMPLETE);
  });

  it("complete close rejects when waiver required", async () => {
    const db = makeClosureDb({ activeCycle: null });
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 5,
      productionShortfallResolutionId: 55,
    });
    await assert.rejects(
      () => closeNoQtySoComplete(db, { salesOrderId: 1 }),
      (err) => err.code === "WAIVER_REQUIRED",
    );
  });
});

describe("Batch 3D eligibility adapter + reopen compatibility", () => {
  it("adapter reports WAIVER_REQUIRED as eligible with reason", async () => {
    const db = makeClosureDb({ activeCycle: null });
    await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 8,
      productionShortfallResolutionId: 66,
    });
    const e = await computeNoQtyManualCloseEligibility(db, 1);
    assert.equal(e.eligible, true);
    assert.equal(e.reason, "WAIVER_REQUIRED");
    assert.equal(e.mode, CLOSURE_MODES.WAIVER_REQUIRED);
  });

  it("treats MANUALLY_CLOSED as already closed (migration compat)", async () => {
    const db = makeClosureDb({ so: { internalStatus: "MANUALLY_CLOSED" }, activeCycle: null });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.mode, CLOSURE_MODES.BLOCKED);
    assert.ok(a.blockers.some((b) => b.code === "ALREADY_CLOSED"));
  });

  it("treats CLOSED_WITH_WAIVER as already closed (reopen-eligible status)", async () => {
    const db = makeClosureDb({ so: { internalStatus: "CLOSED_WITH_WAIVER" }, activeCycle: null });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.mode, CLOSURE_MODES.BLOCKED);
    assert.ok(a.blockers.some((b) => b.code === "ALREADY_CLOSED"));
  });
});

describe("Batch 3D concurrency", () => {
  it("second close fails after first waiver close", async () => {
    const db = makeClosureDb({ activeCycle: null });
    const s1 = await createProductionShortRecovery(db, {
      workOrder: { id: 1, salesOrderId: 1 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 12,
      productionShortfallResolutionId: 77,
    });
    await closeNoQtySoWithWaiver(db, {
      salesOrderId: 1,
      reasonCode: "MANAGEMENT_DECISION",
      remarks: "first close",
      waiverLines: [{ recoverySourceId: s1.id, waivedQty: 12 }],
      actorUserId: 99,
      skipPasswordCheck: true,
    });
    await assert.rejects(
      () =>
        closeNoQtySoWithWaiver(db, {
          salesOrderId: 1,
          reasonCode: "MANAGEMENT_DECISION",
          remarks: "second close",
          waiverLines: [{ recoverySourceId: s1.id, waivedQty: 12 }],
          actorUserId: 99,
          skipPasswordCheck: true,
        }),
      (err) => err.code === "NO_QTY_CLOSE_BLOCKED" || err.reason === "ALREADY_CLOSED",
    );
  });
});
