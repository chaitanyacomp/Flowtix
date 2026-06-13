import { describe, expect, it } from "vitest";
import {
  pickWinningSheetPerCycle,
  previousCyclesQtyForItem,
  totalAllCyclesQty,
  totalPreviousCyclesQty,
  type NoQtyRsCycleSummaryEntry,
} from "../../src/lib/noQtyRsCycleSummary";

describe("noQtyRsCycleSummary", () => {
  it("picks draft over locked for the same cycle", () => {
    const winners = pickWinningSheetPerCycle([
      { id: 1, cycleNo: 2, cycleId: 20, version: 1, status: "LOCKED" },
      { id: 2, cycleNo: 2, cycleId: 20, version: 2, status: "DRAFT" },
      { id: 3, cycleNo: 1, cycleId: 10, version: 1, status: "LOCKED" },
    ]);
    expect(winners.map((w) => w.id)).toEqual([3, 2]);
  });

  it("totals previous vs all cycles for cycle-wise RS qty", () => {
    const entries: NoQtyRsCycleSummaryEntry[] = [
      {
        cycleId: 10,
        cycleNo: 1,
        sheetId: 1,
        docNo: "RS-1",
        status: "LOCKED",
        totalNewRequirementQty: 5000,
        qtyByItemId: { 101: 5000 },
      },
      {
        cycleId: 11,
        cycleNo: 2,
        sheetId: 2,
        docNo: "RS-2",
        status: "LOCKED",
        totalNewRequirementQty: 8000,
        qtyByItemId: { 101: 8000 },
      },
      {
        cycleId: 12,
        cycleNo: 3,
        sheetId: 3,
        docNo: "RS-3",
        status: "DRAFT",
        totalNewRequirementQty: 15000,
        qtyByItemId: { 101: 15000 },
      },
    ];
    expect(totalPreviousCyclesQty(entries, 3)).toBe(13000);
    expect(totalAllCyclesQty(entries)).toBe(28000);
    expect(previousCyclesQtyForItem(entries, 101, 3)).toBe(13000);
  });
});
