import { describe, expect, it } from "vitest";
import {
  buildProcurementWorkspaceEntryHref,
  countDisplayedRowsForDemandPool,
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
import { PROCUREMENT_TERMS, procurementDemandPoolSectionCopy } from "../../src/lib/procurementTerminology";

describe("procurementWorkspaceQueues", () => {
  const rows = [
    { materialRequirementId: 1, sourceType: "SALES_ORDER" },
    { materialRequirementId: 2, sourceType: "MONTHLY_PLAN" },
    { materialRequirementId: 3, sourceType: "STOCK_REPLENISHMENT" },
    { materialRequirementId: 4, sourceType: "WORK_ORDER_PLANNING" },
  ];

  it("defines three demand pools with Regular SO / No Qty SO / Stock Replenishment labels", () => {
    expect(PROCUREMENT_DEMAND_POOL_TABS.map((t) => t.id)).toEqual([
      "REGULAR_SO",
      "MPRS",
      "STOCK_REPLENISHMENT",
    ]);
    expect(PROCUREMENT_DEMAND_POOL_TABS.map((t) => t.label)).toEqual([
      "Regular SO",
      "No Qty SO",
      "Stock Replenishment",
    ]);
  });

  it("parseDemandPoolParam accepts only known pool keys", () => {
    expect(parseDemandPoolParam("REGULAR_SO")).toBe("REGULAR_SO");
    expect(parseDemandPoolParam("mprs")).toBe("MPRS");
    expect(parseDemandPoolParam("ALL")).toBeNull();
    expect(parseDemandPoolParam("WORK_ORDER_PLANNING")).toBeNull();
  });

  it("SALES_ORDER and legacy WOP rows appear under Regular SO only", () => {
    expect(filterMrsByQueueTab(rows, "REGULAR_SO")).toEqual([rows[0], rows[3]]);
    expect(mrMatchesDemandPool(rows[0], "REGULAR_SO")).toBe(true);
    expect(mrMatchesDemandPool(rows[3], "REGULAR_SO")).toBe(true);
    expect(mrMatchesDemandPool(rows[1], "REGULAR_SO")).toBe(false);
  });

  it("MPRS / MONTHLY_PLAN rows appear only under No Qty SO", () => {
    expect(filterMrsByQueueTab(rows, "MPRS")).toEqual([rows[1]]);
    expect(mrMatchesDemandPool(rows[1], "MPRS")).toBe(true);
    expect(mrMatchesDemandPool(rows[0], "MPRS")).toBe(false);
    expect(mrMatchesDemandPool(rows[3], "MPRS")).toBe(false);
  });

  it("STOCK_REPLENISHMENT rows remain separate", () => {
    expect(filterMrsByQueueTab(rows, "STOCK_REPLENISHMENT")).toEqual([rows[2]]);
    expect(mrMatchesDemandPool(rows[2], "STOCK_REPLENISHMENT")).toBe(true);
    expect(mrMatchesDemandPool(rows[2], "REGULAR_SO")).toBe(false);
    expect(mrMatchesDemandPool(rows[2], "MPRS")).toBe(false);
  });

  it("visible Regular SO row produces Regular SO (1) even when commercial pools are empty", () => {
    const counts = deriveDemandPoolCountsFromWorkspace({
      sections: {
        pendingMaterialRequirements: [
          { materialRequirementId: -261, sourceType: "SALES_ORDER" },
        ],
      },
      pools: {
        REGULAR_SO: { items: [] },
        MPRS: { items: [{ origins: [{ materialRequirementId: 99 }] }] },
        STOCK_REPLENISHMENT: { items: [] },
      },
      summary: { queueCounts: { byDemandPool: { REGULAR_SO: 0, MPRS: 0, STOCK_REPLENISHMENT: 0 } } },
    });
    expect(counts.REGULAR_SO).toBe(1);
    expect(counts.MPRS).toBe(1);
    expect(counts.STOCK_REPLENISHMENT).toBe(0);
  });

  it("visible rows and tab counts agree for each source", () => {
    const pending = [
      { materialRequirementId: 1, sourceType: "SALES_ORDER" },
      { materialRequirementId: 2, sourceType: "SALES_ORDER" },
      { materialRequirementId: 3, sourceType: "MONTHLY_PLAN" },
      { materialRequirementId: 4, sourceType: "STOCK_REPLENISHMENT" },
    ];
    const counts = deriveDemandPoolCountsFromWorkspace({
      sections: { pendingMaterialRequirements: pending },
      pools: {
        REGULAR_SO: { items: [] },
        MPRS: { items: [] },
        STOCK_REPLENISHMENT: { items: [] },
      },
    });
    expect(counts.REGULAR_SO).toBe(countDisplayedRowsForDemandPool(pending, "REGULAR_SO"));
    expect(counts.MPRS).toBe(countDisplayedRowsForDemandPool(pending, "MPRS"));
    expect(counts.STOCK_REPLENISHMENT).toBe(countDisplayedRowsForDemandPool(pending, "STOCK_REPLENISHMENT"));
    expect(counts).toEqual({ REGULAR_SO: 2, MPRS: 1, STOCK_REPLENISHMENT: 1 });
  });

  it("deep-link scoped Regular SO pending does not zero sibling source counts from pools", () => {
    const counts = deriveDemandPoolCountsFromWorkspace({
      sections: {
        pendingMaterialRequirements: [{ materialRequirementId: 10, sourceType: "SALES_ORDER" }],
      },
      pools: {
        REGULAR_SO: { items: [{ origins: [{ materialRequirementId: 10 }] }] },
        MPRS: { items: [{ origins: [{ materialRequirementId: 20 }, { materialRequirementId: 21 }] }] },
        STOCK_REPLENISHMENT: { items: [{ origins: [{ materialRequirementId: 30 }] }] },
      },
    });
    expect(counts.REGULAR_SO).toBe(1);
    expect(counts.MPRS).toBe(2);
    expect(counts.STOCK_REPLENISHMENT).toBe(1);
  });

  it("workspaceQueryForDemandPool keeps Clear Filter / deep-link query shape", () => {
    expect(workspaceQueryForDemandPool("MPRS")).toBe("?demandPool=MPRS&source=monthly-planning");
    expect(workspaceQueryForDemandPool("REGULAR_SO", { salesOrderId: 42 })).toBe(
      "?demandPool=REGULAR_SO&source=sales-orders&salesOrderId=42",
    );
    expect(workspaceQueryForDemandPool("REGULAR_SO")).toBe("?demandPool=REGULAR_SO&source=sales-orders");
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
});

describe("procurementTerminology — workspace source labels", () => {
  it("uses Regular SO / No Qty SO empty-state copy", () => {
    expect(PROCUREMENT_TERMS.DEMAND_POOL_REGULAR_SO).toBe("Regular SO");
    expect(PROCUREMENT_TERMS.DEMAND_POOL_MPRS).toBe("No Qty SO");
    expect(PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_REGULAR_SO).toBe("No Regular SO procurement requirements");
    expect(PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_MPRS).toBe("No No Qty SO procurement requirements");
  });

  it("keeps Monthly Plan wording in No Qty SO section helper/details", () => {
    const copy = procurementDemandPoolSectionCopy("MPRS");
    expect(copy.title).toBe("No Qty SO");
    expect(copy.helper).toMatch(/Monthly Planning|RS cycle/i);
    expect(copy.emptyDetail).toMatch(/Monthly Planning/);
  });
});
