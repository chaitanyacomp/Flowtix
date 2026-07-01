/**
 * P16-13E — Dispatch draft lifecycle (delete permission + unlocked draft semantics).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DISPATCH_WRITE_ROLES } = require("../../src/constants/erpRoles");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("../../src/services/salesOrderDispatchAllocation");

describe("dispatchDraftLifecycle", () => {
  it("allows STORE to delete prepared dispatch drafts", () => {
    assert.ok(DISPATCH_WRITE_ROLES.includes("STORE"));
    assert.ok(DISPATCH_WRITE_ROLES.includes("ADMIN"));
  });

  it("operational net dispatch includes unlocked drafts until deleted", () => {
    const withDraft = [
      { itemId: 13, dispatchedQty: 3000, workflowStatus: "UNLOCKED", reversalOfId: null },
    ];
    assert.equal(netDispatchedByItemId(withDraft, DISPATCH_ALLOC_MODE.OPERATIONAL).get(13), 3000);
    assert.equal(netDispatchedByItemId([], DISPATCH_ALLOC_MODE.OPERATIONAL).get(13), undefined);
  });

  it("confirmed net dispatch excludes unlocked drafts", () => {
    const rows = [
      { itemId: 13, dispatchedQty: 3000, workflowStatus: "UNLOCKED", reversalOfId: null },
      { itemId: 13, dispatchedQty: 1000, workflowStatus: "LOCKED", reversalOfId: null },
    ];
    assert.equal(netDispatchedByItemId(rows, DISPATCH_ALLOC_MODE.CONFIRMED).get(13), 1000);
  });
});
