import { describe, expect, it } from "vitest";
import { computeDraftProductionRequired } from "../../src/pages/RequirementSheetPage";

describe("RequirementSheetPage NO_QTY totals", () => {
  it("keeps carry-forward informational when current requirement is zero", () => {
    expect(
      computeDraftProductionRequired(
        {
          requirementQty: "0",
          newWoQty: "0",
          shortfallQty: 52,
          availableStockQty: 0,
        } as never,
        true,
      ),
    ).toBe(0);
  });

  it("includes carry-forward when current requirement is positive", () => {
    expect(
      computeDraftProductionRequired(
        {
          requirementQty: "100",
          newWoQty: "100",
          shortfallQty: 52,
          availableStockQty: 0,
        } as never,
        true,
      ),
    ).toBe(152);
  });
});
