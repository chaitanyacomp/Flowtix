import { describe, expect, it } from "vitest";
import {
  isProductionBlockedByRmReadiness,
  resolveRegularRmAllowedNowQty,
  resolveRegularRmEntryQtyCap,
  type ProductionRmReadiness,
} from "../../src/components/erp/ProductionRmReadinessStrip";

function ready(partial: Partial<ProductionRmReadiness> = {}): ProductionRmReadiness {
  return {
    gate: "FULLY_ISSUED_READY",
    fgItemName: "Widget",
    fgUnit: "Nos",
    woQty: 10000,
    productionAllowedNowQty: 10000,
    maxAdditionalQty: 0,
    latestPmrId: 1,
    latestPmrDocNo: "PMR-1",
    workOrderId: 1,
    rmLines: [],
    ...partial,
  };
}

describe("resolveRegularRmProductionQtyCap", () => {
  it("uses productionAllowedNowQty for display cap (strip headline)", () => {
    expect(resolveRegularRmAllowedNowQty(ready())).toBe(10000);
  });

  it("entry cap uses API woRemainingQty when flat-line remaining is stale zero", () => {
    const data = ready({
      woRemainingQty: 10000,
      draftAndApprovedQty: 0,
      productionAllowedNowQty: 10000,
      maxAdditionalQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 0 })).toBe(10000);
  });

  it("partial WO continuation: new entry cap matches production allowed now headline", () => {
    const data = ready({
      woRemainingQty: 2000,
      draftAndApprovedQty: 3000,
      productionAllowedNowQty: 2000,
      maxAdditionalQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 2000 })).toBe(2000);
    expect(resolveRegularRmAllowedNowQty(data)).toBe(2000);
  });

  it("new entry cap uses RM batch ceiling without double-subtracting prior production", () => {
    const data = ready({
      woRemainingQty: 10000,
      draftAndApprovedQty: 10000,
      productionAllowedNowQty: 10000,
      maxAdditionalQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 10000 })).toBe(10000);
  });

  it("excludes qty on the entry being edited", () => {
    const data = ready({
      woRemainingQty: 10000,
      draftAndApprovedQty: 10000,
      productionAllowedNowQty: 10000,
    });
    expect(
      resolveRegularRmEntryQtyCap(data, {
        lineWoRemaining: 10000,
        excludeProductionQty: 10000,
      }),
    ).toBe(10000);
  });

  it("prefers server maxAdditionalQty when it is tighter than per-batch cap", () => {
    const data = ready({
      woRemainingQty: 5000,
      draftAndApprovedQty: 3000,
      productionAllowedNowQty: 5000,
      maxAdditionalQty: 1500,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 5000 })).toBe(1500);
  });

  it("returns null when gate blocks production", () => {
    const blocked = ready({ gate: "WAITING_STORE_ISSUE" });
    expect(isProductionBlockedByRmReadiness(blocked)).toBe(true);
    expect(resolveRegularRmAllowedNowQty(blocked)).toBeNull();
    expect(resolveRegularRmEntryQtyCap(blocked, { lineWoRemaining: 5000 })).toBeNull();
  });
});
