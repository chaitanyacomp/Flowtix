import { describe, expect, it } from "vitest";
import {
  matchesProductionWorkspaceBucket,
  parseProductionWorkspaceBucket,
} from "../../src/lib/productionWorkspaceBucketFilter";

describe("productionWorkspaceBucketFilter", () => {
  it("parses known bucket tokens", () => {
    expect(parseProductionWorkspaceBucket("readyToStart")).toBe("readyToStart");
    expect(parseProductionWorkspaceBucket("inProgress")).toBe("inProgress");
    expect(parseProductionWorkspaceBucket("other")).toBeNull();
  });

  it("filters ready-to-start rows with zero production", () => {
    const row = {
      workOrderId: 1,
      workOrderNo: "WO-1",
      itemName: "FG",
      requiredQty: 100,
      producedQty: 0,
      balanceQty: 100,
      nextAction: "PRODUCTION_PENDING",
    };
    expect(matchesProductionWorkspaceBucket(row, "readyToStart")).toBe(true);
    expect(matchesProductionWorkspaceBucket(row, "inProgress")).toBe(false);
  });

  it("filters in-progress rows with partial production or running execution", () => {
    const partial = {
      workOrderId: 2,
      workOrderNo: "WO-2",
      itemName: "FG",
      requiredQty: 100,
      producedQty: 40,
      balanceQty: 60,
      nextAction: "PRODUCTION_PENDING",
      productionExecutionStatus: "RUNNING",
    };
    expect(matchesProductionWorkspaceBucket(partial, "inProgress")).toBe(true);
    expect(matchesProductionWorkspaceBucket(partial, "readyToStart")).toBe(false);

    const notStarted = {
      workOrderId: 3,
      workOrderNo: "WO-3",
      itemName: "FG",
      requiredQty: 100,
      producedQty: 0,
      balanceQty: 100,
      nextAction: "PRODUCTION_PENDING",
      productionExecutionStatus: "NOT_STARTED",
    };
    expect(matchesProductionWorkspaceBucket(notStarted, "inProgress")).toBe(false);
  });

  it("excludes RM-blocked not-started rows from readyToStart bucket", () => {
    const waitingRm = {
      workOrderId: 4,
      workOrderNo: "WO-4",
      itemName: "FG",
      requiredQty: 100,
      producedQty: 0,
      balanceQty: 100,
      nextAction: "PRODUCTION_PENDING",
      rmReadinessGate: "WAITING_STORE_ISSUE",
      rmReadyForProduction: false,
    };
    expect(matchesProductionWorkspaceBucket(waitingRm, "readyToStart")).toBe(false);
  });
});
