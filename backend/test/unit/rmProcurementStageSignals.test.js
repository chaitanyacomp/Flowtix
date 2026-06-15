const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  WAITING_FOR_PURCHASE_RM_PO,
  PREPARE_RM_PO,
  deriveOperationalKeyFromCounts,
  summarizeProcurementStageFromTrace,
  summarizeProcurementStageFromMeta,
  resolveRmRiskStorePendingAction,
  resolveRmRiskPendingAction,
} = require("../../src/services/rmProcurementStageSignals");

describe("rmProcurementStageSignals", () => {
  it("derives PR_PENDING_PO when PR exists without PO", () => {
    const op = deriveOperationalKeyFromCounts({ prLineCount: 2, poLineCount: 0, pendingGrnQty: 0, hasOpenMr: true });
    assert.equal(op.operationalKey, "PR_PENDING_PO");
    assert.equal(op.nextActionKey, "CREATE_PO");
  });

  it("summarizes trace stage for MPRS MR with PR", () => {
    const stage = summarizeProcurementStageFromTrace(
      {
        prLines: [{ purchaseRequestLineId: 1 }],
        poLines: [],
        openMrLines: [{ sourceType: "MONTHLY_PLAN", materialRequirementId: 99 }],
      },
      "MONTHLY_PLAN",
    );
    assert.equal(stage.prLineCount, 1);
    assert.equal(stage.operationalKey, "PR_PENDING_PO");
    assert.equal(stage.procurementDemandPool, "MPRS");
  });

  it("before PR emits Create Purchase Request for Store", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 99,
        sourceType: "MONTHLY_PLAN",
        workOrderId: 1,
        prLineCount: 0,
        poLineCount: 0,
        operationalKey: "PROCUREMENT_PENDING",
        nextActionKey: "CREATE_PR",
        procurementDemandPool: "MPRS",
      },
      { queueType: "WAITING_PURCHASE_ACTION", freeStockQty: 0, netShortageAfterIncomingQty: 50 },
    );
    assert.equal(resolved.action, "Create Purchase Request");
    assert.match(resolved.href, /procurement-planning/);
    assert.match(resolved.href, /demandPool=MPRS/);
  });

  it("after PR with zero stock emits waiting for Purchase for Store", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 99,
        sourceType: "MONTHLY_PLAN",
        workOrderId: 1,
        prLineCount: 1,
        poLineCount: 0,
        operationalKey: "PR_PENDING_PO",
        nextActionKey: "CREATE_PO",
        procurementDemandPool: "MPRS",
      },
      { queueType: "WAITING_PURCHASE_ACTION", freeStockQty: 0, netShortageAfterIncomingQty: 50 },
    );
    assert.equal(resolved.action, WAITING_FOR_PURCHASE_RM_PO);
    assert.match(resolved.href, /procurement-planning/);
  });

  it("after PR emits Prepare RM PO for Purchase with MPRS href", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        materialRequirementId: 99,
        sourceType: "MONTHLY_PLAN",
        workOrderId: 1,
        prLineCount: 1,
        poLineCount: 0,
        operationalKey: "PR_PENDING_PO",
        nextActionKey: "CREATE_PO",
        procurementDemandPool: "MPRS",
      },
      { queueType: "WAITING_PURCHASE_ACTION", freeStockQty: 0, netShortageAfterIncomingQty: 50 },
      "PURCHASE",
    );
    assert.equal(resolved.action, PREPARE_RM_PO);
    assert.match(resolved.href, /demandPool=MPRS/);
    assert.match(resolved.href, /materialRequirementId=99/);
    assert.match(resolved.href, /returnTo=pending-actions/);
  });

  it("pendingGrnQty overrides stale PR_PENDING_PO metadata", () => {
    const stage = summarizeProcurementStageFromMeta({
      materialRequirementId: 99,
      prLineCount: 1,
      poLineCount: 1,
      pendingGrnQty: 40,
      operationalKey: "PR_PENDING_PO",
      nextActionKey: "CREATE_PO",
    });
    assert.equal(stage.operationalKey, "GRN_PENDING");
    assert.equal(stage.nextActionKey, "OPEN_GRN");

    const resolved = resolveRmRiskPendingAction(
      {
        materialRequirementId: 99,
        workOrderId: 1,
        prLineCount: 1,
        poLineCount: 1,
        pendingGrnQty: 40,
        operationalKey: "PR_PENDING_PO",
        primaryPoId: 112,
      },
      { queueType: "PO_WAITING_GRN" },
      "STORE",
    );
    assert.equal(resolved.action, "GRN Pending");
    assert.match(resolved.href, /\/rm-po-grn\/112/);
  });

  it("after PO before GRN emits GRN Pending for Store", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 99,
        workOrderId: 1,
        prLineCount: 1,
        poLineCount: 1,
        pendingGrnQty: 25,
        operationalKey: "GRN_PENDING",
        primaryPoId: 12,
      },
      { queueType: "PO_WAITING_GRN", freeStockQty: 0 },
    );
    assert.equal(resolved.action, "GRN Pending");
    assert.match(resolved.href, /rm-po-grn/);
  });

  it("after GRN with stock emits Material Issue Pending", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 99,
        workOrderId: 1,
        prLineCount: 1,
        poLineCount: 1,
        pendingGrnQty: 0,
      },
      { queueType: "RM_READY_FOR_ISSUE", freeStockQty: 100 },
    );
    assert.equal(resolved.action, "Material Issue Pending");
    assert.match(resolved.href, /material-issue/);
  });

  it("does not emit Create PR when MPRS procurement is completed", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 1,
        sourceType: "MONTHLY_PLAN",
        workOrderId: 1,
        prLineCount: 0,
        poLineCount: 0,
        pendingGrnQty: 0,
        procurementCompletedForCase: true,
        mrStatus: "FULLY_PROCURED",
        operationalKey: "PROCUREMENT_PENDING",
      },
      { queueType: "WO_BLOCKED_RM_SHORTAGE", freeStockQty: 0, netShortageAfterIncomingQty: 10 },
    );
    assert.notEqual(resolved.action, "Create Purchase Request");
  });

  it("PMR fully issued after completed procurement routes to Production", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 1,
        workOrderId: 1,
        procurementCompletedForCase: true,
        mrStatus: "FULLY_PROCURED",
      },
      { queueType: "READY_TO_RELEASE_WO" },
    );
    assert.equal(resolved.action, "Open Production Workspace");
    assert.match(resolved.href, /\/production/);
  });
});
