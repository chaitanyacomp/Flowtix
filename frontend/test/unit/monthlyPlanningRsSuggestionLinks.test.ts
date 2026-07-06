import { describe, expect, it } from "vitest";
import { buildNoQtyGuidedHref } from "../../src/lib/noQtyFlowState";

/** Mirrors ProductionPlanTab RS source link guard in MonthlyPlanningWorkspacePage. */
function rsSuggestionSourceHref(src: {
  salesOrderId: number;
  requirementSheetId: number;
  cycleId: number | null;
}): string | null {
  const salesOrderId = Number(src.salesOrderId);
  const requirementSheetId = Number(src.requirementSheetId);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) return null;
  if (!Number.isFinite(requirementSheetId) || requirementSheetId <= 0) return null;
  return buildNoQtyGuidedHref({
    to: `/sales-orders/${salesOrderId}/requirement-sheets`,
    salesOrderId,
    cycleId: src.cycleId,
    requirementSheetId,
    fromStep: "requirement",
  });
}

describe("monthly planning RS suggestion links", () => {
  it("builds guided href when SO and RS ids are present", () => {
    const href = rsSuggestionSourceHref({
      salesOrderId: 42,
      requirementSheetId: 7,
      cycleId: 3,
    });
    expect(href).toContain("/sales-orders/42/requirement-sheets");
    expect(href).toContain("salesOrderId=42");
    expect(href).toContain("cycleId=3");
    expect(href).toContain("requirementSheetId=7");
  });

  it("returns null instead of throwing when ids are missing", () => {
    expect(rsSuggestionSourceHref({ salesOrderId: 0, requirementSheetId: 5, cycleId: null })).toBeNull();
    expect(rsSuggestionSourceHref({ salesOrderId: 10, requirementSheetId: 0, cycleId: null })).toBeNull();
  });
});
