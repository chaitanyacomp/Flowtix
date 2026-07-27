import { describe, expect, it } from "vitest";
import {
  STOCK_SUMMARY_USABLE_QTY_TOOLTIP,
  resolveStockSummaryUsableQty,
  sumStockSummaryUsableQty,
} from "../../src/lib/stockSummaryUsableQty";

describe("resolveStockSummaryUsableQty", () => {
  it("FG Store 1 + Scrap 1 shows Usable Qty 1 while Total Accounted stays 2", () => {
    const row = {
      itemType: "FG",
      freeStock: 0,
      fgStore: 1,
      scrap: 1,
      qcHold: 0,
      wip: 0,
      production: 0,
      reservedStock: 0,
      total: 2, // Total Accounted = FG Store + Scrap
    };
    expect(resolveStockSummaryUsableQty(row)).toBe(1);
    expect(row.total).toBe(2);
    expect(row.scrap).toBe(1);
    expect(row.fgStore).toBe(1);
  });

  it("RM usable qty equals Available (freeStock), not Physical or Total Accounted", () => {
    const row = {
      itemType: "RM",
      freeStock: 7,
      reservedStock: 3,
      rmStore: 10,
      fgStore: 0,
      scrap: 2,
      qcHold: 1,
      wip: 0,
      total: 13,
    };
    expect(resolveStockSummaryUsableQty(row)).toBe(7);
  });

  it("never treats scrap, under QC, WIP, or committed as usable", () => {
    expect(
      resolveStockSummaryUsableQty({
        itemType: "FG",
        fgStore: 0,
        freeStock: 99,
        scrap: 5,
        qcHold: 4,
        wip: 3,
      }),
    ).toBe(0);
    expect(
      resolveStockSummaryUsableQty({
        itemType: "RM",
        freeStock: 0,
        reservedStock: 12,
        fgStore: 8,
        scrap: 1,
        wip: 2,
        qcHold: 3,
      }),
    ).toBe(0);
  });

  it("section totals prioritize sum of usable qty", () => {
    expect(
      sumStockSummaryUsableQty([
        { itemType: "FG", fgStore: 1, freeStock: 0 },
        { itemType: "FG", fgStore: 4, freeStock: 0 },
        { itemType: "RM", freeStock: 10, fgStore: 0 },
      ]),
    ).toBe(15);
  });

  it("exposes the usable-qty tooltip copy", () => {
    expect(STOCK_SUMMARY_USABLE_QTY_TOOLTIP).toBe(
      "Usable Qty is stock currently available for new work or dispatch.",
    );
  });
});
