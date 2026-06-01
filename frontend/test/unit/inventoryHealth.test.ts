import { describe, expect, it } from "vitest";

import {
  classifyInventoryHealth,
  computeDerivedLowStockLevel,
  countRmInventoryHealthAlerts,
  formatRmStockAlertBanner,
} from "../../src/lib/inventoryHealth";

describe("inventoryHealth", () => {
  it("classifies validation cases 1–4", () => {
    const min = 100;
    const low = 125;
    expect(classifyInventoryHealth({ currentQty: 130, minimumStock: min, lowStockLevel: low })).toBe("HEALTHY");
    expect(classifyInventoryHealth({ currentQty: 110, minimumStock: min, lowStockLevel: low })).toBe("LOW");
    expect(classifyInventoryHealth({ currentQty: 90, minimumStock: min, lowStockLevel: low })).toBe("CRITICAL");
    expect(classifyInventoryHealth({ currentQty: 0, minimumStock: min, lowStockLevel: low })).toBe("OUT_OF_STOCK");
  });

  it("buffer 0 derives low level equal to minimum", () => {
    expect(computeDerivedLowStockLevel(100, 0)).toBe(100);
  });

  it("formatRmStockAlertBanner", () => {
    expect(formatRmStockAlertBanner(0, 0)).toBeNull();
    expect(formatRmStockAlertBanner(2, 0)).toBe("Stock replenishment critical: 2 items below minimum");
    expect(formatRmStockAlertBanner(0, 3)).toBe("Replenishment low: 3 items below alert level");
    expect(formatRmStockAlertBanner(1, 2)).toBe("Stock replenishment alerts: 1 critical • 2 low");
  });

  it("countRmInventoryHealthAlerts splits critical and warning", () => {
    const thresholds = new Map([
      [1, { minimumStockQty: "100", minStockLevel: "125" }],
      [2, { minimumStockQty: "100", minStockLevel: "125" }],
    ]);
    const rows = [
      { itemId: 1, item: { itemType: "RM" }, usableQty: 90 },
      { itemId: 2, item: { itemType: "RM" }, usableQty: 110 },
      { itemId: 3, item: { itemType: "FG" }, usableQty: 0 },
    ] as const;
    expect(countRmInventoryHealthAlerts([...rows], thresholds)).toEqual({
      critical: 1,
      warning: 1,
      total: 2,
    });
  });
});
