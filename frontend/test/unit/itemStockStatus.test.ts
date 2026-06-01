import { describe, expect, it } from "vitest";

import {
  computeItemStockStatus,
  computeLowStockShortageQty,
  countRmLowStockAlerts,
  isRmBelowLowStockAlert,
  itemStockStatusFromItemFields,
} from "../../src/lib/itemStockStatus";

describe("itemStockStatus", () => {
  it("returns HEALTHY when thresholds are unset (0)", () => {
    expect(computeItemStockStatus({ currentQty: 5, minimumStock: 0, lowStockAlert: 0 })).toBe("HEALTHY");
    expect(
      itemStockStatusFromItemFields({ currentQty: 5, minimumStockQty: "", minStockLevel: "0" }),
    ).toBe("HEALTHY");
  });

  it("returns OUT_OF_STOCK when qty is zero", () => {
    expect(computeItemStockStatus({ currentQty: 0, minimumStock: 10, lowStockAlert: 20 })).toBe("OUT_OF_STOCK");
  });

  it("returns CRITICAL when below minimum floor", () => {
    expect(computeItemStockStatus({ currentQty: 4, minimumStock: 10, lowStockAlert: 20 })).toBe("CRITICAL");
  });

  it("returns LOW when below low alert but above minimum", () => {
    expect(computeItemStockStatus({ currentQty: 15, minimumStock: 10, lowStockAlert: 20 })).toBe("LOW");
  });

  it("returns HEALTHY when at or above low alert", () => {
    expect(computeItemStockStatus({ currentQty: 25, minimumStock: 10, lowStockAlert: 20 })).toBe("HEALTHY");
  });

  it("computes shortage as max(0, lowStockLevel - usableStock)", () => {
    expect(computeLowStockShortageQty({ usableStock: 2750, minStockLevel: "6250" })).toBe(3500);
    expect(computeLowStockShortageQty({ usableStock: 7000, minStockLevel: "6250" })).toBe(0);
    expect(computeLowStockShortageQty({ usableStock: 100, minStockLevel: "0" })).toBe(0);
    expect(computeLowStockShortageQty({ usableStock: 100, minStockLevel: null })).toBe(0);
    expect(computeLowStockShortageQty({ usableStock: 0, minStockLevel: "125" })).toBe(125);
  });

  it("isRmBelowLowStockAlert uses critical and warning bands", () => {
    expect(
      isRmBelowLowStockAlert({
        usableStock: 110,
        minimumStockQty: "100",
        minStockLevel: "125",
      }),
    ).toBe(true);
    expect(
      isRmBelowLowStockAlert({
        usableStock: 130,
        minimumStockQty: "100",
        minStockLevel: "125",
      }),
    ).toBe(false);
  });

  it("countRmLowStockAlerts counts RM critical and warning rows", () => {
    const thresholds = new Map([
      [1, { minimumStockQty: "100", minStockLevel: "125" }],
      [2, { minimumStockQty: "100", minStockLevel: "125" }],
    ]);
    const rows = [
      { itemId: 1, item: { itemType: "RM" }, usableQty: 90 },
      { itemId: 2, item: { itemType: "RM" }, usableQty: 110 },
      { itemId: 3, item: { itemType: "FG" }, usableQty: 0 },
    ] as const;
    expect(countRmLowStockAlerts([...rows], thresholds)).toBe(2);
  });
});
