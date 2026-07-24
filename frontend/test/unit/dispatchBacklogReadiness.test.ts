import { describe, expect, it } from "vitest";
import {
  dispatchReadyRowsFromBacklog,
  filterActionableDispatchBacklogRows,
  type DispatchBacklogRow,
} from "../../src/lib/dispatchBacklog";

function row(dispatchableNow: number): DispatchBacklogRow {
  return {
    salesOrderId: 267,
    salesOrderNo: "SO-267",
    salesOrderDocNo: "SO-26-0001",
    customerName: "Customer",
    itemId: 5705,
    itemName: "FG",
    salesOrderLineId: 370,
    orderType: "NORMAL",
    orderedQty: 10000,
    dispatchedQty: 0,
    pendingQty: 10000,
    dispatchableNow,
    salesOrderDate: "2026-07-24T00:00:00.000Z",
    status: "APPROVED",
  };
}

describe("Store dispatch readiness authority", () => {
  it("Dispatch Ready agrees with Prepare Headroom", () => {
    const backlog = [row(10000)];
    expect(filterActionableDispatchBacklogRows(backlog)).toHaveLength(1);
    expect(dispatchReadyRowsFromBacklog(backlog)).toMatchObject([
      { salesOrderId: 267, salesOrderDocNo: "SO-26-0001", metricQty: 10000 },
    ]);
  });

  it("dispatch draft reservations reduce both displays consistently", () => {
    const backlog = [row(2500)];
    expect(filterActionableDispatchBacklogRows(backlog)[0].dispatchableNow).toBe(2500);
    expect(dispatchReadyRowsFromBacklog(backlog)[0].metricQty).toBe(2500);
  });

  it("zero headroom is absent from both displays", () => {
    const backlog = [row(0)];
    expect(filterActionableDispatchBacklogRows(backlog)).toEqual([]);
    expect(dispatchReadyRowsFromBacklog(backlog)).toEqual([]);
  });
});
