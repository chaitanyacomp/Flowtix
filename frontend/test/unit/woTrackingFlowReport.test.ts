import { describe, expect, it } from "vitest";
import {
  buildWorkOrderTrackingQuery,
  normalizeWoTrackingApiResponse,
  type WoTrackingRow,
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
    workOrderStatus: "IN_PROGRESS",
    itemId: 5,
    itemName: "FG",
    orderedQty: 100,
    workOrderQty: 100,
    requiredQty: 100,
    plannedQty: 100,
    producedQty: 40,
    acceptedQty: 30,
    rejectedQty: 0,
    dispatchedQty: 10,
    productionPendingQty: 60,
    qcPendingQty: 10,
    dispatchPendingQty: 20,
    status: "IN_PRODUCTION",
    ...partial,
  };
}

describe("WO Tracking flow selector & query", () => {
  it("builds flow + Active Only / Include Closed query", () => {
    expect(buildWorkOrderTrackingQuery("REGULAR", false)).toBe("flow=REGULAR");
    expect(buildWorkOrderTrackingQuery("NO_QTY", true)).toBe("flow=NO_QTY&includeClosed=true");
  });

  it("normalizes Regular payload with Ordered Qty and empty message", () => {
    const payload = normalizeWoTrackingApiResponse({
      flow: "REGULAR",
      includeClosed: false,
      rows: [row({ flow: "REGULAR", orderedQty: 100 })],
      summary: null,
    });
    expect(payload.flow).toBe("REGULAR");
    expect(payload.rows[0].orderedQty).toBe(100);
    expect(payload.emptyMessage).toMatch(/Regular Sales Order/i);
  });

  it("normalizes NO_QTY payload with Customer Demand and no Ordered Qty", () => {
    const payload = normalizeWoTrackingApiResponse(
      {
        flow: "NO_QTY",
        includeClosed: false,
        rows: [
          row({
            flow: "NO_QTY",
            orderedQty: null,
            customerDemandQty: 80,
            activeProductionPendingQty: 0,
            productionPendingQty: 0,
            activeDispatchPendingQty: 0,
            dispatchPendingQty: 0,
            recoveryCarryForwardOutcome: "NONE",
            requirementSheetNo: "RS-9",
            cycleNo: 1,
            status: "COMPLETED",
          }),
        ],
        emptyMessage: "No active NO_QTY work orders found for the selected filters.",
      },
      "NO_QTY",
    );
    expect(payload.flow).toBe("NO_QTY");
    expect(payload.rows[0].orderedQty).toBeNull();
    expect(payload.rows[0].customerDemandQty).toBe(80);
    expect(payload.emptyMessage).toMatch(/active NO_QTY/i);
  });
});
