const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWorkOrderMaterialIssueSnapshot,
  STORE_ISSUE_STATUSES,
} = require("../../src/services/productionMaterialRequestService");

describe("NO_QTY Phase 1 — PMR / material issue enablement", () => {
  it("buildWorkOrderMaterialIssueSnapshot does not short-circuit NO_QTY to empty demand", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 22,
          docNo: "WO-22",
          status: "PENDING",
          salesOrder: { id: 1, docNo: "SO-22", orderType: "NO_QTY" },
          lines: [
            {
              id: 101,
              fgItemId: 500,
              qty: "10",
              plannedQty: "10",
              fgItem: { id: 500, itemName: "Nozzle" },
            },
          ],
        }),
      },
      productionEntry: {
        groupBy: async () => [],
        findMany: async () => [],
      },
      materialIssueNote: { findMany: async () => [] },
      materialReturnNote: { findMany: async () => [] },
      bom: {
        findFirst: async () => null,
      },
    };

    const snap = await buildWorkOrderMaterialIssueSnapshot(db, 22, null);
    assert.equal(snap.orderType, "NO_QTY");
    assert.equal(snap.workOrderId, 22);
    assert.ok(Array.isArray(snap.fgLines));
    assert.equal(snap.fgLines.length, 1);
    assert.equal(snap.fgLines[0].plannedQty, 10);
  });

  it("store issue statuses remain REQUESTED / PARTIALLY_ISSUED / FULLY_ISSUED only (no CLOSED)", () => {
    assert.ok(STORE_ISSUE_STATUSES.includes("REQUESTED"));
    assert.ok(STORE_ISSUE_STATUSES.includes("PARTIALLY_ISSUED"));
    assert.equal(STORE_ISSUE_STATUSES.includes("CLOSED"), false);
    assert.equal(STORE_ISSUE_STATUSES.includes("FULLY_ISSUED"), false);
  });
});
