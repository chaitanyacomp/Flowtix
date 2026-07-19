const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveAllocationFirstWoStatus,
} = require("../../src/services/materialAvailabilityWorkspaceService");

describe("deriveAllocationFirstWoStatus Issue RM eligibility", () => {
  it("returns AWAITING_RELEASE (not READY_FOR_ISSUE) when PMR issued and WO not released", () => {
    const status = deriveAllocationFirstWoStatus({
      hasWorkOrder: true,
      workOrderReleased: false,
      pmrStatus: {
        openPmrs: [
          {
            id: 1,
            status: "FULLY_ISSUED",
            lines: [{ rmItemId: 10, requiredQty: 5, issuedQty: 5, waivedQty: 0, pendingQty: 0 }],
          },
        ],
      },
      rmLines: [{ rmItemId: 10, requiredQty: 5, freeStockQty: 0, activeAllocatedQty: 0, issuedToProductionQty: 5 }],
    });
    assert.equal(status.key, "AWAITING_RELEASE");
    assert.match(status.nextAction, /Release/i);
  });

  it("returns READY_FOR_ISSUE only when a waiting PMR has remaining qty and free stock", () => {
    const status = deriveAllocationFirstWoStatus({
      hasWorkOrder: true,
      workOrderReleased: false,
      pmrStatus: {
        openPmrs: [
          {
            id: 9,
            status: "REQUESTED",
            lines: [{ rmItemId: 10, requiredQty: 5, issuedQty: 0, waivedQty: 0, pendingQty: 5 }],
          },
        ],
      },
      rmLines: [
        {
          rmItemId: 10,
          requiredQty: 5,
          freeStockQty: 10,
          activeAllocatedQty: 0,
          issuedToProductionQty: 0,
          blockerReason: "Ready for material issue",
        },
      ],
    });
    assert.equal(status.key, "READY_FOR_ISSUE");
  });

  it("does not return READY_FOR_ISSUE when stock is ready but no pending PMR exists", () => {
    const status = deriveAllocationFirstWoStatus({
      hasWorkOrder: true,
      workOrderReleased: false,
      pmrStatus: { openPmrs: [] },
      rmLines: [
        {
          rmItemId: 10,
          requiredQty: 5,
          freeStockQty: 10,
          activeAllocatedQty: 0,
          issuedToProductionQty: 0,
          blockerReason: "Ready for material issue",
        },
      ],
    });
    assert.notEqual(status.key, "READY_FOR_ISSUE");
  });
});
