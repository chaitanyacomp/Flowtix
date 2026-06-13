import { describe, expect, it } from "vitest";
import {
  formatPendingReceiptQtyDisplay,
  formatPhysicalCoveragePct,
  formatReceiptStatusLabel,
  physicalReceiptCoverageBannerLine,
  physicalReceiptCoverageDetailMessage,
  physicalReceiptCoverageSectionIntro,
  lookupReceiptCoverageForLine,
} from "../../src/lib/monthlyPlanningReceiptCoverageUx";

describe("monthlyPlanningReceiptCoverageUx", () => {
  it("formatPhysicalCoveragePct renders percent", () => {
    expect(formatPhysicalCoveragePct(61.561)).toBe("61.56%");
  });

  it("physicalReceiptCoverageBannerLine uses qualified label", () => {
    expect(physicalReceiptCoverageBannerLine(61.56)).toBe("Physical Receipt Coverage %: 61.56%");
  });

  it("physicalReceiptCoverageSectionIntro explains GRN basis", () => {
    expect(physicalReceiptCoverageSectionIntro()).toContain("received qty");
  });

  it("physicalReceiptCoverageDetailMessage for partial receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(61.56)).toBe(
      "Received Qty in progress against the requirement snapshot.",
    );
  });

  it("physicalReceiptCoverageDetailMessage for full receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(100)).toBe(
      "Received Qty meets or exceeds the requirement snapshot.",
    );
  });

  it("physicalReceiptCoverageDetailMessage for over-receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(107)).toBe(
      "Received quantity exceeds approved requirement snapshot.",
    );
  });

  it("physicalReceiptCoverageDetailMessage for zero receipt", () => {
    expect(physicalReceiptCoverageDetailMessage(0)).toBe(
      "Demand Released — no received qty recorded yet.",
    );
  });

  it("formatPendingReceiptQtyDisplay flags over-receipt with positive qty", () => {
    const row = formatPendingReceiptQtyDisplay(-12.5);
    expect(row.overReceived).toBe(true);
    expect(row.value).toBe("12.5");
    expect(row.label).toBe("Over Received Qty");
    expect(row.hint).toContain("exceeds approved requirement snapshot");
  });

  it("formatPendingReceiptQtyDisplay keeps pending label for positive qty", () => {
    const row = formatPendingReceiptQtyDisplay(12.5);
    expect(row.overReceived).toBe(false);
    expect(row.label).toBe("Pending Receipt Qty");
  });

  it("lookupReceiptCoverageForLine prefers enriched line fields", () => {
    const row = lookupReceiptCoverageForLine({
      rmItemId: 1,
      poQty: 200,
      receivedQty: 200,
      pendingReceiptQty: 130.87,
      physicalCoveragePct: 60.44,
      receiptCoverageStatus: "PARTIALLY_COVERED",
      receiptCoverageStatusLabel: "Partially Received",
    });
    expect(row.poQty).toBe(200);
    expect(row.receiptCoverageStatusLabel).toBe("Partially Received");
  });

  it("formatReceiptStatusLabel uses standard receipt statuses", () => {
    expect(formatReceiptStatusLabel("NOT_RECEIVED")).toBe("Pending Receipt");
    expect(formatReceiptStatusLabel("FULLY_COVERED")).toBe("Fully Received");
    expect(formatReceiptStatusLabel("OVER_COVERED")).toBe("Over Received");
  });
});
