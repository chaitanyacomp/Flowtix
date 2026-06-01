import { describe, expect, it } from "vitest";

import {
  aggregateNoQtyOptionalDispatchBySo,
  hasMandatoryNoQtyDispatchBacklog,
  shouldShowNoQtyOptionalDispatchChip,
} from "../../src/lib/noQtyDashboardOptionalDispatch";

describe("noQtyDashboardOptionalDispatch", () => {
  it("aggregates optional dispatch headroom per SO from production queue", () => {
    const m = aggregateNoQtyOptionalDispatchBySo([
      {
        salesOrderId: 26,
        orderType: "NO_QTY",
        dispatchableQty: 8000,
        itemId: 1,
        cycleId: 10,
      },
      {
        salesOrderId: 26,
        orderType: "NO_QTY",
        dispatchableQty: 6000,
        itemId: 2,
        cycleId: 9,
      },
    ]);
    expect(m.get(26)?.qty).toBe(14000);
  });

  it("hides chip when mandatory dispatch backlog exists on Action Required", () => {
    const optional = aggregateNoQtyOptionalDispatchBySo([
      { salesOrderId: 26, orderType: "NO_QTY", dispatchableQty: 14000, itemId: 1 },
    ]);
    const groups = {
      dispatch: [
        {
          key: "d-26",
          salesOrderId: 26,
          orderType: "NO_QTY",
          metricQty: 500,
          customerName: "A",
          itemName: "FG",
          href: "/dispatch",
          group: "DISPATCH" as const,
        },
      ],
    };
    expect(hasMandatoryNoQtyDispatchBacklog(26, groups, null)).toBe(true);
    expect(shouldShowNoQtyOptionalDispatchChip(26, optional, groups, null)).toBeNull();
  });

  it("shows chip when optional qty exists and no mandatory backlog", () => {
    const optional = aggregateNoQtyOptionalDispatchBySo([
      { salesOrderId: 26, orderType: "NO_QTY", dispatchableQty: 14000, itemId: 3 },
    ]);
    const chip = shouldShowNoQtyOptionalDispatchChip(26, optional, { dispatch: [] }, []);
    expect(chip?.qty).toBe(14000);
  });
});
