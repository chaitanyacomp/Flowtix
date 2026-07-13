import { describe, expect, it } from "vitest";
import { computeDraftProductionRequired } from "../../src/pages/RequirementSheetPage";

/**
 * UI contract for late PRODUCTION_SHORTFALL sync:
 * CF-only lines (customer demand 0) remain visible and contribute to Total RS Quantity.
 */
describe("RequirementSheet NO_QTY grid — production shortfall carry-forward display", () => {
  it("treats carry-forward-only draft lines as production required", () => {
    const line = {
      itemId: 777,
      itemName: "FG Late CF",
      unit: "Kg",
      requirementQty: "0",
      newWoQty: "0",
      productionShortfallQty: 22,
      shortfallQty: 22,
      qcRejectionRecoveryQty: 0,
      totalRsQty: 22,
    };
    expect(computeDraftProductionRequired(line, true)).toBe(22);
  });

  it("keeps customer demand editable and separate from system shortfall in totals", () => {
    const line = {
      itemId: 501,
      itemName: "FG Merge",
      unit: "Pcs",
      requirementQty: "8",
      newWoQty: "8",
      productionShortfallQty: 12,
      shortfallQty: 12,
      qcRejectionRecoveryQty: 0,
      totalRsQty: 20,
    };
    expect(computeDraftProductionRequired(line, true)).toBe(20);
  });
});
