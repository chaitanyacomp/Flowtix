import { describe, expect, it } from "vitest";

import {
  classifyInventoryHealth,
  computeDerivedLowStockLevel,
  countRmInventoryHealthAlerts,
  formatRmStockAlertBanner,
  inventoryHealthToRmAlertBand,
} from "../../src/lib/inventoryHealth";

describe("inventoryHealth", () => {
  it("P10-A6B policy cases A–D", () => {
    const min = 100;
    const low = 125;
    // A
    expect(classifyInventoryHealth({ currentQty: 0, minimumStock: 0, lowStockLevel: 0 })).toBe("HEALTHY");
    expect(inventoryHealthToRmAlertBand(classifyInventoryHealth({ currentQty: 0, minimumStock: 0 }))).toBeNull();
    // B
    expect(classifyInventoryHealth({ currentQty: 0, minimumStock: min, lowStockLevel: low })).toBe("CRITICAL");
    // C
    expect(classifyInventoryHealth({ currentQty: 50, minimumStock: min, lowStockLevel: low })).toBe("CRITICAL");
    // D
    expect(classifyInventoryHealth({ currentQty: 120, minimumStock: min, lowStockLevel: low })).toBe("LOW");
    expect(classifyInventoryHealth({ currentQty: 130, minimumStock: min, lowStockLevel: low })).toBe("HEALTHY");
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
