import { describe, expect, it } from "vitest";
import {
  buildConnectivityReportQuery,
  connectivityBillSummary,
  connectivityGrnHref,
  connectivityPoHref,
  formatConnectivityQty,
  receiptStatusTone,
  type ConnectivityReportRow,
} from "../../src/lib/procurementConnectivityReportUx";

function sampleRow(overrides: Partial<ConnectivityReportRow> = {}): ConnectivityReportRow {
  return {
    rowKey: "101-142-0",
    rmPoId: 101,
    rmPoLineId: 142,
    rmPoDisplayNo: "RMPO-101",
    rmPoStatus: "COMPLETED",
    supplier: { id: 13, name: "Arihant" },
    rmItem: { id: 1, itemName: "HDPE", unit: "KG" },
    orderedQty: 122.31,
    receivedQty: 122.31,
    pendingQty: 0,
    receiptStatus: "RECEIVED",
    receiptStatusLabel: "Received",
    billStatus: "NOT_BILLED",
    billStatusLabel: "Not billed",
    demandSourceType: "MONTHLY_PLAN",
    demandSourceLabel: "Monthly Plan Rev 3",
    monthlyPlanRevision: 3,
    mr: { materialRequirementId: 69, docNo: "MR-26-0002" },
    pr: { purchaseRequestId: 30, docNo: "PR-26-0002" },
    grnSummary: { label: "GRN-101", activeGrnNos: ["GRN-101"], reversedGrnNos: [] },
    stockPosted: { posted: true, label: "Posted — RM Store" },
    purchaseBillLines: [],
    traceChain: ["Monthly Plan Rev 3", "MR-26-0002", "PR-26-0002", "RMPO-101", "GRN-101", "Stock IN"],
    ...overrides,
  };
}

describe("procurementConnectivityReportUx", () => {
  it("buildConnectivityReportQuery maps filters to API params", () => {
    const qs = buildConnectivityReportQuery({
      sourceType: "MONTHLY_PLAN",
      rmItemId: "1",
      supplierId: "13",
      rmPoId: "101",
      mrId: "69",
      prId: "30",
      status: "RECEIVED",
    });
    const p = new URLSearchParams(qs);
    expect(p.get("sourceType")).toBe("MONTHLY_PLAN");
    expect(p.get("rmItemId")).toBe("1");
    expect(p.get("supplierId")).toBe("13");
    expect(p.get("rmPoId")).toBe("101");
    expect(p.get("mrId")).toBe("69");
    expect(p.get("prId")).toBe("30");
    expect(p.get("status")).toBe("RECEIVED");
  });

  it("formatConnectivityQty includes unit", () => {
    expect(formatConnectivityQty(12.5, "KG")).toBe("12.5 KG");
  });

  it("connectivityPoHref points to PO detail", () => {
    expect(connectivityPoHref(sampleRow())).toContain("/rm-po-grn/101");
  });

  it("connectivityGrnHref points to PO GRN context", () => {
    expect(connectivityGrnHref(sampleRow())).toBe("/rm-po-grn/101?from=connectivity-report");
  });

  it("connectivityBillSummary shows not billed when empty", () => {
    expect(connectivityBillSummary(sampleRow())).toBe("Not billed");
  });

  it("receiptStatusTone maps status to classes", () => {
    expect(receiptStatusTone("RECEIVED")).toContain("emerald");
    expect(receiptStatusTone("PARTIALLY_RECEIVED")).toContain("amber");
    expect(receiptStatusTone("PENDING_RECEIPT")).toContain("slate");
  });

  it("trace chain on sample row is non-empty for expand UI", () => {
    const row = sampleRow();
    expect(row.traceChain.length).toBeGreaterThan(3);
    expect(row.traceChain[0]).toBe("Monthly Plan Rev 3");
  });
});
