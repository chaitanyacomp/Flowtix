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
} = require("../../src/services/controlTowerRowNormalizer");

describe("controlTowerRowNormalizer", () => {
  it("normalizeRmRiskRow assigns STORE for generic RM shortage (not Purchase)", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 10,
      salesOrderId: 5,
      workOrderNo: "WO-10",
      itemId: 3,
      status: "CRITICAL",
      recommendedAction: "Open purchase plan",
      shortageAfterReservationQty: 2.5,
    });
    assert.equal(validateNormalizedRowShape(row), true);
    assert.equal(row.documentType, DOCUMENT_TYPES.RM_SHORTAGE);
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
    assert.equal(row.metadata.purchaseNextOwnerHint, "Open purchase plan");
    assert.equal(row.riskLevel, RISK_LEVELS.CRITICAL);
    assert.equal(row.ageHours, null);
  });

  it("normalizeRmRiskRow assigns PURCHASE only for WAITING_PURCHASE_ACTION queueType", () => {
    const row = normalizeRmRiskRow({
      workOrderId: 10,
      itemId: 3,
      status: "CRITICAL",
      queueType: "WAITING_PURCHASE_ACTION",
      recommendedAction: "Follow up Purchase Order",
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.PURCHASE);
    assert.equal(row.metadata.purchaseNextOwnerHint, undefined);
  });

  it("normalizeProductionRow maps QC_PENDING to QA owner", () => {
    const row = normalizeProductionRow({
      workOrderId: 1,
      workOrderLineId: 2,
      workOrderNo: "WO-1",
      nextAction: "QC_PENDING",
      actionLabel: "Complete QA",
      workOrderDate: new Date(Date.now() - 2 * 3600000).toISOString(),
      orderType: "NORMAL",
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.QA);
    assert.equal(row.documentType, DOCUMENT_TYPES.PRODUCTION);
    assert.ok(row.ageHours >= 1);
  });

  it("normalizeQaRow uses PE ref as documentNo", () => {
    const row = normalizeQaRow({
      qcRef: "PE-99",
      workOrderId: 7,
      status: "PENDING_QC",
      qcDate: new Date().toISOString(),
      pendingQcQty: 1,
    });
    assert.equal(row.documentNo, "PE-99");
    assert.equal(row.currentOwner, VISIBLE_OWNERS.QA);
  });

  it("normalizeDispatchRow marks NO_QTY dispatch as optional in metadata", () => {
    const row = normalizeDispatchRow({
      salesOrderId: 12,
      salesOrderNo: "SO-12",
      itemId: 4,
      orderType: "NO_QTY",
      dispatchableNow: 5,
      salesOrderDate: new Date().toISOString(),
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.STORE);
    assert.equal(row.metadata.dispatchOptional, true);
  });

  it("normalizeContinueWorkingRow maps SALES_BILL stage to ADMIN", () => {
    const row = normalizeContinueWorkingRow({
      key: "so-3-bill",
      salesOrderId: 3,
      salesOrderDocNo: "SO-26-0003",
      stageKey: "SALES_BILL",
      nextStep: "Create Sales Bill",
      orderType: "NORMAL",
    });
    assert.equal(row.currentOwner, VISIBLE_OWNERS.ADMIN);
    assert.equal(row.documentNo, "SO-26-0003");
  });
});
