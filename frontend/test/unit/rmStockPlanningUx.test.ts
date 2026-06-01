import { describe, expect, it } from "vitest";
import {
  getRmStockPlanningRowStatus,
  hasReplenishmentShortage,
  isReplenishmentInProgress,
  isRowOrderQtyLocked,
  isRowSelectableForReplenishmentMr,
  isStockSufficientRow,
  REPLENISHMENT_IN_PROGRESS_LABEL,
  STOCK_SUFFICIENT_LABEL,
} from "../../src/lib/rmStockPlanningUx";

describe("rmStockPlanningUx", () => {
  it("treats pending replenishment with zero shortage as in progress", () => {
    expect(
      isReplenishmentInProgress({ pendingReplenishmentQty: 500, shortageQty: 0 }),
    ).toBe(true);
    expect(getRmStockPlanningRowStatus({ pendingReplenishmentQty: 500, shortageQty: 0 })).toBe(
      REPLENISHMENT_IN_PROGRESS_LABEL,
    );
  });

  it("locks order qty when shortage is zero after GRN", () => {
    const row = {
      pendingReplenishmentQty: 0,
      shortageQty: 0,
      usableStock: 600,
      minimumStockQty: 500,
    };
    expect(isRowOrderQtyLocked(row)).toBe(true);
    expect(isStockSufficientRow(row)).toBe(true);
    expect(getRmStockPlanningRowStatus(row)).toBe(STOCK_SUFFICIENT_LABEL);
    expect(isRowSelectableForReplenishmentMr(row, 100)).toBe(false);
  });

  it("allows selection when shortage remains despite pending replenishment", () => {
    expect(
      isReplenishmentInProgress({ pendingReplenishmentQty: 100, shortageQty: 50 }),
    ).toBe(false);
    expect(isRowSelectableForReplenishmentMr({ pendingReplenishmentQty: 100, shortageQty: 50 }, 50)).toBe(true);
    expect(hasReplenishmentShortage({ pendingReplenishmentQty: 100, shortageQty: 50 })).toBe(true);
  });

  it("blocks selection for in-progress rows even with positive order qty", () => {
    expect(
      isRowSelectableForReplenishmentMr({ pendingReplenishmentQty: 200, shortageQty: 0 }, 100),
    ).toBe(false);
  });

  it("allows shortage items without pending replenishment", () => {
    expect(
      isReplenishmentInProgress({ pendingReplenishmentQty: 0, shortageQty: 80 }),
    ).toBe(false);
    expect(isRowSelectableForReplenishmentMr({ pendingReplenishmentQty: 0, shortageQty: 80 }, 80)).toBe(true);
  });

  it("requires positive order qty even when shortage exists", () => {
    expect(isRowSelectableForReplenishmentMr({ pendingReplenishmentQty: 0, shortageQty: 80 }, 0)).toBe(false);
  });
});
