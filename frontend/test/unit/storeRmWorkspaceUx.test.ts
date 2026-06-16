import { describe, expect, it } from "vitest";
import {
  buildCaseRmMetricsFromDetails,
  groupRmQueueByCase,
  resolveQueueCaseDisplayMetrics,
  rmItemFilterTableHelperText,
} from "../../src/lib/storeRmWorkspaceUx";

describe("storeRmWorkspaceUx case RM metrics", () => {
  it("builds total RM line counts from workspace detail payloads", () => {
    const metrics = buildCaseRmMetricsFromDetails([
      {
        workOrder: { id: 1 },
        rmLines: [
          { rmItemId: 10, shortageAfterReservationQty: 0 },
          { rmItemId: 11, shortageAfterReservationQty: 0 },
        ],
      },
    ]);
    expect(metrics.get("wo-1")).toEqual({ rmLineCount: 2, shortageLineCount: 0 });
  });

  it("prefers detail RM line count over queue row grouping length", () => {
    const grouped = groupRmQueueByCase([
      {
        workOrderId: 1,
        rmItemId: 11,
        queueType: "READY_TO_RELEASE_WO",
        shortageAfterReservationQty: 0,
        freeStockQty: 0,
      },
    ]);
    expect(grouped[0].rmLineCount).toBe(1);
    const metrics = buildCaseRmMetricsFromDetails([
      {
        workOrder: { id: 1 },
        rmLines: [{ shortageAfterReservationQty: 0 }, { shortageAfterReservationQty: 0 }],
      },
    ]);
    const display = resolveQueueCaseDisplayMetrics(grouped[0], metrics);
    expect(display.rmLineCount).toBe(2);
    expect(display.shortageLineCount).toBe(0);
  });

  it("formats RM item filter helper for full-case table display", () => {
    expect(rmItemFilterTableHelperText("PP")).toBe(
      "Filtered by PP. Showing all RM lines for selected work order.",
    );
    expect(rmItemFilterTableHelperText("")).toBeNull();
  });
});
