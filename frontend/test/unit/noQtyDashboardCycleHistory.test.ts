import { describe, expect, it } from "vitest";

import {
  formatNoQtyDashboardHistoryQty,
  isNoQtyHistoryCurrentCycleRow,
} from "../../src/lib/noQtyDashboardCycleHistory";

describe("noQtyDashboardCycleHistory", () => {
  it("shows zero explicitly instead of a dash", () => {
    expect(formatNoQtyDashboardHistoryQty(0)).toBe("0");
    expect(formatNoQtyDashboardHistoryQty(5000)).toBe("5,000");
  });

  it("highlights current cycle row by id or number", () => {
    const row = { cycleNo: 4, cycleId: 40 } as const;
    expect(isNoQtyHistoryCurrentCycleRow(row, { currentCycleId: 40, currentCycleNo: 4 })).toBe(true);
    expect(isNoQtyHistoryCurrentCycleRow(row, { currentCycleId: null, currentCycleNo: 4 })).toBe(true);
    expect(isNoQtyHistoryCurrentCycleRow(row, { currentCycleId: 99, currentCycleNo: 3 })).toBe(false);
  });
});
