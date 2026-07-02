import { describe, expect, it } from "vitest";
import {
  buildCompactQueueRowsFromSo,
  readRemainingDispatchableQty,
  readSoTotalRemainingDispatchable,
} from "../../src/lib/dispatchLineQuantities";

describe("dispatchLineQuantities", () => {
  it("fully drafted line shows ready 0 and draft as original qty", () => {
    const rows = buildCompactQueueRowsFromSo({
      orderType: "NORMAL",
      lineStats: [
        {
          lineId: 1,
          itemId: 10,
          itemName: "Dummy Plug",
          remainingDispatchableQty: 0,
          dispatchDraftQty: 1855,
          finalizedDispatchQty: 0,
          originalReadyQty: 1855,
          dispatchStatusLabel: "Draft Saved",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.readyQty).toBe(0);
    expect(rows[0]?.draftQty).toBe(1855);
    expect(rows[0]?.statusLabel).toBe("Draft Saved");
  });

  it("partial draft shows remaining correctly", () => {
    const rows = buildCompactQueueRowsFromSo({
      orderType: "NORMAL",
      lineStats: [
        {
          lineId: 2,
          itemId: 11,
          itemName: "PVC Angle",
          remainingDispatchableQty: 1711,
          dispatchDraftQty: 144,
          finalizedDispatchQty: 0,
          originalReadyQty: 1855,
          dispatchStatusLabel: "Partial Draft",
        },
      ],
    });
    expect(rows[0]?.readyQty).toBe(1711);
    expect(rows[0]?.draftQty).toBe(144);
  });

  it("SO header total uses backend totalRemainingDispatchableQty", () => {
    expect(
      readSoTotalRemainingDispatchable({
        totalRemainingDispatchableQty: 1711,
        lineStats: [
          { remainingDispatchableQty: 0 },
          { remainingDispatchableQty: 1711 },
        ],
      }),
    ).toBe(1711);
  });

  it("readRemainingDispatchableQty falls back to dispatchable alias", () => {
    expect(readRemainingDispatchableQty({ dispatchable: 500 })).toBe(500);
  });
});
