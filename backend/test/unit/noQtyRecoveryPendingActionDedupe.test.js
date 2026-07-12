/**
 * Regression: Store must not see duplicate next-RS guidance.
 * "Create Cycle N Requirement Sheet" is the single Store-owned action;
 * production shortfall / QC recovery remain carry-forward data, not separate PAs
 * when next RS creation already covers them.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldSuppressRecoveryPendingAction,
  fetchNoQtyRecoveryPendingActions,
  sumRequirementSheetComponentTotals,
} = require("../../src/services/noQtyRecoveryAnalyticsService");
const { computeAvailableQty } = require("../../src/services/noQtyRecoveryService");

function makeSource(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    salesOrderId: overrides.salesOrderId ?? 10,
    itemId: overrides.itemId ?? 501,
    recoveryType: overrides.recoveryType ?? "PRODUCTION_SHORTFALL",
    recoveryStatus: overrides.recoveryStatus ?? "OPEN",
    sourceQty: overrides.sourceQty ?? "100",
    waivedQty: overrides.waivedQty ?? "0",
    sourceDocumentType: overrides.sourceDocumentType ?? "WORK_ORDER",
    sourceDocumentId: overrides.sourceDocumentId ?? 77,
    cycleId: overrides.cycleId ?? 3,
    createdAt: overrides.createdAt ?? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    migrationIncomplete: false,
    allocations: overrides.allocations ?? [],
    item: overrides.item ?? { id: 501, itemName: "FG-A", unit: "Kg" },
  };
}

function coverage(createNextRsEligible, nextRsDraftExists = false) {
  return new Map([
    [
      10,
      {
        covered: createNextRsEligible || nextRsDraftExists,
        createNextRsEligible,
        nextRsDraftExists,
        reason: createNextRsEligible
          ? "CREATE_NEXT_RS_PENDING"
          : nextRsDraftExists
            ? "NEXT_RS_DRAFT_EXISTS"
            : null,
      },
    ],
  ]);
}

function makeDb({ sources = [], openSos = null } = {}) {
  const sos = openSos || [{ id: 10, docNo: "SO-26-0001", internalStatus: "OPEN", currentCycleId: null }];
  const db = {
    salesOrder: {
      findMany: async ({ where }) => {
        if (where?.internalStatus?.in) return sos;
        if (where?.id?.in) {
          return sos
            .filter((s) => where.id.in.includes(s.id))
            .map((s) => ({ id: s.id, internalStatus: s.internalStatus, orderType: "NO_QTY" }));
        }
        return sos;
      },
      findUnique: async ({ where }) => {
        const so = sos.find((s) => s.id === where.id);
        if (!so) return null;
        return { id: so.id, orderType: "NO_QTY", internalStatus: so.internalStatus, docNo: so.docNo };
      },
      count: async () => 0,
    },
    carryForwardPending: {
      findMany: async ({ where }) => {
        let rows = sources;
        if (where?.salesOrderId?.in) {
          rows = rows.filter((s) => where.salesOrderId.in.includes(s.salesOrderId));
        }
        return rows.map((r) => ({
          ...r,
          salesOrder: sos.find((s) => s.id === r.salesOrderId) || {
            id: r.salesOrderId,
            docNo: `SO-${r.salesOrderId}`,
            internalStatus: "OPEN",
          },
          allocations: (r.allocations || []).map((a) => ({
            ...a,
            requirementSheet: a.requirementSheet || null,
          })),
        }));
      },
    },
    noQtySoWaiver: { findMany: async () => [] },
    workOrder: { findMany: async () => [], count: async () => 0 },
    productionEntry: { findMany: async () => [], groupBy: async () => [] },
    qcEntry: { findMany: async () => [] },
    qcRejectedDisposition: { count: async () => 0 },
    dispatch: { count: async () => 0, findMany: async () => [] },
    requirementSheet: { count: async () => 0, findFirst: async () => null, findMany: async () => [] },
    productionMaterialRequest: { findFirst: async () => null },
    salesBill: { count: async () => 0 },
    salesOrderCycle: { findFirst: async () => null, findMany: async () => [] },
    noQtyAcceptedFgDisposition: { findMany: async () => [] },
  };
  return db;
}

describe("shouldSuppressRecoveryPendingAction", () => {
  it("suppresses production shortfall when create-next-RS is pending", () => {
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "PRODUCTION_SHORTFALL",
        createNextRsEligible: true,
      }),
      true,
    );
  });

  it("suppresses QC recovery when create-next-RS is pending", () => {
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "QC_FINAL_REJECTION",
        createNextRsEligible: true,
      }),
      true,
    );
  });

  it("suppresses when next RS draft already exists", () => {
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "PRODUCTION_SHORTFALL",
        createNextRsEligible: false,
        nextRsDraftExists: true,
      }),
      true,
    );
  });

  it("does not suppress when neither next-RS path covers carry-forward", () => {
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "PRODUCTION_SHORTFALL",
        createNextRsEligible: false,
        nextRsDraftExists: false,
      }),
      false,
    );
  });
});

describe("fetchNoQtyRecoveryPendingActions — next-RS single Store obligation", () => {
  it("short production only: suppresses shortfall PA when Create Cycle RS is pending", async () => {
    const db = makeDb({
      sources: [makeSource({ id: 1, recoveryType: "PRODUCTION_SHORTFALL", sourceQty: "40" })],
    });
    const withCover = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(true),
    });
    assert.equal(withCover.filter((a) => a.reason === "PRODUCTION_SHORTFALL_AVAILABLE").length, 0);

    const withoutCover = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(false),
    });
    assert.equal(withoutCover.filter((a) => a.reason === "PRODUCTION_SHORTFALL_AVAILABLE").length, 1);
    assert.equal(withoutCover[0].action, "Production shortfall awaiting next RS");
  });

  it("QC rejection only: suppresses QC PA when Create Cycle RS is pending", async () => {
    const db = makeDb({
      sources: [
        makeSource({
          id: 2,
          recoveryType: "QC_FINAL_REJECTION",
          sourceQty: "15",
          sourceDocumentType: "QC_ENTRY",
        }),
      ],
    });
    const withCover = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(true),
    });
    assert.equal(withCover.filter((a) => a.reason === "QC_RECOVERY_AVAILABLE").length, 0);

    const withoutCover = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(false),
    });
    assert.equal(withoutCover.filter((a) => a.reason === "QC_RECOVERY_AVAILABLE").length, 1);
  });

  it("both shortage and QC rejection: suppresses both when next RS pending", async () => {
    const db = makeDb({
      sources: [
        makeSource({ id: 1, recoveryType: "PRODUCTION_SHORTFALL", sourceQty: "25" }),
        makeSource({
          id: 2,
          recoveryType: "QC_FINAL_REJECTION",
          sourceQty: "10",
          sourceDocumentType: "QC_ENTRY",
        }),
      ],
    });
    const actions = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(true),
    });
    assert.equal(
      actions.filter((a) =>
        ["PRODUCTION_SHORTFALL_AVAILABLE", "QC_RECOVERY_AVAILABLE"].includes(a.reason),
      ).length,
      0,
    );
  });

  it("no carry-forward: emits no recovery inbox rows", async () => {
    const db = makeDb({ sources: [] });
    const actions = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(true),
    });
    assert.equal(actions.filter((a) => String(a.id).startsWith("noqty-recovery:")).length, 0);
  });

  it("next RS already created (draft): suppresses shortfall PA", async () => {
    const db = makeDb({
      sources: [makeSource({ id: 1, recoveryType: "PRODUCTION_SHORTFALL", sourceQty: "18" })],
    });
    const actions = await fetchNoQtyRecoveryPendingActions(db, {
      role: "STORE",
      coverageBySoId: coverage(false, true),
    });
    assert.equal(actions.filter((a) => a.reason === "PRODUCTION_SHORTFALL_AVAILABLE").length, 0);
  });

  it("closed SO: open loader empty → no recovery PAs", async () => {
    const db = makeDb({
      openSos: [],
      sources: [makeSource({ id: 1, sourceQty: "50" })],
    });
    const actions = await fetchNoQtyRecoveryPendingActions(db, { role: "STORE" });
    assert.equal(actions.length, 0);
  });

  it("does not weaken carry-forward quantities or RS component totals", () => {
    const src = makeSource({ sourceQty: "100", waivedQty: "10" });
    const allocs = [{ status: "RESERVED", allocatedQty: "20" }];
    assert.equal(computeAvailableQty(src, allocs), 70);

    const comps = sumRequirementSheetComponentTotals({
      lines: [
        {
          baseDemandQty: 50,
          productionShortfallQty: 40,
          qcRejectionRecoveryQty: 15,
          approvedManualAdjustmentQty: 0,
          totalRsQty: 105,
        },
      ],
    });
    assert.equal(comps.productionShortfallQty, 40);
    assert.equal(comps.qcRejectionRecoveryQty, 15);
    assert.equal(comps.totalRsQty, 105);
  });
});
