const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePlannedProcessAllowance,
  calculatePlannedProcessAllowance,
} = require("../../src/services/plannedProcessAllowanceService");
const {
  resolveApprovedRequestForIssue,
  approveRmAllowanceApprovalRequest,
  rejectRmAllowanceApprovalRequest,
  submitRmAllowanceApprovalRequest,
} = require("../../src/services/rmAllowanceApprovalService");

test("≤5% Store can validate ISSUE without approved request", () => {
  const result = validatePlannedProcessAllowance(
    { theoreticalBomQty: 40.5, enteredAllowanceQty: 1.5, allowanceReason: null },
    { role: "STORE", mode: "ISSUE" },
  );
  assert.equal(result.requiresAdminApproval, false);
  assert.equal(result.approvalStatus, "NOT_REQUIRED");
});

test("SUBMIT_APPROVAL mode allows Store above 5% with reason (no Admin role)", () => {
  const result = validatePlannedProcessAllowance(
    { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "Process wastage trial" },
    { role: "STORE", mode: "SUBMIT_APPROVAL" },
  );
  assert.equal(result.requiresAdminApproval, true);
  assert.equal(result.plannedAllowancePct > 5, true);
});

test("ISSUE mode blocks Store above 5% without approved request", () => {
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "Process wastage trial" },
        { role: "STORE", mode: "ISSUE" },
      ),
    { code: "PLANNED_ALLOWANCE_ADMIN_APPROVAL_REQUIRED" },
  );
});

test("ISSUE mode allows Store above 5% when approved request is linked", () => {
  const result = validatePlannedProcessAllowance(
    { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "Process wastage trial" },
    { role: "STORE", mode: "ISSUE", approvedAllowanceRequest: { id: 99 } },
  );
  assert.equal(result.approvalStatus, "APPROVED");
});

test("ISSUE mode allows Admin above 5% without separate request", () => {
  const result = validatePlannedProcessAllowance(
    { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "Process wastage trial" },
    { role: "ADMIN", mode: "ISSUE" },
  );
  assert.equal(result.approvalStatus, "APPROVED");
});

test("above 10% remains blocked for approval submission and issue", () => {
  assert.throws(() => calculatePlannedProcessAllowance(27, 3), {
    code: "PLANNED_ALLOWANCE_INITIAL_ISSUE_LIMIT",
  });
});

test("above 5% without reason is rejected for SUBMIT_APPROVAL", () => {
  assert.throws(
    () =>
      validatePlannedProcessAllowance(
        { theoreticalBomQty: 72, enteredAllowanceQty: 4, allowanceReason: "  " },
        { role: "STORE", mode: "SUBMIT_APPROVAL" },
      ),
    { code: "PLANNED_ALLOWANCE_REASON_REQUIRED" },
  );
});

test("resolveApprovedRequestForIssue returns null when allowance ≤5%", async () => {
  const row = await resolveApprovedRequestForIssue(
    {
      pmrLineId: 1,
      enteredAllowanceQty: 1.5,
      issueQty: 42,
      theoreticalBomQty: 40.5,
      alreadyIssuedQty: 0,
    },
    {
      rmAllowanceApprovalRequest: {
        findUnique: async () => null,
        findFirst: async () => null,
      },
    },
  );
  assert.equal(row, null);
});

test("resolveApprovedRequestForIssue rejects quantity exceeding approved issue qty", async () => {
  await assert.rejects(
    () =>
      resolveApprovedRequestForIssue(
        {
          pmrLineId: 10,
          allowanceApprovalRequestId: 5,
          enteredAllowanceQty: 4,
          issueQty: 80,
          theoreticalBomQty: 72,
          alreadyIssuedQty: 0,
        },
        {
          rmAllowanceApprovalRequest: {
            findUnique: async () => ({
              id: 5,
              status: "APPROVED",
              pmrLineId: 10,
              addQty: 4,
              issueQty: 76,
              applicableBomQty: 72,
              alreadyIssuedQty: 0,
              allowancePct: 5.5556,
            }),
            findFirst: async () => null,
          },
        },
      ),
    (err) => err && err.code === "APPROVAL_QTY_EXCEEDED",
  );
});

test("resolveApprovedRequestForIssue invalidates when Add Qty changed", async () => {
  let supersededId = null;
  await assert.rejects(
    () =>
      resolveApprovedRequestForIssue(
        {
          pmrLineId: 10,
          allowanceApprovalRequestId: 5,
          enteredAllowanceQty: 5,
          issueQty: 76,
          theoreticalBomQty: 72,
          alreadyIssuedQty: 0,
        },
        {
          rmAllowanceApprovalRequest: {
            findUnique: async ({ where }) => {
              if (where?.id === 5) {
                return {
                  id: 5,
                  status: "APPROVED",
                  pmrLineId: 10,
                  addQty: 4,
                  issueQty: 76,
                  applicableBomQty: 72,
                  alreadyIssuedQty: 0,
                  allowancePct: 5.5556,
                };
              }
              return null;
            },
            findFirst: async () => null,
            update: async ({ where, data }) => {
              supersededId = where.id;
              return { id: where.id, status: data.status };
            },
          },
        },
      ),
    (err) => err && err.code === "APPROVAL_INVALIDATED",
  );
  assert.equal(supersededId, 5);
});

test("resolveApprovedRequestForIssue rejects non-APPROVED / forged status payload", async () => {
  await assert.rejects(
    () =>
      resolveApprovedRequestForIssue(
        {
          pmrLineId: 10,
          allowanceApprovalRequestId: 5,
          enteredAllowanceQty: 4,
          issueQty: 76,
          theoreticalBomQty: 72,
          alreadyIssuedQty: 0,
        },
        {
          rmAllowanceApprovalRequest: {
            findUnique: async () => ({
              id: 5,
              status: "PENDING_APPROVAL",
              pmrLineId: 10,
              addQty: 4,
              issueQty: 76,
              applicableBomQty: 72,
              alreadyIssuedQty: 0,
              allowancePct: 5.5556,
            }),
            findFirst: async () => null,
          },
        },
      ),
    (err) => err && err.code === "PLANNED_ALLOWANCE_ADMIN_APPROVAL_REQUIRED",
  );
});

test("partial cumulative issue still uses applicable BOM without double-count", () => {
  const afterPartial = calculatePlannedProcessAllowance(40.5, 1.5, 20);
  assert.equal(afterPartial.applicableBomQty, 20.5);
  assert.equal(afterPartial.recommendedIssueQty, 22);
  assert.equal(afterPartial.requiresAdminApproval, true);
});

function mockTx(handlers) {
  const tx = {
    auditLog: { create: async () => ({ id: 1 }) },
    ...handlers,
  };
  return {
    $transaction: async (fn) => fn(tx),
    ...tx,
  };
}

test("approve is Admin-only", async () => {
  await assert.rejects(
    () => approveRmAllowanceApprovalRequest(1, { role: "STORE", userId: 2 }, mockTx({})),
    (err) => err && err.code === "FORBIDDEN" && err.statusCode === 403,
  );
});

test("reject is Admin-only", async () => {
  await assert.rejects(
    () =>
      rejectRmAllowanceApprovalRequest(1, { rejectionReason: "Too high" }, { role: "STORE", userId: 2 }, mockTx({})),
    (err) => err && err.code === "FORBIDDEN" && err.statusCode === 403,
  );
});

test("rejection requires a reason", async () => {
  await assert.rejects(
    () => rejectRmAllowanceApprovalRequest(1, { rejectionReason: "  " }, { role: "ADMIN", userId: 9 }, mockTx({})),
    (err) => err && err.code === "REJECTION_REASON_REQUIRED",
  );
});

test("Admin cannot approve their own request", async () => {
  await assert.rejects(
    () =>
      approveRmAllowanceApprovalRequest(
        7,
        { role: "ADMIN", userId: 42 },
        mockTx({
          rmAllowanceApprovalRequest: {
            findUnique: async () => ({
              id: 7,
              status: "PENDING_APPROVAL",
              requestedByUserId: 42,
              workOrder: null,
              productionMaterialRequest: null,
              pmrLine: null,
              item: null,
              requestedBy: null,
              reviewedBy: null,
            }),
          },
        }),
      ),
    (err) => err && err.code === "SELF_APPROVAL_FORBIDDEN",
  );
});

test("approve does not post stock (status APPROVED only)", async () => {
  const updated = await approveRmAllowanceApprovalRequest(
    8,
    { role: "ADMIN", userId: 9 },
    mockTx({
      rmAllowanceApprovalRequest: {
        findUnique: async () => ({
          id: 8,
          requestNo: "RAA-1",
          status: "PENDING_APPROVAL",
          requestedByUserId: 3,
          workOrderId: 1,
          pmrLineId: 2,
          addQty: 4,
          issueQty: 76,
          allowancePct: 5.5556,
          workOrder: { id: 1, docNo: "WO-1", salesOrderId: null, salesOrder: null },
          productionMaterialRequest: { id: 1, docNo: "PMR-1" },
          pmrLine: { id: 2, unitSnapshot: "Kg", issuedQty: 0, requiredQty: 72 },
          item: { id: 5, itemName: "RM", unit: "Kg" },
          requestedBy: { id: 3, name: "Store", role: "STORE" },
          reviewedBy: null,
        }),
        update: async ({ data }) => ({
          id: 8,
          requestNo: "RAA-1",
          status: data.status,
          requestedByUserId: 3,
          reviewedByUserId: data.reviewedByUserId,
          reviewedAt: data.reviewedAt,
          rejectionReason: data.rejectionReason,
          workOrderId: 1,
          pmrLineId: 2,
          addQty: 4,
          issueQty: 76,
          allowancePct: 5.5556,
          theoreticalBomQty: 72,
          applicableBomQty: 72,
          alreadyIssuedQty: 0,
          availableQtyAtRequest: 100,
          storeReason: "trial",
          requestedAt: new Date(),
          materialIssueNoteId: null,
          issuedAt: null,
          issuedByUserId: null,
          workOrder: { id: 1, docNo: "WO-1", salesOrderId: null, salesOrder: null },
          productionMaterialRequest: { id: 1, docNo: "PMR-1" },
          pmrLine: { id: 2, unitSnapshot: "Kg", issuedQty: 0, requiredQty: 72 },
          item: { id: 5, itemName: "RM", unit: "Kg" },
          requestedBy: { id: 3, name: "Store", role: "STORE" },
          reviewedBy: { id: 9, name: "Admin", role: "ADMIN" },
        }),
      },
      // No stockTransaction / materialIssueNote create — approve must not touch stock.
    }),
  );
  assert.equal(updated.status, "APPROVED");
  assert.equal(updated.materialIssueNoteId, null);
});

test("submit is Store/Admin only", async () => {
  await assert.rejects(
    () =>
      submitRmAllowanceApprovalRequest(
        {
          productionMaterialRequestId: 1,
          pmrLineId: 2,
          enteredAllowanceQty: 4,
          issueQty: 76,
          allowanceReason: "trial",
        },
        { role: "PRODUCTION", userId: 1 },
        mockTx({}),
      ),
    (err) => err && err.code === "FORBIDDEN",
  );
});

test("duplicate active request with same fingerprint returns existing (idempotent)", async () => {
  const existing = {
    id: 11,
    requestNo: "RAA-DUP",
    status: "PENDING_APPROVAL",
    workOrderId: 1,
    productionMaterialRequestId: 1,
    pmrLineId: 2,
    itemId: 5,
    theoreticalBomQty: 72,
    applicableBomQty: 72,
    alreadyIssuedQty: 0,
    addQty: 4,
    allowancePct: 5.555555555555555,
    issueQty: 76,
    availableQtyAtRequest: 100,
    storeReason: "Process wastage trial",
    requestedByUserId: 3,
    requestedAt: new Date(),
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    materialIssueNoteId: null,
    issuedAt: null,
    issuedByUserId: null,
    workOrder: { id: 1, docNo: "WO-1", salesOrderId: null, salesOrder: null },
    productionMaterialRequest: { id: 1, docNo: "PMR-1" },
    pmrLine: { id: 2, unitSnapshot: "Kg", issuedQty: 0, requiredQty: 72 },
    item: { id: 5, itemName: "RM", unit: "Kg" },
    requestedBy: { id: 3, name: "Store", role: "STORE" },
    reviewedBy: null,
  };
  let createCalled = false;
  const result = await submitRmAllowanceApprovalRequest(
    {
      productionMaterialRequestId: 1,
      pmrLineId: 2,
      enteredAllowanceQty: 4,
      issueQty: 76,
      allowanceReason: "Process wastage trial",
      fromLocationId: 1,
    },
    { role: "STORE", userId: 3 },
    mockTx({
      productionMaterialRequest: {
        findUnique: async () => ({
          id: 1,
          workOrderId: 1,
          workOrder: { id: 1, docNo: "WO-1", salesOrderId: null },
          lines: [
            {
              id: 2,
              itemId: 5,
              requiredQty: 72,
              issuedQty: 0,
              item: { id: 5, itemName: "RM", unit: "Kg" },
            },
          ],
        }),
      },
      rmAllowanceApprovalRequest: {
        findFirst: async () => existing,
        create: async () => {
          createCalled = true;
          return existing;
        },
        updateMany: async () => ({ count: 0 }),
      },
    }),
  );
  assert.equal(result.id, 11);
  assert.equal(result.status, "PENDING_APPROVAL");
  assert.equal(createCalled, false);
});
