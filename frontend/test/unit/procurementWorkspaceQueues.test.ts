import { describe, expect, it } from "vitest";
import {
  buildProcurementWorkspaceEntryHref,
  deriveDemandPoolCountsFromPools,
  deriveDemandPoolCountsFromWorkspace,
  deriveQueueCountsFromMrs,
  filterMrsByQueueTab,
  mrMatchesDemandPool,
  parseDemandPoolParam,
  parseProcurementWorkspaceDemandPool,
  preferProcurementDemandPoolFromCounts,
  PROCUREMENT_DEMAND_POOL_TABS,
  resolveDemandPoolForMaterialRequirementInWorkspace,
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

  it("workspaceQueryForDemandPool always includes demandPool and source alias", () => {
    expect(workspaceQueryForDemandPool("MPRS")).toBe("?demandPool=MPRS&source=monthly-planning");
    expect(workspaceQueryForDemandPool("REGULAR_SO", { salesOrderId: 42 })).toBe(
      "?demandPool=REGULAR_SO&source=sales-orders&salesOrderId=42",
    );
    expect(workspaceQueryForDemandPool("STOCK_REPLENISHMENT")).toBe(
      "?demandPool=STOCK_REPLENISHMENT&source=stock-replenishment",
    );
  });

  it("workspaceQueryForDemandPool passes materialRequirementId for MPRS but not salesOrderId", () => {
    expect(workspaceQueryForDemandPool("MPRS", { salesOrderId: 1, materialRequirementId: 101 })).toBe(
      "?demandPool=MPRS&source=monthly-planning&materialRequirementId=101",
    );
    expect(workspaceQueryForDemandPool("REGULAR_SO", { salesOrderId: 1, materialRequirementId: 101 })).toBe(
      "?demandPool=REGULAR_SO&source=sales-orders&salesOrderId=1",
    );
  });

  it("parseProcurementWorkspaceDemandPool reads demandPool and source aliases", () => {
    expect(parseProcurementWorkspaceDemandPool(new URLSearchParams("demandPool=MPRS"))).toBe("MPRS");
    expect(parseProcurementWorkspaceDemandPool(new URLSearchParams("source=monthly-planning"))).toBe("MPRS");
    expect(parseProcurementWorkspaceDemandPool(new URLSearchParams("source=sales-orders"))).toBe("REGULAR_SO");
    expect(
      parseProcurementWorkspaceDemandPool(new URLSearchParams("source=stock-replenishment")),
    ).toBe("STOCK_REPLENISHMENT");
  });

  it("preferProcurementDemandPoolFromCounts picks first non-empty pool", () => {
    expect(
      preferProcurementDemandPoolFromCounts({ REGULAR_SO: 0, MPRS: 2, STOCK_REPLENISHMENT: 0 }),
    ).toBe("MPRS");
    expect(
      preferProcurementDemandPoolFromCounts({ REGULAR_SO: 0, MPRS: 0, STOCK_REPLENISHMENT: 3 }),
    ).toBe("STOCK_REPLENISHMENT");
    expect(preferProcurementDemandPoolFromCounts({ REGULAR_SO: 0, MPRS: 0, STOCK_REPLENISHMENT: 0 })).toBe(
      "REGULAR_SO",
    );
  });

  it("buildProcurementWorkspaceEntryHref opens correct tab for each demand pool", () => {
    expect(
      buildProcurementWorkspaceEntryHref({
        demandPool: "MPRS",
        materialRequirementId: 201,
        returnTo: "pending-actions",
      }),
    ).toContain("demandPool=MPRS");
    expect(
      buildProcurementWorkspaceEntryHref({
        demandPool: "MPRS",
        materialRequirementId: 201,
        returnTo: "pending-actions",
      }),
    ).toContain("source=monthly-planning");
    expect(
      buildProcurementWorkspaceEntryHref({
        demandPool: "REGULAR_SO",
        salesOrderId: 12,
      }),
    ).toContain("demandPool=REGULAR_SO");
    expect(
      buildProcurementWorkspaceEntryHref({
        demandPool: "STOCK_REPLENISHMENT",
      }),
    ).toContain("demandPool=STOCK_REPLENISHMENT");
  });

  it("buildProcurementWorkspaceEntryHref infers MPRS from monthly planning rows", () => {
    const href = buildProcurementWorkspaceEntryHref({
      rows: [{ materialRequirementId: 55, sourceType: "MONTHLY_PLAN" }],
      queueCounts: deriveQueueCountsFromMrs([{ materialRequirementId: 55, sourceType: "MONTHLY_PLAN" }]),
    });
    expect(href).toContain("demandPool=MPRS");
    expect(href).toContain("source=monthly-planning");
  });

  it("resolveDemandPoolForMaterialRequirementInWorkspace finds MR pool from workspace pools", () => {
    const pool = resolveDemandPoolForMaterialRequirementInWorkspace(
      {
        pools: {
          REGULAR_SO: { items: [] },
          MPRS: { items: [{ origins: [{ materialRequirementId: 77 }] }] },
          STOCK_REPLENISHMENT: { items: [] },
        },
      },
      77,
    );
    expect(pool).toBe("MPRS");
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
