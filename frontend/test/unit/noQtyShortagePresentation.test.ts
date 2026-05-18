import { describe, expect, it } from "vitest";

import {
  noQtyErpAdjustedPlanningQty,
  noQtyOperatorPendingQtyFromRow,
  noQtyOperatorThirdColumn,
  noQtyIsNextCyclePendingContext,
} from "../../src/lib/noQtyShortagePresentation";

describe("noQtyShortagePresentation", () => {
  it("uses planned − produced for operator pending (not lastShortageQty)", () => {
    expect(
      noQtyOperatorPendingQtyFromRow({
        requiredQty: 4295,
        producedQty: 4100,
        balanceQty: 195,
      }),
    ).toBe(195);
    expect(
      noQtyOperatorThirdColumn({
        orderType: "NO_QTY",
        lastShortageQty: 100,
        nextAction: "NEXT_RS_REQUIRED",
        operationalStatus: { label: "Next Cycle", tone: "carryForward" },
        remainingQty: 195,
        requiredQty: 4295,
        producedQty: 4100,
      }),
    ).toEqual({
      qty: 195,
      header: "Pending",
      label: "Pending qty",
    });
  });

  it("keeps ERP adjusted qty separate for admin", () => {
    expect(noQtyErpAdjustedPlanningQty({ lastShortageQty: 100 })).toBe(100);
  });

  it("does not treat in-production row as next-cycle context", () => {
    expect(
      noQtyIsNextCyclePendingContext({
        orderType: "NO_QTY",
        lastShortageQty: 0,
        nextAction: "PRODUCTION_PENDING",
        operationalStatus: { label: "In Production", tone: "running" },
      }),
    ).toBe(false);
  });
});
