import { describe, expect, it } from "vitest";
import {
  UNKNOWN_FG_ITEM_LABEL,
  canTransferAcceptedFgToGeneralStock,
  formatAcceptedFgDispositionConfirmSummary,
  formatAcceptedFgItemHeadline,
  formatAcceptedFgPendingQtyLine,
  formatAcceptedFgSourceLine,
} from "../../src/lib/noQtyFgDispositionDisplay";

describe("noQtyFgDispositionDisplay", () => {
  const sample = {
    itemId: 96,
    itemCode: "FG-001",
    itemName: "HDPE Cap",
    unit: "Nos",
    identityResolved: true,
    quantity: 187,
    acceptedFgPendingDispositionQty: 187,
    workOrderNumber: "WO-26-0003",
    productionBatchNumber: "PE-26-0003",
    cycleReference: "Cycle 2",
  };

  it("shows item name and code instead of Item ID 96", () => {
    const headline = formatAcceptedFgItemHeadline(sample);
    expect(headline).toBe("HDPE Cap – FG-001");
    expect(headline).not.toMatch(/Item ID/i);
    expect(headline).not.toContain("96");
  });

  it("keeps quantity and unit correct", () => {
    expect(formatAcceptedFgPendingQtyLine(sample)).toMatch(/187/);
    expect(formatAcceptedFgPendingQtyLine(sample)).toMatch(/Nos/i);
    expect(formatAcceptedFgPendingQtyLine(sample)).toContain("accepted stock pending disposition");
  });

  it("displays source WO / batch / cycle", () => {
    expect(formatAcceptedFgSourceLine(sample)).toBe(
      "Source: WO-26-0003 · Batch PE-26-0003 · Cycle 2",
    );
  });

  it("uses unknown-item copy when identity is missing (never numeric fallback)", () => {
    const unknown = {
      itemId: 96,
      itemName: null,
      identityResolved: false,
      quantity: 187,
      unit: "Nos",
    };
    expect(formatAcceptedFgItemHeadline(unknown)).toBe(UNKNOWN_FG_ITEM_LABEL);
    expect(formatAcceptedFgItemHeadline(unknown)).not.toContain("96");
    expect(canTransferAcceptedFgToGeneralStock(unknown)).toBe(false);
  });

  it("blocks transfer to general stock without resolved identity", () => {
    expect(canTransferAcceptedFgToGeneralStock(sample)).toBe(true);
    expect(
      canTransferAcceptedFgToGeneralStock({
        itemId: 1,
        itemName: "  ",
        identityResolved: false,
      }),
    ).toBe(false);
  });

  it("confirmation summary includes business identity before apply", () => {
    const summary = formatAcceptedFgDispositionConfirmSummary(sample, "Transfer to general stock");
    expect(summary).toContain("HDPE Cap – FG-001");
    expect(summary).toContain("187");
    expect(summary).toContain("WO-26-0003");
    expect(summary).not.toMatch(/Item ID/i);
  });
});
