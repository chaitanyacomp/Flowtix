/**
 * Decision-only / Recovery-only cycle eligibility + zero-fulfillment lock path.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assessDecisionOnlyRecoveryCycleEligibility,
} = require("../../src/services/noQtyRsRecoveryDecisionService");
const { closeDecisionOnlyNoQtyCycle } = require("../../src/services/noQtyCycleAutoClose");

function makeDb(overrides = {}) {
  const decisions = overrides.decisions || [];
  const lines = overrides.lines || [
    { id: 1, itemId: 501, baseDemandQty: "0", requirementQty: "0", totalRsQty: "0", suggestedWoQtySnapshot: "0" },
  ];
  const sheet = {
    id: 10,
    status: "DRAFT",
    salesOrderId: 1,
    cycleId: 3,
    lines,
    ...(overrides.sheet || {}),
  };
  return {
    requirementSheet: {
      findUnique: async () => ({ ...sheet, lines }),
      findFirst: async () => overrides.lockedSheet || { ...sheet, status: "LOCKED", lines },
    },
    noQtyRsItemRecoveryDecision: {
      findMany: async () => decisions,
    },
    workOrder: {
      count: async () => overrides.woCount ?? 0,
      findMany: async () => [],
    },
    productionEntry: { findMany: async () => [], groupBy: async () => [] },
    qcRejectedDisposition: { count: async () => 0 },
    salesOrder: {
      findUnique: async () =>
        overrides.so || {
          id: 1,
          orderType: "NO_QTY",
          internalStatus: "IN_PROCESS",
          currentCycleId: 3,
        },
      update: async ({ data }) => {
        if (overrides.so) Object.assign(overrides.so, data);
        return overrides.so;
      },
    },
    salesOrderCycle: {
      findFirst: async () => overrides.cycle || { id: 3, status: "ACTIVE" },
      updateMany: async ({ data }) => {
        if (overrides.cycle) Object.assign(overrides.cycle, data);
        return { count: 1 };
      },
    },
    carryForwardPending: { findMany: async () => [] },
    _syncCalled: false,
  };
}

describe("assessDecisionOnlyRecoveryCycleEligibility", () => {
  it("eligible when all WAIVE, zero demand/produce, no WO", async () => {
    const db = makeDb({
      decisions: [
        { status: "WAIVED", pendingRecoveryQty: "6" },
      ],
    });
    // skip sync by providing skipPendingSync — but assess still calls sync for DRAFT unless skip
    // Patch sync via requiring skipPendingSync true
    const r = await assessDecisionOnlyRecoveryCycleEligibility(db, {
      requirementSheetId: 10,
      lines: db.requirementSheet.findUnique ? undefined : undefined,
      skipPendingSync: true,
    });
    // Need to stub sync - when skipPendingSync true, no sync. findUnique returns sheet with lines.
    assert.equal(r.eligible, true, r.reason);
    assert.equal(r.decidedCount, 1);
  });

  it("not eligible while PENDING recovery remains", async () => {
    const db = makeDb({
      decisions: [
        { status: "PENDING", pendingRecoveryQty: "6" },
      ],
    });
    const r = await assessDecisionOnlyRecoveryCycleEligibility(db, {
      requirementSheetId: 10,
      skipPendingSync: true,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "RECOVERY_DECISION_PENDING");
  });

  it("not eligible when positive base demand", async () => {
    const db = makeDb({
      lines: [
        { baseDemandQty: "10", requirementQty: "10", totalRsQty: "10", suggestedWoQtySnapshot: "10" },
      ],
      decisions: [{ status: "WAIVED", pendingRecoveryQty: "0" }],
    });
    const r = await assessDecisionOnlyRecoveryCycleEligibility(db, {
      requirementSheetId: 10,
      lines: [
        { baseDemandQty: "10", requirementQty: "10", totalRsQty: "10", suggestedWoQtySnapshot: "10" },
      ],
      skipPendingSync: true,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "POSITIVE_BASE_DEMAND");
  });

  it("not eligible without any KEEP/WAIVE decisions", async () => {
    const db = makeDb({ decisions: [] });
    const r = await assessDecisionOnlyRecoveryCycleEligibility(db, {
      requirementSheetId: 10,
      skipPendingSync: true,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "NO_RECOVERY_DECISIONS");
  });
});

describe("closeDecisionOnlyNoQtyCycle", () => {
  it("closes ACTIVE cycle when locked RS has empty cap and no WO", async () => {
    const so = { id: 1, orderType: "NO_QTY", internalStatus: "IN_PROCESS", currentCycleId: 3 };
    const cycle = { id: 3, status: "ACTIVE" };
    const db = makeDb({ so, cycle, woCount: 0 });
    const r = await closeDecisionOnlyNoQtyCycle(db, {
      soId: 1,
      cycleId: 3,
      requirementSheetId: 10,
    });
    assert.equal(r.closed, true, r.reason);
    assert.equal(cycle.status, "CLOSED");
    assert.equal(so.currentCycleId, null);
  });

  it("refuses when RS still has positive cap", async () => {
    const db = makeDb({
      lockedSheet: {
        id: 10,
        status: "LOCKED",
        lines: [{ suggestedWoQtySnapshot: "6", requirementQty: "0", totalRsQty: "6" }],
      },
    });
    const r = await closeDecisionOnlyNoQtyCycle(db, { soId: 1, cycleId: 3, requirementSheetId: 10 });
    assert.equal(r.closed, false);
    assert.equal(r.reason, "NON_EMPTY_CYCLE_CAP");
  });
});
