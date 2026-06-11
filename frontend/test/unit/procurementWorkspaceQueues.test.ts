import { describe, expect, it } from "vitest";
import {
  filterMrsByQueueTab,
  PROCUREMENT_QUEUE_TABS,
  workspaceQueryForQueueTab,
} from "../../src/lib/procurementWorkspaceQueues";

describe("procurementWorkspaceQueues", () => {
  const rows = [
    { materialRequirementId: 1, sourceType: "MONTHLY_PLAN" },
    { materialRequirementId: 2, sourceType: "WORK_ORDER_PLANNING" },
    { materialRequirementId: 3, sourceType: "STOCK_REPLENISHMENT" },
  ];

  it("defines four demand-class tabs without Emergency", () => {
    expect(PROCUREMENT_QUEUE_TABS.map((t) => t.id)).toEqual([
      "ALL",
      "MONTHLY_PLAN",
      "WORK_ORDER_PLANNING",
      "STOCK_REPLENISHMENT",
    ]);
  });

  it("filterMrsByQueueTab isolates each demand class", () => {
    expect(filterMrsByQueueTab(rows, "ALL")).toHaveLength(3);
    expect(filterMrsByQueueTab(rows, "MONTHLY_PLAN")).toEqual([rows[0]]);
    expect(filterMrsByQueueTab(rows, "WORK_ORDER_PLANNING")).toEqual([rows[1]]);
    expect(filterMrsByQueueTab(rows, "STOCK_REPLENISHMENT")).toEqual([rows[2]]);
  });

  it("workspaceQueryForQueueTab builds sourceType query param", () => {
    expect(workspaceQueryForQueueTab("ALL")).toBe("");
    expect(workspaceQueryForQueueTab("MONTHLY_PLAN")).toBe("?sourceType=MONTHLY_PLAN");
    expect(workspaceQueryForQueueTab("WORK_ORDER_PLANNING", 42)).toBe(
      "?salesOrderId=42&sourceType=WORK_ORDER_PLANNING",
    );
  });
});
