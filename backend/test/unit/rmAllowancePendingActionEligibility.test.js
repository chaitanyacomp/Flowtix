const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isRmAllowanceRequestActionableForStore,
  markRmAllowanceApprovalSuperseded,
  clearStaleAllowanceRequestsAfterNormalIssue,
  SUPERSEDABLE_STATUSES,
} = require("../../src/services/rmAllowanceApprovalService");
const {
  fetchStoreRmAllowanceQueuePendingActions,
} = require("../../src/services/pendingActionsService");

test("isRmAllowanceRequestActionableForStore requires open PMR and line remaining", () => {
  assert.equal(
    isRmAllowanceRequestActionableForStore({
      status: "REJECTED",
      productionMaterialRequest: { status: "FULLY_ISSUED" },
      pmrLine: { requiredQty: 30, issuedQty: 30, waivedQty: 0 },
    }),
    false,
  );
  assert.equal(
    isRmAllowanceRequestActionableForStore({
      status: "REJECTED",
      productionMaterialRequest: { status: "REQUESTED" },
      pmrLine: { requiredQty: 30, issuedQty: 0, waivedQty: 0 },
    }),
    true,
  );
  assert.equal(
    isRmAllowanceRequestActionableForStore({
      status: "REJECTED",
      productionMaterialRequest: { status: "PARTIALLY_ISSUED" },
      pmrLine: { requiredQty: 30, issuedQty: 10, waivedQty: 0 },
    }),
    true,
  );
  assert.equal(
    isRmAllowanceRequestActionableForStore({
      status: "REJECTED",
      productionMaterialRequest: { status: "REQUESTED" },
      pmrLine: { requiredQty: 30, issuedQty: 30, waivedQty: 0 },
    }),
    false,
  );
  assert.equal(
    isRmAllowanceRequestActionableForStore({
      status: "SUPERSEDED",
      productionMaterialRequest: { status: "REQUESTED" },
      pmrLine: { requiredQty: 30, issuedQty: 0, waivedQty: 0 },
    }),
    false,
  );
});

test("SUPERSEDABLE_STATUSES includes REJECTED so resubmit clears stale Rejected PAs", () => {
  assert.ok(SUPERSEDABLE_STATUSES.includes("REJECTED"));
  assert.ok(SUPERSEDABLE_STATUSES.includes("APPROVED"));
  assert.ok(SUPERSEDABLE_STATUSES.includes("PENDING_APPROVAL"));
  assert.ok(!SUPERSEDABLE_STATUSES.includes("ISSUED"));
});

test("markRmAllowanceApprovalSuperseded never writes REJECTED", async () => {
  const updated = await markRmAllowanceApprovalSuperseded(9, {
    rmAllowanceApprovalRequest: {
      findUnique: async () => ({ id: 9, status: "APPROVED" }),
      update: async ({ data }) => ({ id: 9, status: data.status }),
    },
  });
  assert.equal(updated.status, "SUPERSEDED");
});

test("clearStaleAllowanceRequestsAfterNormalIssue supersedes leftover Rejected", async () => {
  let whereStatuses = null;
  const result = await clearStaleAllowanceRequestsAfterNormalIssue(44, {
    rmAllowanceApprovalRequest: {
      updateMany: async ({ where, data }) => {
        whereStatuses = where.status.in;
        assert.equal(data.status, "SUPERSEDED");
        return { count: 1 };
      },
    },
  });
  assert.equal(result.count, 1);
  assert.ok(whereStatuses.includes("REJECTED"));
});

function approvalRow(overrides = {}) {
  return {
    id: 50,
    status: "REJECTED",
    requestedAt: new Date("2026-07-01T10:00:00Z"),
    workOrderId: 3,
    productionMaterialRequestId: 3,
    pmrLineId: 30,
    itemId: 7,
    issueQty: 32,
    workOrder: { id: 3, docNo: "WO-26-0003" },
    productionMaterialRequest: { id: 3, docNo: "PMR-26-0003", status: "FULLY_ISSUED" },
    pmrLine: { id: 30, requiredQty: 30, issuedQty: 30, waivedQty: 0 },
    item: { id: 7, itemName: "HDPE", unit: "Kg" },
    ...overrides,
  };
}

test("fetchStoreRmAllowanceQueuePendingActions omits rejected when PMR fully issued", async () => {
  const actions = await fetchStoreRmAllowanceQueuePendingActions({
    rmAllowanceApprovalRequest: {
      findMany: async () => [approvalRow()],
    },
  });
  assert.equal(actions.length, 0);
});

test("fetchStoreRmAllowanceQueuePendingActions shows rejected when RM remaining", async () => {
  const actions = await fetchStoreRmAllowanceQueuePendingActions({
    rmAllowanceApprovalRequest: {
      findMany: async () => [
        approvalRow({
          productionMaterialRequest: { id: 3, docNo: "PMR-26-0003", status: "REQUESTED" },
          pmrLine: { id: 30, requiredQty: 30, issuedQty: 0, waivedQty: 0 },
        }),
      ],
    },
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "RM Allowance Rejected");
  assert.ok(String(actions[0].href).includes("bucket=rejected"));
  assert.ok(String(actions[0].documentNo).includes("HDPE"));
});

test("fetchStoreRmAllowanceQueuePendingActions prefers newer request over old rejected", async () => {
  const actions = await fetchStoreRmAllowanceQueuePendingActions({
    rmAllowanceApprovalRequest: {
      findMany: async () => [
        approvalRow({
          id: 52,
          status: "PENDING_APPROVAL",
          productionMaterialRequest: { id: 3, docNo: "PMR-26-0003", status: "REQUESTED" },
          pmrLine: { id: 30, requiredQty: 30, issuedQty: 0, waivedQty: 0 },
          item: { id: 7, itemName: "HDPE", unit: "Kg" },
        }),
        approvalRow({
          id: 50,
          status: "REJECTED",
          productionMaterialRequest: { id: 3, docNo: "PMR-26-0003", status: "REQUESTED" },
          pmrLine: { id: 30, requiredQty: 30, issuedQty: 0, waivedQty: 0 },
        }),
      ],
    },
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "RM Allowance Awaiting Admin");
  assert.equal(actions[0].metadata.allowanceApprovalId, 52);
});

test("fetchStoreRmAllowanceQueuePendingActions omits line with zero remaining after partial waive", async () => {
  const actions = await fetchStoreRmAllowanceQueuePendingActions({
    rmAllowanceApprovalRequest: {
      findMany: async () => [
        approvalRow({
          productionMaterialRequest: { id: 3, docNo: "PMR-26-0003", status: "PARTIALLY_ISSUED" },
          pmrLine: { id: 30, requiredQty: 30, issuedQty: 20, waivedQty: 10 },
        }),
      ],
    },
  });
  assert.equal(actions.length, 0);
});
