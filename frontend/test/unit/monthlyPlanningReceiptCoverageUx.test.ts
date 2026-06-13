import { describe, expect, it } from "vitest";
import {
  formatPhysicalCoveragePct,
  physicalReceiptCoverageBannerLine,
  physicalReceiptCoverageDetailMessage,
  lookupReceiptCoverageForLine,
} from "../../src/lib/monthlyPlanningReceiptCoverageUx";

describe("monthlyPlanningReceiptCoverageUx", () => {
  it("formatPhysicalCoveragePct renders percent", () => {
    expect(formatPhysicalCoveragePct(61.561)).toBe("61.56%");
  });

  it("physicalReceiptCoverageBannerLine includes label", () => {
    expect(physicalReceiptCoverageBannerLine(61.56)).toBe("Physical receipt coverage: 61.56%");
  });

  it("physicalReceiptCoverageDetailMessage for partial receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(61.56)).toBe(
      "Procurement released. Physical receipts are partially completed.",
    );
  });

  it("physicalReceiptCoverageDetailMessage for full receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(100)).toBe("All planned procurement has been received.");
  });

  it("physicalReceiptCoverageDetailMessage for zero receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(0)).toBe("Procurement released but no receipts recorded.");
  });

  it("lookupReceiptCoverageForLine prefers enriched line fields", () => {
    const row = lookupReceiptCoverageForLine({
      rmItemId: 1,
      poQty: 200,
      receivedQty: 200,
      pendingReceiptQty: 130.87,
      physicalCoveragePct: 60.44,
      receiptCoverageStatus: "PARTIALLY_COVERED",
      receiptCoverageStatusLabel: "Partially Covered",
    });
    expect(row.poQty).toBe(200);
    expect(row.receiptCoverageStatusLabel).toBe("Partially Covered");
  });
});
