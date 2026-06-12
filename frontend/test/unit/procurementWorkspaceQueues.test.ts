import { describe, expect, it } from "vitest";
import {
  deriveDemandPoolCountsFromPools,
  deriveDemandPoolCountsFromWorkspace,
  filterMrsByQueueTab,
  mrMatchesDemandPool,
  parseDemandPoolParam,
  PROCUREMENT_DEMAND_POOL_TABS,
  workspaceQueryForDemandPool,
} from "../../src/lib/procurementWorkspaceQueues";

describe("procurementWorkspaceQueues", () => {
  const rows = [
    { materialRequirementId: 1, sourceType: "SALES_ORDER" },
    { materialRequirementId: 2, sourceType: "MONTHLY_PLAN" },
    { materialRequirementId: 3, sourceType: "STOCK_REPLENISHMENT" },
    { materialRequirementId: 4, sourceType: "WORK_ORDER_PLANNING" },
  ];

  it("defines three demand pools without a mixed ALL tab", () => {
    expect(PROCUREMENT_DEMAND_POOL_TABS.map((t) => t.id)).toEqual([
      "REGULAR_SO",
      "MPRS",
      "STOCK_REPLENISHMENT",
    ]);
    expect(PROCUREMENT_DEMAND_POOL_TABS.map((t) => t.label)).toEqual([
      "Sales Orders",
      "Monthly Planning",
      "Stock Replenishment",
    ]);
  });

  it("parseDemandPoolParam accepts only known pool keys", () => {
    expect(parseDemandPoolParam("REGULAR_SO")).toBe("REGULAR_SO");
    expect(parseDemandPoolParam("mprs")).toBe("MPRS");
    expect(parseDemandPoolParam("ALL")).toBeNull();
    expect(parseDemandPoolParam("WORK_ORDER_PLANNING")).toBeNull();
  });

  it("filterMrsByQueueTab isolates each demand pool by sourceType", () => {
    expect(filterMrsByQueueTab(rows, "REGULAR_SO")).toEqual([rows[0]]);
    expect(filterMrsByQueueTab(rows, "MPRS")).toEqual([rows[1]]);
    expect(filterMrsByQueueTab(rows, "STOCK_REPLENISHMENT")).toEqual([rows[2]]);
  });

  it("mrMatchesDemandPool rejects legacy WO planning rows for REGULAR_SO pool", () => {
    expect(mrMatchesDemandPool(rows[0], "REGULAR_SO")).toBe(true);
    expect(mrMatchesDemandPool(rows[3], "REGULAR_SO")).toBe(false);
  });

  it("workspaceQueryForDemandPool always includes demandPool", () => {
    expect(workspaceQueryForDemandPool("MPRS")).toBe("?demandPool=MPRS");
    expect(workspaceQueryForDemandPool("REGULAR_SO", { salesOrderId: 42 })).toBe(
      "?demandPool=REGULAR_SO&salesOrderId=42",
    );
  });

  it("deriveDemandPoolCountsFromPools counts unique MR ids per pool", () => {
    const counts = deriveDemandPoolCountsFromPools({
      REGULAR_SO: {
        items: [
          {
            origins: [{ materialRequirementId: 10 }, { materialRequirementId: 10 }],
          },
          { origins: [{ materialRequirementId: 11 }] },
        ],
      },
      MPRS: { items: [{ origins: [{ materialRequirementId: 20 }] }] },
      STOCK_REPLENISHMENT: { items: [] },
    });
    expect(counts).toEqual({ REGULAR_SO: 2, MPRS: 1, STOCK_REPLENISHMENT: 0 });
  });

  it("deriveDemandPoolCountsFromWorkspace prefers pools payload for tab badges", () => {
    const counts = deriveDemandPoolCountsFromWorkspace({
      summary: { queueCounts: { byDemandPool: { REGULAR_SO: 1, MPRS: 0, STOCK_REPLENISHMENT: 0 } } },
      pools: {
        REGULAR_SO: { items: [{ origins: [{ materialRequirementId: 1 }, { materialRequirementId: 2 }] }] },
        MPRS: { items: [{ origins: [{ materialRequirementId: 3 }] }] },
        STOCK_REPLENISHMENT: { items: [] },
      },
    });
    expect(counts).toEqual({ REGULAR_SO: 2, MPRS: 1, STOCK_REPLENISHMENT: 0 });
  });
});
