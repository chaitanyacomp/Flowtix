import { describe, expect, it } from "vitest";
import {
  buildProductionWorkspaceStatusCounts,
  classifyProductionQueueBucket,
} from "../../src/lib/productionWorkspaceStatusCards";

describe("productionWorkspaceStatusCards", () => {
  it("classifies shortfall and RM return waiting buckets", () => {
    expect(
      classifyProductionQueueBucket({
        workOrderId: 1,
        workOrderNo: "WO-1",
        itemName: "FG",
        requiredQty: 100,
        producedQty: 80,
        balanceQty: 20,
        nextAction: "PRODUCTION_SHORTFALL_DECISION",
        productionExecutionStatus: "SHORTFALL_PENDING",
      }),
    ).toBe("shortfallDecision");

    const counts = buildProductionWorkspaceStatusCounts(
      [
        {
          workOrderId: 2,
          workOrderNo: "WO-2",
          itemName: "FG",
          requiredQty: 100,
          producedQty: 0,
          balanceQty: 100,
          nextAction: "PRODUCTION_PENDING",
        },
      ],
      [{ workOrderId: 3 }],
    );
    expect(counts.readyToStart).toBe(1);
    expect(counts.waitingRmReturn).toBe(1);
  });
});
