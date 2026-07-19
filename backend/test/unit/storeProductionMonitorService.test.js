const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { toReadOnlyMonitorRow } = require("../../src/services/storeProductionMonitorService");

describe("storeProductionMonitorService", () => {
  it("strips mutation CTA fields from queue rows (Store read-only firewall)", () => {
    const raw = {
      workOrderId: 10,
      workOrderNo: "WO-10",
      itemName: "FG",
      requiredQty: 100,
      producedQty: 40,
      balanceQty: 60,
      actionHref: "/production?salesOrderId=1&workOrderId=10&action=continue",
      openDraftProductionId: 55,
      actionLabel: "Continue Production",
      nextAction: "PRODUCTION_PENDING",
      productionWorkState: "CONTINUE_PRODUCTION",
    };
    const out = toReadOnlyMonitorRow(raw);
    assert.equal(out.readOnly, true);
    assert.equal(out.actionHref, null);
    assert.equal(out.openDraftProductionId, null);
    assert.equal(out.workOrderId, 10);
    assert.equal(out.productionWorkState, "CONTINUE_PRODUCTION");
    assert.equal(out.completedToday, false);
  });

  it("marks completed-today rows without exposing mutation hrefs", () => {
    const out = toReadOnlyMonitorRow(
      {
        workOrderId: 99,
        workOrderNo: "WO-99",
        actionHref: "/production?closeWo=1",
        openDraftProductionId: 1,
        status: "COMPLETED",
      },
      { completedToday: true },
    );
    assert.equal(out.completedToday, true);
    assert.equal(out.monitorBucket, "COMPLETED");
    assert.equal(out.actionHref, null);
    assert.equal(out.openDraftProductionId, null);
  });
});
