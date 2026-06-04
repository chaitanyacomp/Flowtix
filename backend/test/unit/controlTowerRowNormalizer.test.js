const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRmRiskRow,
  normalizeProductionRow,
  normalizeQaRow,
  normalizeDispatchRow,
  normalizeContinueWorkingRow,
  validateNormalizedRowShape,
  VISIBLE_OWNERS,
  DOCUMENT_TYPES,
  RISK_LEVELS,
  CONTROL_TOWER_STATUSES,
  mapSourceToCurrentStatus,
} = require("../../src/services/controlTowerRowNormalizer");

describe("mapSourceToCurrentStatus", () => {
  it("maps RM_LOW_BUFFER and CRITICAL to WAITING_RM", () => {
    assert.equal(
      mapSourceToCurrentStatus({ rowType: "RM_RISK", sourceStatus: "RM_LOW_BUFFER" }),
      CONTROL_TOWER_STATUSES.WAITING_RM,
    );
    assert.equal(
      mapSourceToCurrentStatus({ rowType: "RM_RISK", sourceStatus: "CRITICAL" }),
      CONTROL_TOWER_STATUSES.WAITING_RM,
    );
  });

  it("maps QC aliases to QA_PENDING", () => {
    assert.equal(mapSourceToCurrentStatus({ sourceNextAction: "QC_PENDING" }), CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(mapSourceToCurrentStatus({ sourceStatus: "PENDING_QC" }), CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(mapSourceToCurrentStatus({ sourceStatus: "PARTIAL_QC" }), CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(mapSourceToCurrentStatus({ sourceStageKey: "QC" }), CONTROL_TOWER_STATUSES.QA_PENDING);
  });

  it("maps DISPATCH and DISPATCH_PENDING to DISPATCH_PENDING", () => {
    assert.equal(mapSourceToCurrentStatus({ sourceStageKey: "DISPATCH" }), CONTROL_TOWER_STATUSES.DISPATCH_PENDING);
    assert.equal(
      mapSourceToCurrentStatus({ sourceNextAction: "DISPATCH_PENDING" }),
      CONTROL_TOWER_STATUSES.DISPATCH_PENDING,
    );
  });

  it("maps SALES_BILL to BILLING_PENDING", () => {
    assert.equal(
      mapSourceToCurrentStatus({ sourceStageKey: "SALES_BILL" }),
      CONTROL_TOWER_STATUSES.BILLING_PENDING,
    );
  });

  it("maps NEXT_RS_REQUIRED and NEXT_RS to NEXT_RS_READY", () => {
    assert.equal(
      mapSourceToCurrentStatus({ sourceNextAction: "NEXT_RS_REQUIRED" }),
      CONTROL_TOWER_STATUSES.NEXT_RS_READY,
    );
    assert.equal(mapSourceToCurrentStatus({ sourceStageKey: "NEXT_RS" }), CONTROL_TOWER_STATUSES.NEXT_RS_READY);
  });

  it("maps ON_HOLD to PRODUCTION_ON_HOLD", () => {
    assert.equal(mapSourceToCurrentStatus({ sourceNextAction: "ON_HOLD" }), CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD);
  });

  it("maps procurement queue types to PROCUREMENT_IN_PROGRESS", () => {
    assert.equal(
      mapSourceToCurrentStatus({ sourceQueueType: "WAITING_PURCHASE_ACTION" }),
      CONTROL_TOWER_STATUSES.PROCUREMENT_IN_PROGRESS,
    );
    assert.equal(
      mapSourceToCurrentStatus({ sourceQueueType: "PO_WAITING_GRN" }),
      CONTROL_TOWER_STATUSES.PROCUREMENT_IN_PROGRESS,
    );
  });

  it("maps RM_READY_FOR_ISSUE queue types", () => {
    assert.equal(
      mapSourceToCurrentStatus({ sourceQueueType: "RM_READY_FOR_ISSUE" }),
      CONTROL_TOWER_STATUSES.RM_READY_FOR_ISSUE,
    );
    assert.equal(
      mapSourceToCurrentStatus({ sourceQueueType: "STORE_ISSUE_PENDING" }),
      CONTROL_TOWER_STATUSES.RM_READY_FOR_ISSUE,
    );
  });
});

describe("controlTowerRowNormalizer", () => {
  it("normalizeRmRiskRow: LOW_BUFFER status -> WAITING_RM with lineage", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 10,
      itemId: 3,
      status: "LOW_BUFFER",
      recommendedAction: "Raise / review RM Requisition",
    });
    assert.equal(row.currentStatus, CONTROL_TOWER_STATUSES.WAITING_RM);
    assert.notEqual(row.currentStatus, "RM_LOW_BUFFER");
    assert.equal(row.metadata.sourceStatus, "LOW_BUFFER");
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
  });

  it("normalizeRmRiskRow: CRITICAL -> WAITING_RM", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 10,
      itemId: 3,
      status: "CRITICAL",
      recommendedAction: "Open purchase plan",
    });
    assert.equal(row.currentStatus, CONTROL_TOWER_STATUSES.WAITING_RM);
    assert.equal(row.metadata.sourceStatus, "CRITICAL");
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
    assert.equal(row.metadata.purchaseNextOwnerHint, "Open purchase plan");
  });

  it("normalizeRmRiskRow: PURCHASE only for WAITING_PURCHASE_ACTION", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 10,
      itemId: 3,
      status: "CRITICAL",
      queueType: "WAITING_PURCHASE_ACTION",
      recommendedAction: "Follow up Purchase Order",
    });
    assert.equal(row.currentStatus, CONTROL_TOWER_STATUSES.PROCUREMENT_IN_PROGRESS);
    assert.equal(row.currentOwner, VISIBLE_OWNERS.PURCHASE);
    assert.equal(row.metadata.sourceQueueType, "WAITING_PURCHASE_ACTION");
  });

  it("normalizeProductionRow: QC_PENDING -> QA_PENDING with sourceNextAction preserved", () => {
    const row = normalizeProductionRow({
      workOrderId: 1,
      workOrderLineId: 2,
      nextAction: "QC_PENDING",
      actionLabel: "Complete QA",
      status: "OPEN",
    });
    assert.equal(row.currentStatus, CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(row.currentOwner, VISIBLE_OWNERS.QA);
    assert.equal(row.metadata.sourceNextAction, "QC_PENDING");
  });

  it("normalizeQaRow: PENDING_QC and PARTIAL_QC -> QA_PENDING", () => {
    const pending = normalizeQaRow({ qcRef: "PE-1", workOrderId: 7, status: "PENDING_QC" });
    const partial = normalizeQaRow({ qcRef: "PE-2", workOrderId: 7, status: "PARTIAL_QC" });
    assert.equal(pending.currentStatus, CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(partial.currentStatus, CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(pending.metadata.sourceStatus, "PENDING_QC");
    assert.equal(partial.metadata.sourceStatus, "PARTIAL_QC");
  });

  it("normalizeDispatchRow: DISPATCH_PENDING status", () => {
    const row = normalizeDispatchRow({
      salesOrderId: 12,
      itemId: 4,
      orderType: "NO_QTY",
      dispatchableNow: 5,
    });
    assert.equal(row.currentStatus, CONTROL_TOWER_STATUSES.DISPATCH_PENDING);
    assert.equal(row.metadata.sourceStatus, "DISPATCH_PENDING");
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
  });

  it("normalizeContinueWorkingRow: stage aliases and lineage", () => {
    const qc = normalizeContinueWorkingRow({
      key: "so-1-qc",
      salesOrderId: 1,
      stageKey: "QC",
      nextAction: "QC_PENDING",
      orderType: "NORMAL",
    });
    assert.equal(qc.currentStatus, CONTROL_TOWER_STATUSES.QA_PENDING);
    assert.equal(qc.metadata.sourceStageKey, "QC");
    assert.equal(qc.metadata.sourceNextAction, "QC_PENDING");

    const bill = normalizeContinueWorkingRow({
      salesOrderId: 3,
      salesOrderDocNo: "SO-26-0003",
      stageKey: "SALES_BILL",
      nextStep: "Create Sales Bill",
    });
    assert.equal(bill.currentStatus, CONTROL_TOWER_STATUSES.BILLING_PENDING);
    assert.equal(bill.currentOwner, VISIBLE_OWNERS.ADMIN);

    const nextRs = normalizeContinueWorkingRow({
      salesOrderId: 4,
      stageKey: "NEXT_RS",
      nextAction: "NEXT_RS_REQUIRED",
    });
    assert.equal(nextRs.currentStatus, CONTROL_TOWER_STATUSES.NEXT_RS_READY);

    const disp = normalizeContinueWorkingRow({
      salesOrderId: 5,
      stageKey: "DISPATCH",
    });
    assert.equal(disp.currentStatus, CONTROL_TOWER_STATUSES.DISPATCH_PENDING);

    const prod = normalizeContinueWorkingRow({
      salesOrderId: 6,
      stageKey: "PRODUCTION",
    });
    assert.equal(prod.currentStatus, CONTROL_TOWER_STATUSES.PRODUCTION_PENDING);
  });

  it("normalizeProductionRow: ON_HOLD -> PRODUCTION_ON_HOLD", () => {
    const row = normalizeProductionRow({
      workOrderId: 1,
      workOrderLineId: 2,
      nextAction: "ON_HOLD",
    });
    assert.equal(row.currentStatus, CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD);
    assert.equal(row.currentOwner, VISIBLE_OWNERS.PRODUCTION);
  });

  it("validateNormalizedRowShape still passes", () => {
    const row = normalizeQaRow({ qcRef: "PE-99", workOrderId: 7, status: "PENDING_QC" });
    assert.equal(validateNormalizedRowShape(row), true);
    assert.equal(row.documentType, DOCUMENT_TYPES.QA);
    assert.equal(row.riskLevel, RISK_LEVELS.LOW);
  });
});
