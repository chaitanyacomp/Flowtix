import { describe, expect, it } from "vitest";

import { buildGreenLevelProductionWorkQueueRows } from "../../src/lib/greenLevelProductionWorkQueue";

describe("greenLevelProductionWorkQueue", () => {
  it("builds row table with open, review, and waiting QA actions", () => {
    const rows = buildGreenLevelProductionWorkQueueRows({
      workOrders: [
        {
          id: 10,
          sourceType: "GREEN_LEVEL_REPLENISHMENT",
          docNo: "WO-10",
          status: "IN_PROGRESS",
          lines: [
            {
              id: 101,
              fgItemId: 1,
              qty: "100",
              approvedProducedQty: 0,
              remainingQty: 100,
              fgItem: { itemName: "Widget A" },
            },
            {
              id: 102,
              fgItemId: 2,
              qty: "50",
              approvedProducedQty: 50,
              remainingQty: 0,
              qcPendingQty: 50,
              fgItem: { itemName: "Widget B" },
            },
          ],
        },
        {
          id: 11,
          sourceType: "GREEN_LEVEL_REPLENISHMENT",
          docNo: "WO-11",
          status: "IN_PROGRESS",
          lines: [
            {
              id: 111,
              fgItemId: 3,
              qty: "20",
              approvedProducedQty: 0,
              remainingQty: 20,
              fgItem: { itemName: "Widget C" },
            },
          ],
        },
      ],
      entries: [
        {
          workflowStatus: "DRAFT",
          workOrderLine: { id: 111, workOrder: { id: 11, sourceType: "GREEN_LEVEL_REPLENISHMENT" } },
        },
      ],
      selectedWorkOrderLineId: 101,
    });

    expect(rows).toHaveLength(3);
    const ready = rows.find((r) => r.workOrderLineId === 101);
    const qc = rows.find((r) => r.workOrderLineId === 102);
    const draft = rows.find((r) => r.workOrderLineId === 111);
    expect(ready?.action).toBe("open");
    expect(ready?.actionLabel).toBe("Open");
    expect(qc?.action).toBe("waiting_qa");
    expect(qc?.readOnly).toBe(true);
    expect(draft?.action).toBe("review");
    expect(draft?.actionLabel).toBe("Review");
  });

  it("ignores non-green-level work orders", () => {
    const rows = buildGreenLevelProductionWorkQueueRows({
      workOrders: [
        {
          id: 1,
          sourceType: "CUSTOMER_REQUIREMENT",
          salesOrderId: 99,
          lines: [{ id: 1, fgItemId: 1, qty: "1", fgItem: { itemName: "X" } }],
        },
      ],
      entries: [],
    });
    expect(rows).toHaveLength(0);
  });
});
