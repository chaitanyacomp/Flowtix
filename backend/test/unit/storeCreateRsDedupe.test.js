/**
 * Store Create Cycle N Requirement Sheet must appear once per SO/cycle identity.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  dedupeStoreNoQtyCreateRsBySoCycle,
  storeCreateRsIdentityKey,
  isStoreCreateRsPendingAction,
} = require("../../src/services/pendingActionsService");

describe("dedupeStoreNoQtyCreateRsBySoCycle", () => {
  it("keeps a single Create Cycle 1 Requirement Sheet per SO/cycle", () => {
    const actions = [
      {
        id: "no-qty-create-next-rs:10:3",
        action: "Create Cycle 1 Requirement Sheet",
        documentNo: "SO-26-0001",
        ownerRole: "STORE",
        href: "/planning-dashboard?salesOrderId=10",
        metadata: { salesOrderId: 10, cycleId: 3, cycleNo: 1 },
      },
      {
        id: "normalized-create-rs-10",
        action: "Create Cycle 1 Requirement Sheet",
        documentNo: "SO-26-0001",
        ownerRole: "STORE",
        href: "/planning-dashboard?salesOrderId=10&action=create-next-rs",
        metadata: { salesOrderId: 10, cycleId: 3, cycleNo: 1 },
      },
      {
        id: "store-issue:1",
        action: "Issue Material",
        documentNo: "WO-1",
        ownerRole: "STORE",
        href: "/material-issue",
      },
    ];

    const out = dedupeStoreNoQtyCreateRsBySoCycle(actions);
    const createRs = out.filter((a) => isStoreCreateRsPendingAction(a));
    assert.equal(createRs.length, 1);
    assert.equal(createRs[0].id, "no-qty-create-next-rs:10:3");
    assert.equal(out.filter((a) => a.id === "store-issue:1").length, 1);
  });

  it("does not collapse different cycles on the same SO", () => {
    const a = {
      id: "no-qty-create-next-rs:10:1",
      action: "Create Cycle 1 Requirement Sheet",
      ownerRole: "STORE",
      href: "/x",
      metadata: { salesOrderId: 10, cycleId: 1, cycleNo: 1 },
    };
    const b = {
      id: "no-qty-create-next-rs:10:2",
      action: "Create Cycle 2 Requirement Sheet",
      ownerRole: "STORE",
      href: "/x",
      metadata: { salesOrderId: 10, cycleId: 2, cycleNo: 2 },
    };
    assert.notEqual(storeCreateRsIdentityKey(a), storeCreateRsIdentityKey(b));
    assert.equal(dedupeStoreNoQtyCreateRsBySoCycle([a, b]).length, 2);
  });
});
