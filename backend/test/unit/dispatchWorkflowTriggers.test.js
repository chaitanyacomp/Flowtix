const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isCustomerDeliveryDue,
  resolveStoreDispatchPendingActionGroups,
  buildStoreDispatchPendingActionLabel,
} = require("../../src/services/dispatchWorkflowTriggers");

function mockDb({ drafts = [], salesOrders = [] } = {}) {
  return {
    dispatch: {
      findMany: async () => drafts,
    },
    salesOrder: {
      findMany: async ({ where }) => {
        const ids = where?.id?.in ?? [];
        return salesOrders.filter((so) => ids.includes(so.id));
      },
    },
  };
}

function normalSo(id, docNo, { requiredDate = null } = {}) {
  return {
    id,
    internalStatus: "APPROVED",
    orderType: "NORMAL",
    docNo,
    createdAt: new Date("2026-05-20T00:00:00Z"),
    po: { requiredDate },
    customer: { name: "Acme" },
  };
}

describe("dispatchWorkflowTriggers", () => {
  it("isCustomerDeliveryDue is true when required date is today or past", () => {
    const today = new Date("2026-06-01T12:00:00Z");
    assert.equal(isCustomerDeliveryDue(new Date("2026-05-30T00:00:00Z"), today), true);
    assert.equal(isCustomerDeliveryDue(new Date("2026-06-01T00:00:00Z"), today), true);
    assert.equal(isCustomerDeliveryDue(new Date("2026-06-02T00:00:00Z"), today), false);
    assert.equal(isCustomerDeliveryDue(null, today), false);
  });

  it("does not qualify inventory-only backlog without draft or delivery due", async () => {
    const backlog = [
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        dispatchableNow: 3476,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
    ];
    const groups = await resolveStoreDispatchPendingActionGroups(
      mockDb({ salesOrders: [normalSo(1, "SO-26-0001")] }),
      backlog,
    );
    assert.equal(groups.length, 0);
  });

  it("qualifies when unlocked dispatch draft exists", async () => {
    const backlog = [{ salesOrderId: 42, salesOrderDocNo: "SO-26-0042", dispatchableNow: 0 }];
    const groups = await resolveStoreDispatchPendingActionGroups(
      mockDb({
        drafts: [{ soId: 42, dispatchedQty: 25, reversalOfId: null, workflowStatus: "UNLOCKED" }],
        salesOrders: [normalSo(42, "SO-26-0042")],
      }),
      backlog,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].trigger, "DRAFT");
    assert.equal(groups[0].totalQty, 25);
    assert.equal(
      buildStoreDispatchPendingActionLabel("SO-26-0042", 25, "DRAFT"),
      "Finalize Dispatch Draft — SO-26-0042 — Qty 25",
    );
  });

  it("qualifies when customer delivery is due and dispatchable qty remains", async () => {
    const backlog = [
      {
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        dispatchableNow: 11593,
        salesOrderDate: new Date("2026-05-20T00:00:00Z"),
      },
    ];
    const groups = await resolveStoreDispatchPendingActionGroups(
      mockDb({
        salesOrders: [
          normalSo(1, "SO-26-0001", { requiredDate: new Date("2026-05-01T00:00:00Z") }),
        ],
      }),
      backlog,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].trigger, "DELIVERY_DUE");
    assert.equal(groups[0].totalQty, 11593);
    assert.equal(
      buildStoreDispatchPendingActionLabel("SO-26-0001", 11593, "DELIVERY_DUE"),
      "Delivery Due — Dispatch — SO-26-0001 — Qty 11593",
    );
  });

  it("prefers draft trigger over delivery due when both apply", async () => {
    const backlog = [{ salesOrderId: 1, salesOrderDocNo: "SO-1", dispatchableNow: 500 }];
    const groups = await resolveStoreDispatchPendingActionGroups(
      mockDb({
        drafts: [{ soId: 1, dispatchedQty: 40, reversalOfId: null, workflowStatus: "UNLOCKED" }],
        salesOrders: [normalSo(1, "SO-1", { requiredDate: new Date("2026-05-01T00:00:00Z") })],
      }),
      backlog,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].trigger, "DRAFT");
    assert.equal(groups[0].totalQty, 40);
  });
});
