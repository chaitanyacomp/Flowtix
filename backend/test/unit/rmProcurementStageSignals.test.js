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
    assert.doesNotMatch(resolved.action, /Regular SO/);
  });

  it("Regular SO before PR emits Create Purchase Request — Regular SO with salesOrderDocNo", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        materialRequirementId: 55,
        sourceType: "SALES_ORDER",
        workOrderId: 2,
        salesOrderId: 258,
        salesOrderDocNo: "SO-26-0001",
        prLineCount: 0,
        poLineCount: 0,
        operationalKey: "PROCUREMENT_PENDING",
        nextActionKey: "CREATE_PR",
        procurementDemandPool: "REGULAR_SO",
        hasOpenMr: true,
      },
      { queueType: "WAITING_PURCHASE_ACTION", freeStockQty: 0, netShortageAfterIncomingQty: 140 },
      "STORE",
    );
    assert.equal(resolved.action, "Create Purchase Request — Regular SO");
    assert.match(resolved.href, /demandPool=REGULAR_SO/);
    assert.match(resolved.href, /salesOrderId=258/);
    assert.match(resolved.href, /salesOrderDocNo=SO-26-0001/);
    assert.doesNotMatch(resolved.href, /SO%20%23258/);
  });

  it("Regular SO shortage without MR still emits Create Purchase Request — Regular SO", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        materialRequirementId: null,
        sourceType: "SALES_ORDER",
        salesOrderId: 261,
        salesOrderDocNo: "SO-26-0001",
        prLineCount: 0,
        poLineCount: 0,
        hasOpenMr: false,
        procurementDemandPool: "REGULAR_SO",
      },
      { queueType: "WO_BLOCKED_RM_SHORTAGE", freeStockQty: 0, netShortageAfterIncomingQty: 2.1 },
      "STORE",
    );
    assert.equal(resolved.action, "Create Purchase Request — Regular SO");
    assert.match(resolved.href, /demandPool=REGULAR_SO/);
    assert.match(resolved.href, /salesOrderId=261/);
  });

  it("draft MR emits Approve Material Requirement instead of Create PR", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        materialRequirementId: 88,
        sourceType: "SALES_ORDER",
        salesOrderId: 261,
        prLineCount: 0,
        poLineCount: 0,
        hasOpenMr: true,
        mrStatus: "PENDING_APPROVAL",
        operationalKey: "PROCUREMENT_PENDING",
        procurementDemandPool: "REGULAR_SO",
      },
      { queueType: "WAITING_PURCHASE_ACTION", freeStockQty: 0, netShortageAfterIncomingQty: 2.1 },
      "STORE",
    );
    assert.equal(resolved.action, "Approve Material Requirement");
    assert.match(resolved.href, /material-planning/);
    assert.match(resolved.href, /materialRequirementId=88/);
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
    assert.equal(resolved.action, "Create GRN");
    assert.match(resolved.href, /\/rm-po-grn\/112/);
    assert.match(resolved.href, /openGrn=1/);
  });

  it("after PO before GRN emits Create GRN for Store", () => {
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
    assert.equal(resolved.action, "Create GRN");
    assert.match(resolved.href, /rm-po-grn\/12/);
    assert.match(resolved.href, /openGrn=1/);
  });

  it("after GRN with stock emits Issue Material", () => {
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
    assert.equal(resolved.action, "Issue Material");
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

  it("PMR fully issued after completed procurement routes Store to release handoff when WO not yet released", () => {
    const resolved = resolveRmRiskStorePendingAction(
      {
        materialRequirementId: 1,
        workOrderId: 1,
        procurementCompletedForCase: true,
        mrStatus: "FULLY_PROCURED",
      },
      { queueType: "READY_TO_RELEASE_WO" },
    );
    assert.equal(resolved.action, "Release to Production");
    assert.doesNotMatch(resolved.href, /\/work-orders\/prepare/);
    assert.match(resolved.href, /material-issue|rm-shortage/);
  });

  it("PMR fully issued after completed procurement routes Production to workspace when released", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        materialRequirementId: 1,
        workOrderId: 1,
        procurementCompletedForCase: true,
        mrStatus: "FULLY_PROCURED",
        materialReleasedToProduction: true,
      },
      { queueType: "READY_TO_RELEASE_WO" },
      "PRODUCTION",
    );
    assert.equal(resolved.action, "Ready to Start Production");
    assert.match(resolved.href, /\/production/);
    assert.match(resolved.href, /productionBucket=readyToStart/);
    assert.match(resolved.href, /from=pending-actions/);
  });

  it("RM_RECEIVED_CREATE_WO deep-links Prepare WO for Regular SO (does not create WO)", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        salesOrderId: 258,
        salesOrderDocNo: "SO-26-0001",
        materialRequirementId: 55,
        sourceType: "SALES_ORDER",
        procurementCompletedForCase: true,
        mrStatus: "FULLY_PROCURED",
        operationalKey: "RM_RECEIVED_CREATE_WO",
        nextActionKey: "CREATE_WO",
      },
      { queueType: "RM_RECEIVED_CREATE_WO", recommendedAction: "Create Work Order in Prepare WO" },
      "STORE",
    );
    assert.equal(resolved.action, "Create Work Order in Prepare WO");
    assert.match(resolved.href, /\/work-orders\/prepare/);
    assert.match(resolved.href, /salesOrderId=258/);
    assert.match(resolved.href, /source=regular_so/);
    assert.match(resolved.href, /from=pending-actions/);
    assert.doesNotMatch(resolved.href, /\/dashboard/);
    assert.doesNotMatch(resolved.href, /rm-shortage/);
  });

  it("does not offer Prepare WO create-wo link when a work order already exists", () => {
    const resolved = resolveRmRiskPendingAction(
      {
        salesOrderId: 258,
        workOrderId: 99,
        procurementCompletedForCase: true,
        mrStatus: "FULLY_PROCURED",
        operationalKey: "RM_RECEIVED_CREATE_WO",
        nextActionKey: "CREATE_WO",
      },
      { queueType: "RM_RECEIVED_CREATE_WO" },
      "STORE",
    );
    assert.doesNotMatch(resolved.href, /\/work-orders\/prepare/);
  });
});
