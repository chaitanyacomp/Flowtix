import { describe, expect, it } from "vitest";

import {
  buildGreenLevelProductionQueueRows,
  filterGreenLevelExecutableWorkOrders,
  greenLevelRowAllowsProductionEntry,
  greenLevelRowShowsQcWaiting,
  isGreenLevelProductionEntry,
  productionEntryUsesRmConsumptionReview,
} from "../../src/lib/greenLevelProductionExecution";

describe("greenLevelProductionExecution", () => {
  it("filters work orders to green level replenishment only", () => {
    const rows = filterGreenLevelExecutableWorkOrders([
      { id: 1, sourceType: "GREEN_LEVEL_REPLENISHMENT" },
      { id: 2, sourceType: "CUSTOMER_REQUIREMENT" },
      { id: 3, sourceType: "GREEN_LEVEL_REPLENISHMENT" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([1, 3]);
  });

  it("detects green level production entries by WO source type", () => {
    expect(
      isGreenLevelProductionEntry({
        orderType: "NORMAL",
        workOrderLine: { workOrder: { sourceType: "GREEN_LEVEL_REPLENISHMENT" } },
      }),
    ).toBe(true);
  });

  it("skips RM consumption review for green level entries", () => {
    expect(
      productionEntryUsesRmConsumptionReview({
        orderType: "NORMAL",
        workOrderLine: { workOrder: { sourceType: "GREEN_LEVEL_REPLENISHMENT" } },
      }),
    ).toBe(false);
    expect(
      productionEntryUsesRmConsumptionReview({
        orderType: "NORMAL",
        workOrderLine: { workOrder: { salesOrder: { orderType: "NORMAL" } } },
      }),
    ).toBe(true);
    expect(
      productionEntryUsesRmConsumptionReview({
        orderType: "NO_QTY",
        workOrderLine: { workOrder: { salesOrder: { orderType: "NO_QTY" } } },
      }),
    ).toBe(false);
  });

  it("builds queue rows with open/review/waiting_qa/view actions", () => {
    const rows = buildGreenLevelProductionQueueRows({
      workOrders: [
        {
          id: 10,
          sourceType: "GREEN_LEVEL_REPLENISHMENT",
          docNo: "GL-WO-10",
          status: "RELEASED",
          lines: [
            {
              id: 101,
              qty: "100",
              approvedProducedQty: 0,
              remainingQty: 100,
              qcPendingQty: 0,
              fgItem: { itemName: "Widget A" },
            },
          ],
        },
        {
          id: 11,
          sourceType: "GREEN_LEVEL_REPLENISHMENT",
          docNo: "GL-WO-11",
          status: "RELEASED",
          lines: [
            {
              id: 111,
              qty: "50",
              approvedProducedQty: 50,
              remainingQty: 0,
              qcPendingQty: 20,
              fgItem: { itemName: "Widget B" },
            },
          ],
        },
        {
          id: 12,
          sourceType: "GREEN_LEVEL_REPLENISHMENT",
          docNo: "GL-WO-12",
          status: "COMPLETED",
          lines: [
            {
              id: 121,
              qty: "30",
              approvedProducedQty: 30,
              remainingQty: 0,
              qcPendingQty: 0,
              fgItem: { itemName: "Widget C" },
            },
          ],
        },
      ],
      entries: [
        {
          workflowStatus: "DRAFT",
          workOrderLine: {
            id: 131,
            fgItem: { itemName: "Widget D" },
            workOrder: {
              id: 13,
              sourceType: "GREEN_LEVEL_REPLENISHMENT",
              docNo: "GL-WO-13",
              status: "RELEASED",
            },
          },
        },
      ],
    });

    const ready = rows.find((r) => r.workOrderId === 10);
    expect(ready?.action).toBe("open");
    expect(ready?.actionLabel).toBe("Open");
    expect(greenLevelRowAllowsProductionEntry(ready)).toBe(true);

    const qaPending = rows.find((r) => r.workOrderId === 11);
    expect(qaPending?.action).toBe("waiting_qa");
    expect(greenLevelRowShowsQcWaiting(qaPending)).toBe(true);
    expect(greenLevelRowAllowsProductionEntry(qaPending)).toBe(false);

    const closed = rows.find((r) => r.workOrderId === 12);
    expect(closed?.action).toBe("view");
    expect(closed?.readOnly).toBe(true);

    const draft = rows.find((r) => r.workOrderId === 13);
    expect(draft?.action).toBe("review");
    expect(draft?.actionLabel).toBe("Review");
    expect(greenLevelRowAllowsProductionEntry(draft)).toBe(false);
  });
});
