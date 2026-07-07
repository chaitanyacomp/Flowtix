const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isShopFloorExecutionWorkOrder,
  resolveWorkOrderOperationalStatus,
  isWorkOrderProductionOperationallyClosed,
  filterWorkOrdersByOperationalClosure,
} = require("../../src/services/workOrderOperationalStatus");

describe("workOrderOperationalStatus", () => {
  it("treats NO_QTY work orders as shop-floor execution scoped", () => {
    assert.equal(
      isShopFloorExecutionWorkOrder({ cycleId: 3, sourceType: null }, { orderType: "NO_QTY" }),
      true,
    );
  });

  it("uses executionStatus as operational authority for shop-floor WOs", () => {
    const op = resolveWorkOrderOperationalStatus(
      {
        status: "PENDING",
        cycleId: 2,
        productionExecution: { executionStatus: "BLOCKED" },
      },
      { orderType: "NO_QTY" },
    );
    assert.equal(op.authority, "EXECUTION_STATUS");
    assert.equal(op.operationalKey, "BLOCKED");
    assert.equal(op.allowsProduction, false);
  });

  it("does not treat WorkOrder.status IN_PROGRESS as production pacing for NO_QTY", () => {
    const op = resolveWorkOrderOperationalStatus(
      {
        status: "IN_PROGRESS",
        cycleId: 2,
        productionExecution: { executionStatus: "RUNNING" },
      },
      { orderType: "NO_QTY" },
    );
    assert.equal(op.workOrderStatus, "IN_PROGRESS");
    assert.equal(op.operationalKey, "RUNNING");
    assert.equal(op.allowsProduction, true);
  });

  it("keeps REGULAR work orders on WorkOrder.status authority", () => {
    const op = resolveWorkOrderOperationalStatus(
      { status: "HOLD", productionExecution: { executionStatus: "RUNNING" } },
      { orderType: "NORMAL" },
    );
    assert.equal(op.authority, "WORK_ORDER_STATUS");
    assert.equal(op.allowsProduction, false);
  });

  it("filters open vs closed lists using execution completion", () => {
    const rows = [
      {
        id: 1,
        status: "PENDING",
        cycleId: 1,
        salesOrder: { orderType: "NO_QTY" },
        productionExecution: { executionStatus: "RUNNING" },
      },
      {
        id: 2,
        status: "PENDING",
        cycleId: 1,
        salesOrder: { orderType: "NO_QTY" },
        productionExecution: { executionStatus: "COMPLETED" },
      },
    ];
    assert.equal(filterWorkOrdersByOperationalClosure(rows).length, 1);
    assert.equal(
      filterWorkOrdersByOperationalClosure(rows, { includeClosed: true }).length,
      1,
    );
    assert.equal(isWorkOrderProductionOperationallyClosed(rows[1], rows[1].salesOrder), true);
  });
});
