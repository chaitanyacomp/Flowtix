import { describe, expect, it } from "vitest";
import {
  isProductionBlockedByRmReadiness,
  resolveRegularRmAllowedNowQty,
  resolveRegularRmEntryQtyCap,
  type ProductionRmReadiness,
} from "../../src/components/erp/ProductionRmReadinessStrip";

function ready(partial: Partial<ProductionRmReadiness> = {}): ProductionRmReadiness {
  return {
    gate: "READY_FOR_PRODUCTION",
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

  it("REGULAR does not clamp RM-supported surplus to WO remaining", () => {
    const data = ready({
      woQty: 5000,
      woRemainingQty: 5000,
      productionAllowedNowQty: 5142,
      maxAdditionalQty: 5142,
      unapprovedProducedQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 5000 })).toBe(5142);
  });

  it("REGULAR cumulative: after 3000 produced, next entry max is RM remainder", () => {
    const data = ready({
      woQty: 5000,
      woRemainingQty: 2000,
      productionAllowedNowQty: 2142,
      maxAdditionalQty: 2142,
      draftAndApprovedQty: 3000,
      unapprovedProducedQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 2000 })).toBe(2142);
  });

  it("returns null when gate blocks production", () => {
    const blocked = ready({ gate: "WAITING_STORE_ISSUE" });
    expect(isProductionBlockedByRmReadiness(blocked)).toBe(true);
    expect(resolveRegularRmAllowedNowQty(blocked)).toBeNull();
    expect(resolveRegularRmEntryQtyCap(blocked, { lineWoRemaining: 5000 })).toBeNull();
  });

  it("does not block READY_FOR_PRODUCTION when RM line status remains partial after store waiver", () => {
    const data = ready({
      productionAllowedNowQty: 4487,
      maxAdditionalQty: 4487,
      rmLines: [{ status: "PARTIAL" } as never],
    });
    expect(isProductionBlockedByRmReadiness(data)).toBe(false);
    expect(resolveRegularRmAllowedNowQty(data)).toBe(4487);
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 5000 })).toBe(4487);
  });

  it("NO_QTY allows approving full draft when RM supports planned WO qty", () => {
    const data = ready({
      orderType: "NO_QTY",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 2500,
      unapprovedProducedQty: 2500,
      maxAdditionalQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, {
      lineWoRemaining: 2500,
      excludeProductionQty: 2500,
    })).toBe(2500);
  });

  it("NO_QTY partial issue caps entry qty to RM-supported amount", () => {
    const data = ready({
      orderType: "NO_QTY",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 1000,
      unapprovedProducedQty: 0,
      maxAdditionalQty: 0,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 2500 })).toBe(1000);
  });

  it("NO_QTY does not clamp RM-supported surplus to WO remaining", () => {
    const data = ready({
      orderType: "NO_QTY",
      woQty: 2000,
      woRemainingQty: 2000,
      productionAllowedNowQty: 2050,
      unapprovedProducedQty: 0,
      maxAdditionalQty: 2050,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 2000 })).toBe(2050);
  });

  it("NO_QTY remaining capacity subtracts other saved drafts, not WO plan", () => {
    const data = ready({
      orderType: "NO_QTY",
      woQty: 2000,
      woRemainingQty: 100,
      productionAllowedNowQty: 150,
      unapprovedProducedQty: 20,
      maxAdditionalQty: 130,
    });
    expect(resolveRegularRmEntryQtyCap(data, { lineWoRemaining: 100 })).toBe(130);
  });
});
