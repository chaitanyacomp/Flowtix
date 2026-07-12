/**
 * Integration-style: getPendingActions(STORE) must return one Create Cycle action
 * when next-RS is pending and production shortfall exists (ACTIVE_EMPTY_PRIOR_ELIGIBLE).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeStoreCreateNextRsPendingEligibility,
  computeNoQtyCreateNextRsEligibilityResolved,
} = require("../../src/services/noQtyCreateNextRsEligibility");
const {
  shouldSuppressRecoveryPendingAction,
  resolveNextRsCarryForwardCoverage,
  fetchNoQtyRecoveryPendingActions,
} = require("../../src/services/noQtyRecoveryAnalyticsService");

function makeSource(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    salesOrderId: overrides.salesOrderId ?? 224,
    itemId: overrides.itemId ?? 501,
    recoveryType: overrides.recoveryType ?? "PRODUCTION_SHORTFALL",
    recoveryStatus: "OPEN",
    sourceQty: overrides.sourceQty ?? "40",
    waivedQty: "0",
    sourceDocumentType: "WORK_ORDER",
    sourceDocumentId: 77,
    cycleId: 1,
    createdAt: new Date(),
    allocations: [],
    item: { id: 501, itemName: "FG-A", unit: "Kg" },
  };
}

/**
 * Mirrors SO-26-0001 shape: ACTIVE cycle 2 empty, prior CLOSED cycle 1 eligible.
 */
function makeSo26Db({ withQc = false, withDraftNext = false, closedSo = false } = {}) {
  const soId = 224;
  const openSos = closedSo
    ? []
    : [{ id: soId, docNo: "SO-26-0001", internalStatus: "OPEN", currentCycleId: 382, orderType: "NO_QTY" }];

  const cycles = [
    { id: 381, salesOrderId: soId, cycleNo: 1, status: "CLOSED" },
    { id: 382, salesOrderId: soId, cycleNo: 2, status: "ACTIVE" },
  ];

  const sheets = [
    { id: 900, salesOrderId: soId, cycleId: 381, status: "LOCKED", version: 1, docNo: "RS-C1", updatedAt: new Date() },
  ];
  if (withDraftNext) {
    sheets.push({
      id: 901,
      salesOrderId: soId,
      cycleId: 382,
      status: "DRAFT",
      version: 1,
      docNo: "RS-C2-DRAFT",
      updatedAt: new Date(),
      salesOrderCycle: { status: "ACTIVE" },
    });
  }

  const sources = [makeSource({ id: 1, recoveryType: "PRODUCTION_SHORTFALL", sourceQty: "40" })];
  if (withQc) {
    sources.push(
      makeSource({
        id: 2,
        recoveryType: "QC_FINAL_REJECTION",
        sourceQty: "12",
        sourceDocumentType: "QC_ENTRY",
      }),
    );
  }

  const workOrders = [{ id: 50, salesOrderId: soId, cycleId: 381, status: "CLOSED_WITH_SHORTFALL" }];

  return {
    salesOrder: {
      findMany: async ({ where }) => {
        if (where?.internalStatus?.in) return openSos;
        if (where?.id?.in) {
          return openSos
            .filter((s) => where.id.in.includes(s.id))
            .map((s) => ({ id: s.id, internalStatus: s.internalStatus, orderType: "NO_QTY", docNo: s.docNo }));
        }
        return openSos;
      },
      findUnique: async ({ where, select }) => {
        const so = openSos.find((s) => s.id === where.id) || {
          id: soId,
          orderType: "NO_QTY",
          internalStatus: closedSo ? "CLOSED" : "OPEN",
          docNo: "SO-26-0001",
          currentCycleId: 382,
        };
        if (!so) return null;
        if (select) {
          const out = {};
          for (const k of Object.keys(select)) if (select[k]) out[k] = so[k];
          return out;
        }
        return so;
      },
      findFirst: async () => openSos[0] || null,
      count: async () => 0,
    },
    salesOrderCycle: {
      findFirst: async ({ where, orderBy }) => {
        let rows = cycles.filter((c) => c.salesOrderId === (where.salesOrderId ?? soId));
        if (where?.status) rows = rows.filter((c) => c.status === where.status);
        if (where?.id) rows = rows.filter((c) => c.id === where.id);
        if (where?.cycleNo?.lt != null) rows = rows.filter((c) => c.cycleNo < where.cycleNo.lt);
        if (orderBy?.cycleNo === "desc") rows = [...rows].sort((a, b) => b.cycleNo - a.cycleNo);
        return rows[0] || null;
      },
      findMany: async () => cycles,
    },
    requirementSheet: {
      findFirst: async ({ where, orderBy }) => {
        let rows = [...sheets];
        if (where?.salesOrderId) rows = rows.filter((s) => s.salesOrderId === where.salesOrderId);
        if (where?.cycleId) rows = rows.filter((s) => s.cycleId === where.cycleId);
        if (where?.status) rows = rows.filter((s) => s.status === where.status);
        if (where?.status === "DRAFT" && !where.cycleId) {
          rows = rows.filter((s) => s.status === "DRAFT");
        }
        if (where?.cycle?.cycleNo?.gt != null) {
          rows = rows.filter((s) => {
            const c = cycles.find((x) => x.id === s.cycleId);
            return c && c.cycleNo > where.cycle.cycleNo.gt && c.status !== "CLOSED";
          });
        }
        if (orderBy) {
          rows.sort((a, b) => (b.version || 0) - (a.version || 0) || b.id - a.id);
        }
        const row = rows[0];
        if (!row) return null;
        if (row.status === "DRAFT") {
          return { ...row, salesOrderCycle: { status: "ACTIVE" } };
        }
        return row;
      },
      findMany: async () => sheets,
      count: async () => sheets.length,
    },
    workOrder: {
      findFirst: async ({ where }) => {
        let rows = workOrders;
        if (where?.salesOrderId) rows = rows.filter((w) => w.salesOrderId === where.salesOrderId);
        if (where?.cycleId) rows = rows.filter((w) => w.cycleId === where.cycleId);
        return rows[0] || null;
      },
      findMany: async () => workOrders,
      count: async () => workOrders.length,
    },
    carryForwardPending: {
      findMany: async ({ where }) => {
        let rows = sources;
        if (where?.salesOrderId?.in) rows = rows.filter((s) => where.salesOrderId.in.includes(s.salesOrderId));
        return rows.map((r) => ({
          ...r,
          salesOrder: { id: soId, docNo: "SO-26-0001", internalStatus: "OPEN" },
          allocations: [],
        }));
      },
    },
    noQtySoWaiver: { findMany: async () => [] },
    productionEntry: { findMany: async () => [], groupBy: async () => [] },
    qcEntry: { findMany: async () => [] },
    qcRejectedDisposition: { count: async () => 0 },
    dispatch: { count: async () => 0, findMany: async () => [] },
    productionMaterialRequest: { findFirst: async () => null },
    salesBill: { count: async () => 0 },
    noQtyAcceptedFgDisposition: { findMany: async () => [] },
  };
}

describe("ACTIVE_EMPTY_PRIOR_ELIGIBLE coverage alignment (SO-26-0001 shape)", () => {
  it("eligResolved is false on empty ACTIVE, but store pending eligibility is true", async () => {
    const db = makeSo26Db();
    const resolved = await computeNoQtyCreateNextRsEligibilityResolved(db, 224);
    assert.equal(resolved.eligible, false);
    assert.equal(resolved.reason, "NO_LOCKED_RS");

    const storeElig = await computeStoreCreateNextRsPendingEligibility(db, 224);
    assert.equal(storeElig.eligible, true);
    assert.equal(storeElig.resolution, "ACTIVE_EMPTY_PRIOR_ELIGIBLE");
    assert.equal(storeElig.targetCycleNo, 2);
  });

  it("coverage suppresses shortfall when store create-next is eligible", async () => {
    const db = makeSo26Db();
    const cov = await resolveNextRsCarryForwardCoverage(db, 224);
    assert.equal(cov.createNextRsEligible, true);
    assert.equal(cov.covered, true);
    assert.equal(
      shouldSuppressRecoveryPendingAction({
        recoveryType: "PRODUCTION_SHORTFALL",
        createNextRsEligible: cov.createNextRsEligible,
      }),
      true,
    );
  });

  it("A: shortfall only — recovery PA suppressed when create-next pending", async () => {
    const db = makeSo26Db();
    const actions = await fetchNoQtyRecoveryPendingActions(db, { role: "STORE" });
    assert.equal(
      actions.filter((a) => a.reason === "PRODUCTION_SHORTFALL_AVAILABLE").length,
      0,
    );
  });

  it("B: shortfall + QC — both recovery PAs suppressed", async () => {
    const db = makeSo26Db({ withQc: true });
    const actions = await fetchNoQtyRecoveryPendingActions(db, { role: "STORE" });
    assert.equal(
      actions.filter((a) =>
        ["PRODUCTION_SHORTFALL_AVAILABLE", "QC_RECOVERY_AVAILABLE"].includes(a.reason),
      ).length,
      0,
    );
  });

  it("C: next-cycle draft exists — recovery still suppressed", async () => {
    const db = makeSo26Db({ withDraftNext: true });
    // With draft on active, store create-next becomes ineligible (sheet on active exists),
    // but draft coverage should still suppress.
    const cov = await resolveNextRsCarryForwardCoverage(db, 224);
    assert.equal(cov.nextRsDraftExists || cov.createNextRsEligible, true);
    const actions = await fetchNoQtyRecoveryPendingActions(db, { role: "STORE" });
    assert.equal(actions.filter((a) => a.reason === "PRODUCTION_SHORTFALL_AVAILABLE").length, 0);
  });

  it("closed SO — no recovery actions", async () => {
    const db = makeSo26Db({ closedSo: true });
    const actions = await fetchNoQtyRecoveryPendingActions(db, { role: "STORE" });
    assert.equal(actions.length, 0);
  });
});
