import { describe, expect, it } from "vitest";
import {
  normalizeWoTrackingApiResponse,
  type WoTrackingRow,
  computeWorkOrderTrackingSummaryFromRows,
} from "../../src/lib/woTrackingResponse";

function row(partial: Partial<WoTrackingRow>): WoTrackingRow {
  return {
    workOrderLineId: 1,
    salesOrderId: 1,
    salesOrderNo: "SO-1",
    salesOrderDate: "2026-07-01T00:00:00.000Z",
    customerName: "Acme",
    workOrderId: 10,
    workOrderNo: "WO-10",
    workOrderDate: "2026-07-01T00:00:00.000Z",
    workOrderStatus: "OPEN",
    itemId: 5,
    itemName: "FG",
    orderedQty: 0,
    workOrderQty: 10,
    requiredQty: 10,
    plannedQty: 12,
    producedQty: 0,
    acceptedQty: 0,
    rejectedQty: 0,
    dispatchedQty: 0,
    productionPendingQty: 10,
    qcPendingQty: 0,
    dispatchPendingQty: 0,
    status: "PENDING_PRODUCTION",
    ...partial,
  };
}

describe("WO Tracking ordered qty display contract", () => {
  it("keeps regular SO ordered qty numeric", () => {
    const r = row({ orderType: "REGULAR", orderedQty: 100, orderedQtyBasis: "SO_LINE_QTY" });
    expect(r.orderedQty).toBe(100);
    expect(r.orderedQty == null ? "—" : r.orderedQty).toBe(100);
  });

  it("renders NO_QTY N/A when orderedQty is null", () => {
    const r = row({ orderType: "NO_QTY", orderedQty: null, orderedQtyBasis: "NA" });
    expect(r.orderedQty == null ? "—" : r.orderedQty).toBe("—");
  });

  it("uses plannedQty separately from requiredQty", () => {
    const r = row({ requiredQty: 10, plannedQty: 15, workOrderQty: 10 });
    expect(r.plannedQty ?? r.requiredQty ?? r.workOrderQty).toBe(15);
    expect(r.requiredQty ?? r.workOrderQty).toBe(10);
  });

  it("normalizes API payload with null orderedQty without crashing summary", () => {
    const payload = normalizeWoTrackingApiResponse({
      rows: [row({ orderedQty: null, orderType: "NO_QTY", dispatchPendingQty: 3 })],
      summary: null,
    });
    expect(payload.rows[0].orderedQty).toBeNull();
    const summary = computeWorkOrderTrackingSummaryFromRows(payload.rows);
    expect(summary.pendingDispatchQtySum).toBe(3);
  });
});
