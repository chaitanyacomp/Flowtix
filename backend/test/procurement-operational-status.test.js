/**
 * Regression: PR allocation must not mark MR as RM_READY before PO/GRN.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveMrProcurementOperationalStatus,
  procurementBlockerReasonForOperationalKey,
  procurementRecommendedActionForOperationalKey,
} = require("../src/services/procurementWorkspaceService");

test("deriveMrProcurementOperationalStatus: PR pending → PR_PENDING_PO not RM_READY", () => {
  const mr = {
    lines: [
      { shortageQty: 100, procuredQty: 0, requiredQty: 100 },
    ],
  };
  const pendingByMr = new Map([[1, 100]]);
  const linkage = { hasOpenPo: false, hasGrnPending: false, prPendingCount: 1, poIds: [] };

  const op = deriveMrProcurementOperationalStatus(
    { lines: [{ id: 1, shortageQty: 100, procuredQty: 0 }] },
    pendingByMr,
    linkage,
  );

  assert.equal(op.key, "PR_PENDING_PO");
  assert.notEqual(op.key, "RM_READY");
});

test("deriveMrProcurementOperationalStatus: procured covers shortage → RM_READY", () => {
  const linkage = { hasOpenPo: false, hasGrnPending: false, prPendingCount: 0, poIds: [] };
  const op = deriveMrProcurementOperationalStatus(
    { lines: [{ id: 1, shortageQty: 50, procuredQty: 50 }] },
    new Map(),
    linkage,
  );
  assert.equal(op.key, "RM_READY");
});

test("procurement blocker labels align with material availability workspace language", () => {
  assert.equal(procurementBlockerReasonForOperationalKey("GRN_PENDING"), "PO created, GRN pending");
  assert.equal(procurementBlockerReasonForOperationalKey("PR_PENDING_PO"), "RM Requisition sent, PR/PO pending");
  assert.equal(procurementRecommendedActionForOperationalKey("GRN_PENDING"), "Wait for GRN");
  assert.equal(procurementRecommendedActionForOperationalKey("PROCUREMENT_PENDING"), "Create Purchase Request");
});
