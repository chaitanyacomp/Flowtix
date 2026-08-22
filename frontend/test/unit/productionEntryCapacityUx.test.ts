import { describe, expect, it } from "vitest";
import {
  PRODUCTION_QUANTITY_COMPLETED_MESSAGE,
  resolveProductionEntryCapacityPhase,
  resolveProductionExtraRmCapacityQty,
  resolveProductionTargetRemainingQty,
} from "../../src/lib/productionEntryCapacityUx";
import { deriveProductionConciseRmLabel } from "../../src/lib/productionRmConciseStatus";
import { shouldHideRegularProductionEntryForReport } from "../../src/lib/regularSoProductionClosureUx";

describe("resolveProductionEntryCapacityPhase", () => {
  it("marks quantity completed when planned is fully produced and extra RM capacity is 0", () => {
    const input = {
      gate: "READY_FOR_PRODUCTION",
      bomMissing: false,
      woQty: 22,
      woRemainingQty: 0,
      approvedProducedQty: 22,
      productionAllowedNowQty: 0,
      maxAdditionalQty: 0,
      rmSupportedCumulativeCapacityQty: 22,
    };
    expect(resolveProductionTargetRemainingQty(input)).toBe(0);
    expect(resolveProductionExtraRmCapacityQty(input)).toBe(0);
    expect(resolveProductionEntryCapacityPhase(input)).toBe("QUANTITY_COMPLETED");
    expect(deriveProductionConciseRmLabel(input as never)).toBe("COMPLETE");
    expect(PRODUCTION_QUANTITY_COMPLETED_MESSAGE).toMatch(/no further production entry allowed/i);
  });

  it("shows Waiting RM when target remaining exists but issued RM capacity is insufficient", () => {
    const input = {
      gate: "READY_FOR_PRODUCTION",
      bomMissing: false,
      woQty: 22,
      woRemainingQty: 8,
      approvedProducedQty: 14,
      productionAllowedNowQty: 0,
      maxAdditionalQty: 0,
      rmSupportedCumulativeCapacityQty: 14,
    };
    expect(resolveProductionTargetRemainingQty(input)).toBe(8);
    expect(resolveProductionEntryCapacityPhase(input)).toBe("WAITING_RM");
    expect(deriveProductionConciseRmLabel(input as never)).toBe("WAITING RM");
  });

  it("allows entry when valid extra-RM production capacity remains after plan is met", () => {
    const input = {
      gate: "READY_FOR_PRODUCTION",
      bomMissing: false,
      woQty: 22,
      woRemainingQty: 0,
      approvedProducedQty: 22,
      productionAllowedNowQty: 5,
      maxAdditionalQty: 5,
      rmSupportedCumulativeCapacityQty: 27,
    };
    expect(resolveProductionExtraRmCapacityQty(input)).toBe(5);
    expect(resolveProductionEntryCapacityPhase(input)).toBe("ENTRY_ALLOWED");
    expect(deriveProductionConciseRmLabel(input as never)).toBe("READY");
  });

  it("keeps report-pending visibility independent of quantity-completed entry lock", () => {
    expect(
      shouldHideRegularProductionEntryForReport({ reportPending: true }),
    ).toBe(true);
    expect(
      shouldHideRegularProductionEntryForReport({ soDemandCovered: true, reportPending: false }),
    ).toBe(true);
    expect(
      resolveProductionEntryCapacityPhase({
        gate: "READY_FOR_PRODUCTION",
        woQty: 22,
        woRemainingQty: 0,
        approvedProducedQty: 22,
        productionAllowedNowQty: 0,
        rmSupportedCumulativeCapacityQty: 22,
      }),
    ).toBe("QUANTITY_COMPLETED");
  });

  it("still waits for RM when store gate is blocked even if remaining is zero", () => {
    expect(
      resolveProductionEntryCapacityPhase({
        gate: "WAITING_STORE_ISSUE",
        woQty: 22,
        woRemainingQty: 0,
        approvedProducedQty: 0,
        productionAllowedNowQty: 0,
      }),
    ).toBe("WAITING_RM");
  });
});
