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

  const itemsById = new Map(
    (overrides.items || []).map((it) => [Number(it.id), it]),
  );

  const db = {
    $queryRaw: async () => [{ id: so.id }],
    auditLog: {
      create: async () => ({ id: 1 }),
    },
    item: {
      findMany: async ({ where } = {}) => {
        const ids = where?.id?.in;
        if (Array.isArray(ids)) {
          return ids.map((id) => itemsById.get(Number(id))).filter(Boolean);
        }
        return [...itemsById.values()];
      },
      findUnique: async ({ where } = {}) => itemsById.get(Number(where?.id)) ?? null,
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
        if (args?.where?.workflowStatus === "UNLOCKED") {
          if (overrides.unlockedDispatches) return overrides.unlockedDispatches;
          const n = overrides.unlockedDispatchCount ?? 0;
          return Array.from({ length: n }, (_, i) => ({ id: 9000 + i, docNo: `D-TEST-${i + 1}` }));
        }
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
      findMany: async ({ where } = {}) => {
        if (where?.status === "DRAFT") {
          if (overrides.draftBills) return overrides.draftBills;
          const n = overrides.draftBillCount ?? 0;
          return Array.from({ length: n }, (_, i) => ({
            id: 8000 + i,
            billNo: null,
            docNo: `SB-TEST-${i + 1}`,
          }));
        }
        if (where?.status === "FINALIZED" && where?.exportedAt === null) {
          return overrides.unexportedBills ?? [];
        }
        return overrides.salesBills ?? [];
      },
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
        lockedRs: {
          id: 1,
          lines: [{ itemId: 501, requirementQty: 10, suggestedWoQtySnapshot: 10, item: { id: 501, itemName: "FG" } }],
        },
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

  it("reports exact QC pending reason with WO count (not production)", async () => {
    const db = makeClosureDb({
      activeCycle: { id: 10, cycleNo: 1 },
      lockedRs: { id: 1 },
      woCount: 2,
      workOrders: [
        {
          id: 11,
          status: "IN_PROGRESS",
          productionExecution: { executionStatus: "COMPLETED" },
          lines: [{ id: 101, qty: 10 }],
        },
        {
          id: 12,
          status: "IN_PROGRESS",
          productionExecution: { executionStatus: "COMPLETED" },
          lines: [{ id: 102, qty: 5 }],
        },
      ],
      prodEntries: [
        {
          producedQty: 10,
          workOrderLineId: 101,
          workOrderLine: { workOrderId: 11 },
          qcEntries: [],
        },
        {
          producedQty: 5,
          workOrderLineId: 102,
          workOrderLine: { workOrderId: 12 },
          qcEntries: [],
        },
      ],
      productionGroupBy: [
        { workOrderLineId: 101, _sum: { producedQty: 10 } },
        { workOrderLineId: 102, _sum: { producedQty: 5 } },
      ],
    });
    // Stub produced qty path used by summarize
    const a = await assessNoQtySoClosure(db, 1);
    const qc = a.blockers.find((b) => b.code === "PENDING_QC");
    assert.ok(qc, `expected PENDING_QC, got ${a.blockers.map((b) => b.code).join(",")}`);
    assert.match(qc.message, /2 Work Orders pending QC/);
    assert.ok(!a.blockers.some((b) => b.code === "PENDING_PRODUCTION"));
  });

  it("evaluates close gates in WO → Production → QC → FG → Dispatch → Bill order", async () => {
    const db = makeClosureDb({
      activeCycle: { id: 10, cycleNo: 1 },
      lockedRs: {
        id: 1,
        lines: [{ itemId: 501, requirementQty: 10, suggestedWoQtySnapshot: 10, item: { id: 501, itemName: "FG" } }],
      },
      woCount: 0,
      unlockedDispatchCount: 1,
      draftBillCount: 1,
    });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.blockers[0]?.code, "WO_PENDING");
  });

  it("names exact draft dispatch and unexported sales bill records", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      unlockedDispatches: [{ id: 26, docNo: "D-26-0008" }],
      unexportedBills: [{ id: 3, billNo: null, docNo: "SB-26-0003" }],
    });
    const a = await assessNoQtySoClosure(db, 1);
    const draft = a.blockers.find((b) => b.code === "DRAFT_DISPATCH_EXISTS");
    const exportBlock = a.blockers.find((b) => b.code === "BILLING_NOT_EXPORTED");
    assert.ok(draft);
    assert.match(draft.message, /D-26-0008/);
    assert.ok(exportBlock);
    assert.match(exportBlock.message, /SB-26-0003/);
  });

  it("names exact remaining dispatch vs locked RS (not generic outstanding dependency)", async () => {
    const db = makeClosureDb({
      activeCycle: { id: 10, cycleNo: 2 },
      lockedRs: {
        id: 55,
        docNo: "RS-26-0005",
        lines: [
          {
            itemId: 501,
            requirementQty: 100,
            suggestedWoQtySnapshot: 100,
            item: { id: 501, itemName: "Round Plate" },
          },
        ],
      },
      woCount: 1,
      lockedDispatch: [
        {
          id: 1,
          docNo: "D-26-0001",
          itemId: 501,
          dispatchedQty: 40,
          reversalOfId: null,
          workflowStatus: "LOCKED",
        },
      ],
    });
    const a = await assessNoQtySoClosure(db, 1);
    const pend = a.blockers.find((b) => b.code === "PENDING_DISPATCH");
    assert.ok(pend, `expected PENDING_DISPATCH, got ${a.blockers.map((b) => b.code).join(",")}`);
    assert.match(pend.message, /Round Plate|RS-26-0005|undispatched/i);
    assert.doesNotMatch(pend.message, /^Cannot close SO: outstanding dispatch dependency\.$/);
  });

  it("does not block WO_PENDING when locked RS has empty cycle cap (decision-only)", async () => {
    const db = makeClosureDb({
      activeCycle: { id: 10, cycleNo: 3 },
      lockedRs: {
        id: 55,
        docNo: "RS-26-0009",
        lines: [],
      },
      woCount: 0,
    });
    const a = await assessNoQtySoClosure(db, 1);
    assert.ok(!a.blockers.some((b) => b.code === "WO_PENDING"), a.blockers.map((b) => b.code).join(","));
  });

  it("blocks when accepted FG pending disposition", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      cycles: [{ id: 10, cycleNo: 1 }],
      workOrders: [{ id: 5 }],
      items: [{ id: 501, itemName: "HDPE Cap", unit: "Nos", itemCode: "FG-001" }],
      qcEntries: [
        {
          acceptedQty: "100",
          production: {
            id: 77,
            docNo: "PE-26-0003",
            workOrderLine: {
              fgItemId: 501,
              workOrder: {
                id: 5,
                docNo: "WO-26-0003",
                cycleId: 10,
                cycle: { id: 10, cycleNo: 1 },
              },
            },
          },
        },
      ],
      lockedDispatch: [],
    });
    const a = await assessNoQtySoClosure(db, 1);
    assert.equal(a.mode, CLOSURE_MODES.BLOCKED);
    assert.ok(a.blockers.some((b) => b.code === "FG_DISPOSITION_REQUIRED"));
    const fg = (a.itemSummaries || []).find((s) => s.itemId === 501);
    assert.ok(fg);
    assert.equal(fg.itemName, "HDPE Cap");
    assert.equal(fg.itemCode, "FG-001");
    assert.equal(fg.unit, "Nos");
    assert.equal(fg.quantity, 100);
    assert.equal(fg.acceptedFgPendingDispositionQty, 100);
    assert.equal(fg.identityResolved, true);
    assert.equal(fg.workOrderNumber, "WO-26-0003");
    assert.equal(fg.productionBatchNumber, "PE-26-0003");
    assert.equal(fg.cycleReference, "Cycle 1");
    const serialized = JSON.stringify(a.itemSummaries);
    assert.equal(serialized.includes("Item ID"), false);
    assert.equal(serialized.includes("Item #"), false);
  });

  it("marks FG pending as unknown when item master cannot be resolved", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      cycles: [{ id: 10, cycleNo: 1 }],
      workOrders: [{ id: 5 }],
      items: [],
      qcEntries: [
        {
          acceptedQty: "187",
          production: {
            id: 88,
            docNo: "PE-26-0096",
            workOrderLine: {
              fgItemId: 96,
              workOrder: { id: 5, docNo: "WO-26-0003", cycle: { cycleNo: 2 } },
            },
          },
        },
      ],
      lockedDispatch: [],
    });
    const a = await assessNoQtySoClosure(db, 1);
    const fg = (a.itemSummaries || []).find((s) => s.itemId === 96);
    assert.ok(fg);
    assert.equal(fg.identityResolved, false);
    assert.equal(fg.itemName, null);
    assert.equal(fg.quantity, 187);
    assert.equal(fg.workOrderNumber, "WO-26-0003");
  });
});

describe("Batch 3D FG disposition", () => {
  it("records disposition and clears FG blocker", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      cycles: [{ id: 10, cycleNo: 1 }],
      workOrders: [{ id: 5 }],
      items: [{ id: 501, itemName: "FG Cap", unit: "Nos" }],
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

  it("blocks transfer to general stock when item identity is unresolved", async () => {
    const db = makeClosureDb({
      activeCycle: null,
      cycles: [{ id: 10, cycleNo: 1 }],
      workOrders: [{ id: 5 }],
      items: [],
      qcEntries: [
        {
          acceptedQty: "10",
          production: { workOrderLine: { fgItemId: 96 } },
        },
      ],
      lockedDispatch: [],
    });
    await assert.rejects(
      () =>
        recordAcceptedFgDisposition(db, {
          salesOrderId: 1,
          itemId: 96,
          qty: 10,
          dispositionType: "TRANSFER_TO_GENERAL_STOCK",
        }),
      (err) => err.code === "FG_ITEM_IDENTITY_UNRESOLVED",
    );
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
