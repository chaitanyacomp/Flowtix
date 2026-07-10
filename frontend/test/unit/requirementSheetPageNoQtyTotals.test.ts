import { describe, expect, it } from "vitest";
import { computeDraftProductionRequired } from "../../src/pages/RequirementSheetPage";

describe("RequirementSheetPage NO_QTY totals", () => {
  it("includes production shortfall even when current requirement is zero (Batch 3C)", () => {
    expect(
      computeDraftProductionRequired(
        {
          requirementQty: "0",
          newWoQty: "0",
          shortfallQty: 52,
          productionShortfallQty: 52,
          availableStockQty: 0,
        } as never,
        true,
      ),
    ).toBe(52);
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

  it("includes QC recovery in total to produce", () => {
    expect(
      computeDraftProductionRequired(
        {
          requirementQty: "10",
          newWoQty: "10",
          productionShortfallQty: 5,
          qcRejectionRecoveryQty: 7,
          availableStockQty: 0,
        } as never,
        true,
      ),
    ).toBe(22);
  });
});
