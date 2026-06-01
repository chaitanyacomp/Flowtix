const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { transitionRmRequisition } = require("../../src/services/rmRequisitionLifecycle");

function buildFullyReceivedMr({ id = 1, status = "APPROVED", received = 100 } = {}) {
  return {
    id,
    docNo: `MR-${id}`,
    status,
    salesOrder: { id: 10, docNo: "SO-26-0001", internalStatus: "OPEN" },
    workOrder: { id: 11, docNo: "WO-26-0001", status: "IN_PROGRESS" },
    remarks: null,
    approvalRemarks: null,
    lines: [
      {
        id: id * 10,
        rmItemId: 7,
        requiredQty: 100,
        shortageQty: 100,
        procurementLinks: [
          {
            allocatedQty: 100,
            rmPoLine: {
              qty: 100,
              rmPo: { id: 55, status: "PENDING" },
              grnLines: [{ receivedQty: received, grn: { id: 77, reversedAt: null } }],
            },
          },
        ],
        purchaseRequestSourceLinks: [],
      },
    ],
  };
}

function buildUnresolvedMr({ id = 2, status = "APPROVED" } = {}) {
  return {
    id,
    docNo: `MR-${id}`,
    status,
    salesOrder: { id: 10, docNo: "SO-26-0001", internalStatus: "OPEN" },
    workOrder: { id: 11, docNo: "WO-26-0001", status: "IN_PROGRESS" },
    remarks: null,
    approvalRemarks: null,
    lines: [
      {
        id: id * 10,
        rmItemId: 7,
        requiredQty: 100,
        shortageQty: 100,
        procurementLinks: [],
        purchaseRequestSourceLinks: [],
      },
    ],
  };
}

function fakeTxForMr(mr, updates = []) {
  return {
    materialRequirement: {
      findUnique: async () => mr,
      update: async (args) => {
        updates.push(args);
        return { ...mr, ...args.data };
      },
    },
  };
}

function fakeDb(mr, updates = []) {
  return {
    $transaction: async (fn) => fn(fakeTxForMr(mr, updates)),
  };
}

describe("rm requisition close guard", () => {
  it("blocks closing an unresolved requisition", async () => {
    const mr = buildUnresolvedMr();
    await assert.rejects(
      () =>
        transitionRmRequisition(
          mr.id,
          "close",
          { userId: 1, role: "STORE" },
          fakeDb(mr),
        ),
      (err) => err.statusCode === 400 && err.code === "RM_REQUISITION_CLOSE_BLOCKED",
    );
  });

  it("allows close when shortage is fully received", async () => {
    const updates = [];
    const mr = buildFullyReceivedMr({ received: 100 });
    const result = await transitionRmRequisition(mr.id, "close", { userId: 1, role: "STORE" }, fakeDb(mr, updates));

    assert.equal(result.rmRequisition.status, "CLOSED");
    assert.equal(updates[0].data.status, "CLOSED");
  });

  it("allows admin override close even when shortage is unresolved", async () => {
    const updates = [];
    const mr = buildUnresolvedMr();
    const result = await transitionRmRequisition(mr.id, "close", { userId: 1, role: "ADMIN" }, fakeDb(mr, updates));

    assert.equal(result.rmRequisition.status, "CLOSED");
    assert.equal(updates[0].data.status, "CLOSED");
  });
});
