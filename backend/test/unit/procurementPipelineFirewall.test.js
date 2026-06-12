const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  NO_QTY_PROCUREMENT_DEMAND_CODE,
  isNoQtyOrderType,
  assertNoQtyWoProcurementDemandBlocked,
  assertWorkOrderProcurementDemandAllowed,
} = require("../../src/services/procurementPipelineFirewall");

describe("procurementPipelineFirewall", () => {
  it("isNoQtyOrderType detects NO_QTY only", () => {
    assert.equal(isNoQtyOrderType("NO_QTY"), true);
    assert.equal(isNoQtyOrderType("NORMAL"), false);
    assert.equal(isNoQtyOrderType(null), false);
  });

  it("assertNoQtyWoProcurementDemandBlocked throws for NO_QTY", () => {
    assert.throws(() => assertNoQtyWoProcurementDemandBlocked("NO_QTY"), (e) => {
      assert.equal(e.statusCode, 403);
      assert.equal(e.code, NO_QTY_PROCUREMENT_DEMAND_CODE);
      return true;
    });
    assert.doesNotThrow(() => assertNoQtyWoProcurementDemandBlocked("NORMAL"));
  });

  it("assertWorkOrderProcurementDemandAllowed blocks NO_QTY parent SO", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 5,
          salesOrderId: 99,
          salesOrder: { id: 99, orderType: "NO_QTY" },
        }),
      },
    };
    await assert.rejects(() => assertWorkOrderProcurementDemandAllowed(db, 5), (e) => {
      assert.equal(e.code, NO_QTY_PROCUREMENT_DEMAND_CODE);
      assert.equal(e.statusCode, 403);
      return true;
    });
  });

  it("assertWorkOrderProcurementDemandAllowed allows REGULAR parent SO", async () => {
    const db = {
      workOrder: {
        findUnique: async () => ({
          id: 5,
          salesOrderId: 99,
          salesOrder: { id: 99, orderType: "NORMAL" },
        }),
      },
    };
    const wo = await assertWorkOrderProcurementDemandAllowed(db, 5);
    assert.equal(wo.id, 5);
  });
});
