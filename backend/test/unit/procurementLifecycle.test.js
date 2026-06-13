const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isMaterialRequirementFullyReceived,
  recalculateMaterialRequirementClosure,
  repairStaleDuplicateWoPlanningProcurement,
} = require("../../src/services/procurementLifecycleService");

function mrWithReceipt({ id = 1, status = "DRAFT", target = 100, received = 0, reversed = false } = {}) {
  return {
    id,
    status,
    lines: [
      {
        id: id * 10,
        rmItemId: 7,
        requiredQty: target,
        shortageQty: target,
        purchaseRequestSourceLinks: [
          {
            allocatedQty: target,
            purchaseRequestLine: {
              sourceLinks: [{ allocatedQty: target }],
              poLinks: [
                {
                  allocatedQty: target,
                  rmPoLine: {
                    qty: target,
                    rmPo: { id: 55, status: "PENDING" },
                    grnLines:
                      received > 0
                        ? [{ receivedQty: received, grn: { id: 77, reversedAt: reversed ? new Date() : null } }]
                        : [],
                  },
                },
              ],
            },
          },
        ],
        procurementLinks: [],
      },
    ],
  };
}

function fakeDbForRecalc(mr) {
  const updates = [];
  return {
    updates,
    materialRequirement: {
      findMany: async () => [mr],
      update: async (args) => {
        updates.push(args);
        return args;
      },
    },
  };
}

describe("procurement lifecycle closure", () => {
  it("MR -> PR -> PO without GRN marks RM Requisition procurement in progress", async () => {
    const db = fakeDbForRecalc(mrWithReceipt({ status: "DRAFT", received: 0 }));

    const changes = await recalculateMaterialRequirementClosure(db, [1]);

    assert.deepEqual(changes, [{ id: 1, from: "DRAFT", to: "PROCUREMENT_IN_PROGRESS" }]);
    assert.equal(db.updates[0].data.status, "PROCUREMENT_IN_PROGRESS");
  });

  it("partial GRN marks RM Requisition partially procured", async () => {
    const db = fakeDbForRecalc(mrWithReceipt({ status: "DRAFT", received: 40 }));

    const changes = await recalculateMaterialRequirementClosure(db, [1]);

    assert.deepEqual(changes, [{ id: 1, from: "DRAFT", to: "PARTIALLY_PROCURED" }]);
    assert.equal(db.updates[0].data.status, "PARTIALLY_PROCURED");
  });

  it("full active GRN marks RM Requisition fully procured", async () => {
    const db = fakeDbForRecalc(mrWithReceipt({ status: "DRAFT", received: 100 }));

    const changes = await recalculateMaterialRequirementClosure(db, [1]);

    assert.deepEqual(changes, [{ id: 1, from: "DRAFT", to: "FULLY_PROCURED" }]);
    assert.equal(db.updates[0].data.status, "FULLY_PROCURED");
  });

  it("reopens FULLY_PROCURED MR when revision delta is not on any purchase request", async () => {
    const mr = {
      id: 82,
      status: "FULLY_PROCURED",
      sentToPurchaseAt: new Date("2026-06-13"),
      lines: [
        {
          id: 1,
          rmItemId: 1,
          requiredQty: 330.87,
          shortageQty: 330.87,
          purchaseRequestSourceLinks: [
            {
              allocatedQty: 185.61,
              purchaseRequestLine: {
                sourceLinks: [{ allocatedQty: 185.61 }],
                poLinks: [
                  {
                    allocatedQty: 200,
                    rmPoLine: {
                      qty: 200,
                      rmPo: { id: 106, status: "COMPLETED" },
                      grnLines: [{ receivedQty: 200, grn: { id: 1, reversedAt: null } }],
                    },
                  },
                ],
              },
            },
          ],
          procurementLinks: [],
        },
        {
          id: 2,
          rmItemId: 2,
          requiredQty: 10.25,
          shortageQty: 10.25,
          purchaseRequestSourceLinks: [
            {
              allocatedQty: 5.75,
              purchaseRequestLine: {
                sourceLinks: [{ allocatedQty: 5.75 }],
                poLinks: [],
              },
            },
          ],
          procurementLinks: [],
        },
      ],
    };
    const db = fakeDbForRecalc(mr);
    const changes = await recalculateMaterialRequirementClosure(db, [82]);
    assert.deepEqual(changes, [{ id: 82, from: "FULLY_PROCURED", to: "SENT_TO_PURCHASE" }]);
    assert.equal(db.updates[0].data.closedAt, null);
  });

  it("GRN reversal reopens a closed RM Requisition back to procurement in progress", async () => {
    const db = fakeDbForRecalc(mrWithReceipt({ status: "CLOSED", received: 100, reversed: true }));

    const changes = await recalculateMaterialRequirementClosure(db, [1]);

    assert.deepEqual(changes, [{ id: 1, from: "CLOSED", to: "PROCUREMENT_IN_PROGRESS" }]);
    assert.equal(db.updates[0].data.status, "PROCUREMENT_IN_PROGRESS");
  });

  it("duplicate prevention treats active PO-without-GRN procurement as not fully received", () => {
    assert.equal(isMaterialRequirementFullyReceived(mrWithReceipt({ status: "CLOSED", received: 0 })), false);
  });

  it("guarded stale duplicate repair cancels only orphan duplicate MR/PR", async () => {
    const staleMr = {
      id: 2,
      docNo: "MR-26-0002",
      status: "DRAFT",
      sourceType: "WORK_ORDER_PLANNING",
      salesOrderId: 120,
      workOrderId: null,
      remarks: null,
      lines: [
        {
          id: 20,
          rmItemId: 7,
          requiredQty: 100,
          shortageQty: 100,
          purchaseRequestSourceLinks: [
            {
              purchaseRequestLine: {
                id: 30,
                purchaseRequest: { id: 40, docNo: "PR-26-0002", status: "PENDING_PURCHASE", remarks: null },
                sourceLinks: [{ materialRequirementLine: { materialRequirementId: 2 } }],
                poLinks: [],
              },
            },
          ],
        },
      ],
    };
    const fulfilledMr = mrWithReceipt({ id: 1, status: "CLOSED", received: 100 });
    fulfilledMr.docNo = "MR-26-0001";
    fulfilledMr.salesOrderId = 120;
    fulfilledMr.workOrderId = null;

    const updates = [];
    const db = {
      materialRequirement: {
        findMany: async (args) => {
          if (args.where?.id?.in) return [fulfilledMr];
          if (args.where?.id?.not === 2) return [{ id: 1 }];
          return [staleMr];
        },
        update: async (args) => {
          updates.push({ model: "MR", args });
          return args;
        },
      },
      purchaseRequest: {
        update: async (args) => {
          updates.push({ model: "PR", args });
          return args;
        },
      },
      auditLog: { create: async () => ({ id: 1 }) },
      $transaction: async (fn) => fn(db),
    };

    const repaired = await repairStaleDuplicateWoPlanningProcurement(db, { userId: 1, role: "ADMIN" });

    assert.deepEqual(repaired, [{ materialRequirementId: 2, purchaseRequestIds: [40], supersededBy: 1 }]);
    assert.equal(updates.find((u) => u.model === "PR").args.data.status, "CANCELLED");
    assert.equal(updates.find((u) => u.model === "MR").args.data.status, "CANCELLED");
  });
});
