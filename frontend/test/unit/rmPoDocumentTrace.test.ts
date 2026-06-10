import { describe, expect, it } from "vitest";
import {
  demandSourceDisplay,
  lineBillStatusLabel,
  lineReceiptStatusLabel,
  traceLineByPoLineId,
  type RmPoTracePayload,
} from "../../src/lib/rmPoDocumentTrace";

function sampleTrace(): RmPoTracePayload {
  return {
    rmPo: { id: 101, displayNo: "RMPO-101", status: "COMPLETED", createdAt: "2026-06-10T12:00:00Z" },
    supplier: { id: 13, name: "Arihant" },
    supplierLocation: null,
    grns: [{ id: 101, displayNo: "GRN-101", supplierInvoiceNo: "INV-1", date: "2026-06-10T12:00:00Z" }],
    lines: [
      {
        id: 142,
        item: { id: 1, itemName: "HDPE", unit: "KG" },
        orderedQty: 122.31,
        receivedQty: 122.31,
        pendingQty: 0,
        rate: 50,
        demandSources: [
          {
            demandSourceType: "MONTHLY_PLAN",
            monthlyPlanRevision: 3,
            monthlyPlan: { label: "Monthly Plan Rev 3", periodKey: "2026-07", sourceRevision: 3 },
            mr: { materialRequirementId: 69, docNo: "MR-26-0002" },
            pr: { purchaseRequestId: 30, docNo: "PR-26-0002" },
          },
        ],
        traceChain: ["Monthly Plan Rev 3", "MR-26-0002", "PR-26-0002", "RMPO-101", "GRN-101", "Stock IN"],
        grnLines: [],
        purchaseBillLines: [],
      },
      {
        id: 144,
        item: { id: 1, itemName: "HDPE", unit: "KG" },
        orderedQty: 123.533,
        receivedQty: 123.533,
        pendingQty: 0,
        rate: 50,
        demandSources: [
          {
            demandSourceType: "WORK_ORDER_PLANNING",
            monthlyPlanRevision: null,
            monthlyPlan: null,
            mr: { materialRequirementId: 71, docNo: "MR-26-0004", workOrder: { id: 7, docNo: "WO-7" } },
            pr: { purchaseRequestId: 31, docNo: "PR-26-0003" },
            workOrder: { id: 7, docNo: "WO-7" },
          },
        ],
        traceChain: ["MR-26-0004", "PR-26-0003", "RMPO-101", "GRN-101", "Stock IN"],
        grnLines: [],
        purchaseBillLines: [],
      },
    ],
  };
}

describe("rmPoDocumentTrace", () => {
  it("demandSourceDisplay shows monthly plan revision", () => {
    const ds = sampleTrace().lines[0].demandSources[0];
    expect(demandSourceDisplay(ds)).toBe("Monthly Plan Rev 3");
  });

  it("traceLineByPoLineId finds line by id", () => {
    const line = traceLineByPoLineId(sampleTrace(), 142);
    expect(line?.demandSources[0]?.mr?.docNo).toBe("MR-26-0002");
  });

  it("mixed source PO has multiple demand types", () => {
    const trace = sampleTrace();
    const types = trace.lines.map((l) => l.demandSources[0]?.demandSourceType);
    expect(types).toEqual(["MONTHLY_PLAN", "WORK_ORDER_PLANNING"]);
  });

  it("lineReceiptStatusLabel for full receipt", () => {
    expect(lineReceiptStatusLabel(100, 100, 0)).toBe("Received");
  });

  it("lineReceiptStatusLabel for no GRN", () => {
    expect(lineReceiptStatusLabel(100, 0, 100)).toBe("Pending receipt");
  });

  it("lineBillStatusLabel for no bill", () => {
    expect(lineBillStatusLabel([])).toBe("Not billed");
  });
});
