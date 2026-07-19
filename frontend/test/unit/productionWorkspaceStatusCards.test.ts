import { describe, expect, it } from "vitest";
import { buildProductionWorkspaceStatusCounts } from "../../src/lib/productionWorkspaceStatusCards";
import { classifyProductionQueueBucketFromBackend } from "../../src/lib/productionWorkspaceReadinessUx";

describe("productionWorkspaceStatusCards", () => {
  it("classifies shortfall and parallel Store task buckets", () => {
    expect(
      classifyProductionQueueBucketFromBackend({
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

  it("does not count RM-blocked zero-production rows as ready to start", () => {
    expect(
      classifyProductionQueueBucketFromBackend({
        workOrderId: 4,
        workOrderNo: "WO-4",
        itemName: "FG",
        requiredQty: 100,
        producedQty: 0,
        balanceQty: 100,
        nextAction: "PRODUCTION_PENDING",
        rmReadinessGate: "WAITING_STORE_ISSUE",
        rmReadyForProduction: false,
      }),
    ).toBeNull();
  });

  it("Pending QA counts distinct WOs, not production-entry rows", () => {
    const counts = buildProductionWorkspaceStatusCounts(
      [
        {
          workOrderId: 9,
          workOrderNo: "WO-9",
          itemName: "A",
          requiredQty: 10,
          producedQty: 10,
          balanceQty: 0,
          nextAction: "QC_PENDING",
          hasPendingQc: true,
        },
        {
          workOrderId: 9,
          workOrderNo: "WO-9",
          itemName: "B",
          requiredQty: 5,
          producedQty: 5,
          balanceQty: 0,
          nextAction: "QC_PENDING",
          hasPendingQc: true,
        },
      ],
      [],
    );
    expect(counts.pendingQa).toBe(1);
  });
});
