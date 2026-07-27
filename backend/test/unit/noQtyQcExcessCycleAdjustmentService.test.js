/**
 * NO_QTY QC excess → active-cycle adjustment ledger (pure + mocked persistence).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  APPLICATION_MODE,
  computeQcExcessDecisionDelta,
  applyCarriedAcceptedExcessCredit,
  planQcExcessAdjustmentConsumption,
  sumOverlayAcceptedExcessCreditsByItem,
  buildQcEntryConsumptionKey,
  recordNoQtyQcExcessDecision,
  consumeUnappliedNoQtyQcExcessAdjustmentsForCycle,
  loadNoQtyQcExcessOverlayCreditsByItem,
} = require("../../src/services/noQtyQcExcessCycleAdjustmentService");
const {
  computeWoLineProducedExcessSplit,
  computeProductionShortageRecoveryOffset,
  assertNoProducedExcessPendingQcForRecoveryOrThrow,
} = require("../../src/services/noQtyProductionExcessRecoveryService");

function memoryDb(seed = {}) {
  const state = {
    orderType: seed.orderType ?? "NO_QTY",
    activeCycleId: Object.prototype.hasOwnProperty.call(seed, "activeCycleId")
      ? seed.activeCycleId
      : 2,
    lockedRsOnActive: Boolean(seed.lockedRsOnActive),
    adjustments: [...(seed.adjustments || [])],
    nextId: 1,
  };
  return {
    state,
    salesOrder: {
      findUnique: async ({ where }) =>
        where.id ? { orderType: state.orderType, currentCycleId: state.activeCycleId } : null,
    },
    salesOrderCycle: {
      findFirst: async ({ where }) => {
        if (where?.status === "ACTIVE" && state.activeCycleId != null) {
          return { id: state.activeCycleId };
        }
        return null;
      },
    },
    requirementSheet: {
      findFirst: async () => (state.lockedRsOnActive ? { id: 99 } : null),
    },
    noQtyQcExcessCycleAdjustment: {
      findUnique: async ({ where }) =>
        state.adjustments.find((r) => r.consumptionKey === where.consumptionKey) || null,
      findMany: async ({ where } = {}) => {
        return state.adjustments.filter((r) => {
          if (where?.salesOrderId != null && r.salesOrderId !== where.salesOrderId) return false;
          if (where?.applicationMode != null && r.applicationMode !== where.applicationMode) return false;
          if (where?.appliedCycleId === null && r.appliedCycleId != null) return false;
          if (where?.appliedCycleId != null && where.appliedCycleId !== null && r.appliedCycleId !== where.appliedCycleId)
            return false;
          return true;
        });
      },
      create: async ({ data }) => {
        const row = {
          id: state.nextId++,
          ...data,
          acceptedExcessDeltaQty: Number(data.acceptedExcessDeltaQty),
          rejectedSurplusDeltaQty: Number(data.rejectedSurplusDeltaQty),
        };
        state.adjustments.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const r of state.adjustments) {
          if (where.id?.in && !where.id.in.includes(r.id)) continue;
          if (where.applicationMode && r.applicationMode !== where.applicationMode) continue;
          if (where.appliedCycleId === null && r.appliedCycleId != null) continue;
          Object.assign(r, data);
          count += 1;
        }
        return { count };
      },
    },
  };
}

describe("finalize with pending QC — confirmed only, never blocked", () => {
  it("allows finalize while excess is Pending QC (confirmed stays 67)", async () => {
    const r = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 10,
      acceptedWoExcessQty: 0,
    });
    assert.equal(r.confirmedNetRecoveryQty, 67);
    assert.equal(r.provisionalNetRecoveryQty, 57);
    assert.equal(r.finalizeBlocked, false);
    assert.equal(r.finalizeBlockMessage, null);

    const gate = await assertNoProducedExcessPendingQcForRecoveryOrThrow({}, {
      salesOrderId: 1,
      targetCycleId: 2,
      recoveryByItem: new Map([[10, { productionShortfallQty: 67 }]]),
    });
    assert.equal(gate.ok, true);
  });
});

describe("QC accepted after next cycle is active", () => {
  it("posts accepted WO excess as OVERLAY onto locked active cycle", async () => {
    const db = memoryDb({ activeCycleId: 2, lockedRsOnActive: true });
    const before = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2010,
      acceptedQty: 2000,
      rejectedQty: 0,
    });
    const after = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2010,
      acceptedQty: 2010,
      rejectedQty: 0,
    });
    const delta = computeQcExcessDecisionDelta(before, after);
    assert.equal(delta.acceptedExcessDeltaQty, 10);

    const result = await recordNoQtyQcExcessDecision(db, {
      salesOrderId: 1,
      itemId: 10,
      sourceCycleId: 1,
      qcEntryId: 501,
      plannedQty: 2000,
      producedQty: 2010,
      acceptedQtyBefore: 2000,
      rejectedQtyBefore: 0,
      acceptedQtyAfter: 2010,
      rejectedQtyAfter: 0,
    });
    assert.equal(result.recorded, true);
    assert.equal(result.applicationMode, APPLICATION_MODE.OVERLAY);
    assert.equal(result.appliedCycleId, 2);

    const credits = await loadNoQtyQcExcessOverlayCreditsByItem(db, { salesOrderId: 1, cycleId: 2 });
    assert.equal(credits.get(10), 10);

    const overlay = applyCarriedAcceptedExcessCredit({
      lockedProductionRequirementQty: 67,
      carriedAcceptedExcessCreditQty: credits.get(10),
    });
    assert.equal(overlay.effectiveProductionRequirementQty, 57);
  });
});

describe("partial acceptance / rejection", () => {
  it("6 accepted / 4 rejected surplus → credit 6; reject does not create recovery", () => {
    const before = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2010,
      acceptedQty: 2000,
      rejectedQty: 0,
    });
    const after = computeWoLineProducedExcessSplit({
      plannedQty: 2000,
      producedQty: 2010,
      acceptedQty: 2006,
      rejectedQty: 4,
    });
    const delta = computeQcExcessDecisionDelta(before, after);
    assert.equal(delta.acceptedExcessDeltaQty, 6);
    assert.equal(delta.rejectedSurplusDeltaQty, 4);

    const recovery = computeProductionShortageRecoveryOffset({
      grossProductionShortageQty: 67,
      acceptedWoExcessQty: 6,
      rejectedWoExcessQty: 4,
      keptFinalQcRejectionQty: 4,
    });
    assert.equal(recovery.demandBackedQcRejectionQty, 0);
    assert.equal(recovery.confirmedNetRecoveryQty, 61);
  });
});

describe("QC decided before a new cycle exists", () => {
  it("stores UNAPPLIED and consumes once when next cycle is created", async () => {
    const db = memoryDb({ activeCycleId: null });
    const first = await recordNoQtyQcExcessDecision(db, {
      salesOrderId: 1,
      itemId: 10,
      sourceCycleId: 1,
      qcEntryId: 700,
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQtyBefore: 2000,
      rejectedQtyBefore: 0,
      acceptedQtyAfter: 2005,
      rejectedQtyAfter: 0,
    });
    assert.equal(first.recorded, true);
    assert.equal(first.applicationMode, APPLICATION_MODE.UNAPPLIED);
    assert.equal(first.appliedCycleId, null);

    db.state.activeCycleId = 3;
    const consumed = await consumeUnappliedNoQtyQcExcessAdjustmentsForCycle(db, {
      salesOrderId: 1,
      cycleId: 3,
    });
    assert.equal(consumed.consumed, 1);
    assert.equal(consumed.rows[0].applicationMode, APPLICATION_MODE.LIVE);
    assert.equal(Number(consumed.rows[0].appliedCycleId), 3);

    const again = await consumeUnappliedNoQtyQcExcessAdjustmentsForCycle(db, {
      salesOrderId: 1,
      cycleId: 3,
    });
    assert.equal(again.consumed, 0);
  });
});

describe("one-time consumption and repeated recalculation", () => {
  it("same consumptionKey is ignored on recalculation", () => {
    const existing = [
      {
        consumptionKey: buildQcEntryConsumptionKey(42),
        acceptedExcessDeltaQty: 10,
        appliedCycleId: 2,
        applicationMode: APPLICATION_MODE.OVERLAY,
        itemId: 10,
      },
    ];
    const plan = planQcExcessAdjustmentConsumption(
      existing,
      [
        { consumptionKey: buildQcEntryConsumptionKey(42), acceptedExcessDeltaQty: 10 },
        { consumptionKey: buildQcEntryConsumptionKey(43), acceptedExcessDeltaQty: 5 },
      ],
      { activeCycleId: 2, applicationMode: APPLICATION_MODE.OVERLAY },
    );
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.toInsert[0].consumptionKey, buildQcEntryConsumptionKey(43));

    const sumA = sumOverlayAcceptedExcessCreditsByItem(
      [...existing, ...plan.toInsert.map((r) => ({ ...r, itemId: 10 }))],
      2,
    );
    const sumB = sumOverlayAcceptedExcessCreditsByItem(
      [...existing, ...plan.toInsert.map((r) => ({ ...r, itemId: 10 }))],
      2,
    );
    assert.deepEqual(sumA, sumB);
    assert.equal(sumA.get(10), 15);
  });

  it("recordNoQtyQcExcessDecision is idempotent for the same qcEntryId", async () => {
    const db = memoryDb({ activeCycleId: 2, lockedRsOnActive: true });
    const input = {
      salesOrderId: 1,
      itemId: 10,
      sourceCycleId: 1,
      qcEntryId: 88,
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQtyBefore: 2000,
      rejectedQtyBefore: 0,
      acceptedQtyAfter: 2005,
      rejectedQtyAfter: 0,
    };
    const a = await recordNoQtyQcExcessDecision(db, input);
    const b = await recordNoQtyQcExcessDecision(db, input);
    assert.equal(a.recorded, true);
    assert.equal(b.recorded, false);
    assert.equal(b.reason, "ALREADY_CONSUMED");
    assert.equal(db.state.adjustments.length, 1);
  });
});

describe("multiple active/history cycles", () => {
  it("overlay credits are scoped to the applied cycle only", () => {
    const rows = [
      { itemId: 10, acceptedExcessDeltaQty: 10, appliedCycleId: 2, applicationMode: APPLICATION_MODE.OVERLAY },
      { itemId: 10, acceptedExcessDeltaQty: 7, appliedCycleId: 3, applicationMode: APPLICATION_MODE.OVERLAY },
      { itemId: 10, acceptedExcessDeltaQty: 4, appliedCycleId: 2, applicationMode: APPLICATION_MODE.LIVE },
    ];
    assert.equal(sumOverlayAcceptedExcessCreditsByItem(rows, 2).get(10), 10);
    assert.equal(sumOverlayAcceptedExcessCreditsByItem(rows, 3).get(10), 7);
    assert.equal(sumOverlayAcceptedExcessCreditsByItem(rows, 1).size, 0);
  });
});

describe("Regular SO isolation", () => {
  it("does not record adjustments for REGULAR / NORMAL orders", async () => {
    const db = memoryDb({ orderType: "NORMAL", activeCycleId: 2, lockedRsOnActive: true });
    const result = await recordNoQtyQcExcessDecision(db, {
      salesOrderId: 1,
      itemId: 10,
      sourceCycleId: 1,
      qcEntryId: 900,
      plannedQty: 2000,
      producedQty: 2005,
      acceptedQtyBefore: 2000,
      rejectedQtyBefore: 0,
      acceptedQtyAfter: 2005,
      rejectedQtyAfter: 0,
    });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, "NOT_NO_QTY");
    assert.equal(db.state.adjustments.length, 0);
  });
});
