/**
 * Phase A — NO_QTY multi-WO workflow primary-action fix (ADR-2026-001).
 *
 * These tests exercise the REAL decision path of resolveNoQtyWorkflowState
 * (not just the roleAwareActionPayload helper mapping). They assert that an
 * active Work Order still requiring production keeps PRODUCTION as the primary
 * action and only demotes NEXT_RS to a parallel/secondary planning action —
 * while a terminal shortfall-closed WO does NOT keep the cycle in production.
 *
 * External dependencies with heavy sub-queries are monkey-patched on their
 * module objects and the engine module is re-required so it re-captures the
 * patched functions (same pattern as noQtyWorkflowEngine.test.js).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const ELIGIBILITY_PATH = "../../src/services/noQtyCreateNextRsEligibility";
const DISPATCH_PATH = "../../src/routes/dispatch";
const EXEC_PATH = "../../src/services/requirementSheetExecutionService";
const ENGINE_PATH = "../../src/services/noQtyWorkflowEngine";

const SO = 700;
const CYCLE = 9;

function makeDb({ workOrders, productionRows = [], prodAny = null, qcAny = null, disposition = 0 }) {
  const cycleRow = { id: CYCLE, cycleNo: 1, status: "ACTIVE", noQtyTreatFgAsOptionalStoreStock: false };
  return {
    salesOrder: {
      findUnique: async () => ({ id: SO, orderType: "NO_QTY", currentCycleId: CYCLE, internalStatus: "OPEN" }),
      findMany: async () => [],
    },
    salesOrderCycle: {
      findFirst: async () => cycleRow,
      findMany: async () => [],
    },
    requirementSheet: {
      findMany: async () => [{ id: 1, status: "LOCKED" }],
      findFirst: async () => ({ id: 1, status: "LOCKED" }),
      findUnique: async () => null,
    },
    workOrder: {
      findMany: async () => workOrders,
      findFirst: async () => (workOrders.length ? { id: workOrders[0].id } : null),
    },
    productionEntry: {
      findFirst: async () => prodAny,
      findMany: async () => productionRows,
    },
    qcEntry: { findFirst: async () => qcAny, findMany: async () => [] },
    dispatch: { findMany: async () => [] },
    salesBill: { findFirst: async () => null },
    qcRejectedDisposition: { count: async () => disposition },
  };
}

// Active QC entry shape consumed by reportMetrics helpers (reversedAt: null).
function resolvedQc(acceptedQty, rejectedQty = 0) {
  return { reversedAt: null, acceptedQty, rejectedQty };
}

async function runEngine(scenario, { createNextRsEligible = true } = {}) {
  const eligibility = require(ELIGIBILITY_PATH);
  const dispatch = require(DISPATCH_PATH);
  const exec = require(EXEC_PATH);
  const engineResolved = require.resolve(ENGINE_PATH);

  const origEligible = eligibility.computeNoQtyCreateNextRsEligibility;
  const origQcMap = dispatch.loadNoQtyCycleQcAcceptedMap;
  const origAssess = exec.assessNoQtyPlacementStageForCycle;

  eligibility.computeNoQtyCreateNextRsEligibility = async () => ({
    eligible: createNextRsEligible,
    existingNextRsDocNo: null,
    reason: createNextRsEligible ? null : "NOT_ELIGIBLE",
    blockingPmrDocNo: null,
    blockingPmrStatus: null,
  });
  // Force dispatchable pool to zero so dispatch never competes with the axis under test.
  dispatch.loadNoQtyCycleQcAcceptedMap = async () => new Map();
  exec.assessNoQtyPlacementStageForCycle = async () => ({
    readyToPlaceWo: false,
    processStageKey: null,
    processStageLabel: null,
    requirementSheetId: 1,
  });

  delete require.cache[engineResolved];
  const { resolveNoQtyWorkflowState } = require(ENGINE_PATH);

  try {
    return await resolveNoQtyWorkflowState(makeDb(scenario), {
      salesOrderId: SO,
      cycleId: CYCLE,
      userRole: "STORE",
    });
  } finally {
    eligibility.computeNoQtyCreateNextRsEligibility = origEligible;
    dispatch.loadNoQtyCycleQcAcceptedMap = origQcMap;
    exec.assessNoQtyPlacementStageForCycle = origAssess;
    delete require.cache[engineResolved];
  }
}

describe("resolveNoQtyWorkflowState — NO_QTY multi-WO primary action (ADR-2026-001 Phase A)", () => {
  it("Test 1 — active WO remains: PRODUCTION primary, NEXT_RS secondary, never NEXT_RS_READY", async () => {
    const state = await runEngine({
      workOrders: [
        { id: 1, status: "COMPLETED", lines: [{ plannedQty: 10000, qty: 10000 }] },
        { id: 2, status: "IN_PROGRESS", lines: [{ plannedQty: 10000, qty: 10000 }] },
      ],
      productionRows: [
        { producedQty: 9878, qcEntries: [resolvedQc(9878)], workOrderLine: { plannedQty: 10000, qty: 10000, workOrderId: 1 } },
      ],
      prodAny: { id: 1 },
      qcAny: { id: 1 },
    });

    assert.equal(state.primaryAction, "PRODUCTION");
    assert.equal(state.overallWorkflowState, "PRODUCTION_REQUIRED");
    assert.ok(state.secondaryActions.includes("NEXT_RS"), "NEXT_RS must remain a secondary action");
    assert.notEqual(state.overallWorkflowState, "NEXT_RS_READY");
    assert.equal(state.activeWoProductionPending, true);
  });

  it("Test 2 — active WO partially produced: PRODUCTION primary, remaining active = 6000, NEXT_RS secondary", async () => {
    const state = await runEngine({
      workOrders: [
        { id: 1, status: "CLOSED_WITH_SHORTFALL", lines: [{ plannedQty: 10000, qty: 10000 }] },
        { id: 2, status: "IN_PROGRESS", lines: [{ plannedQty: 10000, qty: 10000 }] },
      ],
      productionRows: [
        { producedQty: 9800, qcEntries: [resolvedQc(9800)], workOrderLine: { plannedQty: 10000, qty: 10000, workOrderId: 1 } },
        { producedQty: 4000, qcEntries: [resolvedQc(4000)], workOrderLine: { plannedQty: 10000, qty: 10000, workOrderId: 2 } },
      ],
      prodAny: { id: 1 },
      qcAny: { id: 1 },
    });

    assert.equal(state.primaryAction, "PRODUCTION");
    assert.equal(state.overallWorkflowState, "PRODUCTION_REQUIRED");
    assert.equal(state.activeProductionRemainingQty, 6000);
    assert.ok(state.secondaryActions.includes("NEXT_RS"), "NEXT_RS must remain a secondary action");
  });

  it("Test 3 — closed with shortfall only: not PRODUCTION, NEXT_RS remains valid", async () => {
    const state = await runEngine({
      workOrders: [{ id: 1, status: "CLOSED_WITH_SHORTFALL", lines: [{ plannedQty: 10000, qty: 10000 }] }],
      productionRows: [
        { producedQty: 9800, qcEntries: [resolvedQc(9800)], workOrderLine: { plannedQty: 10000, qty: 10000, workOrderId: 1 } },
      ],
      prodAny: { id: 1 },
      qcAny: { id: 1 },
    });

    assert.equal(state.activeWoProductionPending, false);
    assert.notEqual(state.primaryAction, "PRODUCTION");
    assert.equal(state.primaryAction, "NEXT_RS");
    assert.equal(state.overallWorkflowState, "NEXT_RS_READY");
  });

  it("Test 4 — QC pending outranks NEXT_RS when no active production remains", async () => {
    const state = await runEngine({
      workOrders: [{ id: 1, status: "COMPLETED", lines: [{ plannedQty: 5000, qty: 5000 }] }],
      productionRows: [
        // Produced but not yet QC'd → batch QC pending.
        { producedQty: 5000, qcEntries: [], workOrderLine: { plannedQty: 5000, qty: 5000, workOrderId: 1 } },
      ],
      prodAny: { id: 1 },
    });

    assert.equal(state.activeWoProductionPending, false);
    assert.equal(state.qcPendingForCycle, true);
    assert.equal(state.primaryAction, "QC");
    assert.equal(state.overallWorkflowState, "QC_PENDING");
    assert.notEqual(state.overallWorkflowState, "NEXT_RS_READY");
  });

  it("Test 5 — all WOs terminal, no QC pending: NEXT_RS_READY remains valid", async () => {
    const state = await runEngine({
      workOrders: [{ id: 1, status: "COMPLETED", lines: [{ plannedQty: 10000, qty: 10000 }] }],
      productionRows: [
        { producedQty: 10000, qcEntries: [resolvedQc(10000)], workOrderLine: { plannedQty: 10000, qty: 10000, workOrderId: 1 } },
      ],
      prodAny: { id: 1 },
      qcAny: { id: 1 },
    });

    assert.equal(state.activeWoProductionPending, false);
    assert.equal(state.qcPendingForCycle, false);
    assert.equal(state.primaryAction, "NEXT_RS");
    assert.equal(state.overallWorkflowState, "NEXT_RS_READY");
  });
});
