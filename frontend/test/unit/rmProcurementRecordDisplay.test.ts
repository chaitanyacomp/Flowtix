import { describe, expect, it } from "vitest";
import { formatGrnNo, resolveProcurementRecordSummary } from "../../src/lib/rmProcurementRecordDisplay";
import type { RmPoRow } from "../../src/pages/rmPurchase/rmPurchaseShared";

function completedPo(partial?: Partial<RmPoRow>): RmPoRow {
  return {
    id: 129,
    supplierId: 1,
    supplier: { id: 1, name: "Arihant" },
    status: "COMPLETED",
    supplierPoNumber: "SUP-001",
    lines: [{ id: 1, itemId: 1, qty: "10", item: { id: 1, itemName: "RM", itemCode: "RM1", itemType: "RM" } }],
    grns: [{ id: 130, reversedAt: null, lines: [{ rmPoLineId: 1, receivedQty: "10" }] }],
    ...partial,
  } as RmPoRow;
}

describe("rmProcurementRecordDisplay", () => {
  it("formats GRN number", () => {
    expect(formatGrnNo(130)).toBe("GRN-130");
  });

  it("builds lifecycle summary for completed PO", () => {
    const summary = resolveProcurementRecordSummary(completedPo(), null, "Fully Received");
    expect(summary.poNo).toBe("RMPO-129");
    expect(summary.grnNos).toBe("GRN-130");
    expect(summary.grnStatus).toBe("Fully Received");
    expect(summary.supplierName).toBe("Arihant");
    expect(summary.flowSteps.map((s) => s.title)).toEqual(["Purchase Order", "Goods Receipt", "Stock Posted"]);
  });

  it("uses trace GRN date when available", () => {
    const summary = resolveProcurementRecordSummary(
      completedPo(),
      {
        rmPo: { id: 129, displayNo: "RMPO-129", status: "COMPLETED" },
        supplier: { id: 1, name: "Arihant" },
        grns: [{ id: 130, displayNo: "GRN-130", date: "2026-07-04T00:00:00.000Z" }],
        lines: [],
      },
      "Fully Received",
    );
    expect(summary.grnDate).toBe("04-Jul-2026");
  });
});
