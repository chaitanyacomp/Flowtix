import { describe, expect, it } from "vitest";
import {
  buildCaseRmMetricsFromDetails,
  groupRmQueueByCase,
  operatorNextActionHint,
  operatorQueueStatus,
  resolveQueueCaseDisplayMetrics,
  rmItemFilterTableHelperText,
} from "../../src/lib/storeRmWorkspaceUx";
import { STORE_PRODUCTION_HANDOFF_LABEL } from "../../src/lib/rmControlCenterPostIssueHandoff";

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

describe("storeRmWorkspaceUx post-issue queue status", () => {
  it("maps READY_TO_RELEASE_WO to production handoff label", () => {
    const status = operatorQueueStatus({
      queueType: "READY_TO_RELEASE_WO",
      shortageAfterReservationQty: 0,
      freeStockQty: 100,
    });
    expect(status.label).toBe(STORE_PRODUCTION_HANDOFF_LABEL);
    expect(status.label).not.toBe("Ready for issue");
    expect(operatorNextActionHint({ queueType: "READY_TO_RELEASE_WO", recommendedAction: "Start production" })).not.toBe(
      "Issue RM to Production",
    );
  });
});
