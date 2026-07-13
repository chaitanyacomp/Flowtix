import { describe, expect, it } from "vitest";
import {
  canRaisePurchaseRequestForRow,
  isRowCheckboxEnabled,
  isRowOrderQtyLocked,
  isRowSelectableForReplenishmentMr,
} from "../../src/lib/rmStockPlanningUx";

describe("rmStockPlanningUx", () => {
  it("locks healthy rows (Current >= Minimum) — not selectable", () => {
    const row = {
      currentStock: 600,
      usableStock: 600,
      minimumStockQty: 500,
      suggestedPurchaseQty: 0,
      canRaisePurchaseRequest: false,
      monitorStatus: "HEALTHY" as const,
    };
    expect(isRowOrderQtyLocked(row)).toBe(true);
    expect(isRowCheckboxEnabled(row)).toBe(false);
    expect(isRowSelectableForReplenishmentMr(row, 100)).toBe(false);
  });

  it("enables checkbox only for eligible below-minimum rows with gap", () => {
    const row = {
      currentStock: 40,
      minimumStockQty: 50,
      suggestedPurchaseQty: 10,
      canRaisePurchaseRequest: true,
      eligibleForRequest: true,
      monitorStatus: "BELOW_MINIMUM" as const,
    };
    expect(isRowCheckboxEnabled(row)).toBe(true);
    expect(isRowSelectableForReplenishmentMr(row, 10)).toBe(true);
    expect(isRowSelectableForReplenishmentMr(row, 0)).toBe(false);
  });

  it("blocks selection when open replenishment covers the gap", () => {
    const row = {
      currentStock: 40,
      minimumStockQty: 50,
      openStockReplenishmentQty: 60,
      suggestedPurchaseQty: 0,
      canRaisePurchaseRequest: false,
      monitorStatus: "BELOW_MINIMUM" as const,
    };
    expect(canRaisePurchaseRequestForRow(row)).toBe(false);
    expect(isRowCheckboxEnabled(row)).toBe(false);
  });

  it("requires positive request qty even when eligible", () => {
    expect(
      isRowSelectableForReplenishmentMr(
        {
          currentStock: 40,
          minimumStockQty: 50,
          suggestedPurchaseQty: 10,
          canRaisePurchaseRequest: true,
        },
        0,
      ),
    ).toBe(false);
  });
});
