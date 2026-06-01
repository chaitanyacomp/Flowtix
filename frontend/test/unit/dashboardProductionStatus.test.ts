import { describe, expect, it } from "vitest";

import {
  buildDashboardProductionStatusRows,
  inferProductionHrefRoute,
  noQtyShortageAbsorbedByLaterRow,
  operationalStatusFromProductionRow,
  productionStatusShowsProgressBar,
  buildNoQtyCarryContext,
  summarizeDashboardProductionAttention,
  type DashboardProductionStatusSource,
} from "../../src/lib/dashboardProductionStatus";

function row(partial: Partial<DashboardProductionStatusSource> = {}): DashboardProductionStatusSource {
  return {
    workOrderId: 1,
    workOrderNo: "WO-100",
    itemName: "Widget",
    requiredQty: 100,
    producedQty: 0,
    balanceQty: 100,
    orderType: "NORMAL",
    itemId: 10,
    salesOrderId: 5,
    ...partial,
  };
}

describe("operationalStatusFromProductionRow — REGULAR", () => {
  it("labels partially produced when produced and balance remain", () => {
    const s = operationalStatusFromProductionRow(row({ producedQty: 40, balanceQty: 60 }));
    expect(s.label).toBe("Partially Produced");
  });

  it("labels HOLD as on hold instead of running production", () => {
    const s = operationalStatusFromProductionRow(
      row({ status: "HOLD", holdReason: "CUSTOMER_HOLD", producedQty: 40, balanceQty: 60, nextAction: "ON_HOLD" }),
    );
    expect(s.label).toBe("On Hold - Customer hold");
    expect(s.tone).toBe("partial");
  });

  it("labels CLOSED_WITH_SHORTFALL as terminal", () => {
    const s = operationalStatusFromProductionRow(
      row({ status: "CLOSED_WITH_SHORTFALL", producedQty: 40, balanceQty: 60 }),
    );
    expect(s.label).toBe("Shortfall Closed");
    expect(s.tone).toBe("idle");
  });
});

describe("operationalStatusFromProductionRow — NO_QTY", () => {
  const noQty = (partial: Partial<DashboardProductionStatusSource> = {}) =>
    row({ orderType: "NO_QTY", requiredQty: 10000, itemId: 99, salesOrderId: 26, ...partial });

  it("labels next cycle when next RS required and no later WO", () => {
    const r = noQty({
      workOrderId: 168,
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "NEXT_RS_REQUIRED",
      cycleNo: 2,
    });
    const s = operationalStatusFromProductionRow(r, [r]);
    expect(s.label).toBe("Next Cycle");
    expect(s.tone).toBe("carryForward");
    expect(productionStatusShowsProgressBar(s.tone)).toBe(false);
  });

  it("does not show dispatch when dispatchable headroom but href is next RS", () => {
    const href =
      "/sales-orders/26/requirement-sheets?intent=add&source=no_qty_so&salesOrderId=26&from=dashboard_shortage";
    const r = noQty({
      workOrderId: 168,
      producedQty: 8000,
      balanceQty: 2000,
      dispatchableQty: 1200,
      nextAction: "NEXT_RS_REQUIRED",
      actionHref: href,
    });
    const s = operationalStatusFromProductionRow(r, [r]);
    expect(s.label).toBe("Next Cycle");
    expect(inferProductionHrefRoute(href)).toBe("requirement");
  });

  it("labels dispatch pending when href targets dispatch", () => {
    const href = "/dispatch?source=no_qty_so&salesOrderId=26&cycleId=3";
    const r = noQty({
      workOrderId: 170,
      producedQty: 10000,
      balanceQty: 0,
      nextAction: "DISPATCH_PENDING",
      dispatchableQty: 500,
      actionHref: href,
    });
    const s = operationalStatusFromProductionRow(r, [r]);
    expect(s.label).toBe("Dispatch Pending");
    expect(s.tone).toBe("dispatch");
  });

  it("labels carried forward with context when later WO exists", () => {
    const wo167 = noQty({
      workOrderId: 167,
      workOrderNo: "WO-167",
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "NEXT_RS_REQUIRED",
      cycleNo: 1,
    });
    const wo168 = noQty({
      workOrderId: 168,
      workOrderNo: "WO-168",
      producedQty: 0,
      balanceQty: 12000,
      nextAction: "PRODUCTION_PENDING",
      cycleNo: 2,
    });
    const all = [wo167, wo168];
    expect(noQtyShortageAbsorbedByLaterRow(wo167, buildNoQtyCarryContext(all))).toBe(true);
    const s = operationalStatusFromProductionRow(wo167, all);
    expect(s.label).toBe("Carried Forward");
    expect(s.tone).toBe("carriedForward");
    expect(s.contextHint).toBe("Shortage moved to next RS/WO");
  });

  it("labels HOLD as on hold before NO_QTY production routing", () => {
    const r = noQty({
      status: "HOLD",
      holdReason: "MANAGEMENT_HOLD",
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "ON_HOLD",
    });
    const s = operationalStatusFromProductionRow(r, [r]);
    expect(s.label).toBe("On Hold - Management hold");
    expect(s.tone).toBe("partial");
  });
});

describe("buildDashboardProductionStatusRows", () => {
  it("shows only current owner rows and keeps carried-forward rows out of operational cards", () => {
    const wo167 = row({
      workOrderId: 167,
      workOrderNo: "WO-167",
      orderType: "NO_QTY",
      itemId: 99,
      salesOrderId: 26,
      requiredQty: 10000,
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "NEXT_RS_REQUIRED",
      cycleNo: 1,
    });
    const wo168 = row({
      workOrderId: 168,
      workOrderNo: "WO-168",
      orderType: "NO_QTY",
      itemId: 99,
      salesOrderId: 26,
      requiredQty: 12000,
      producedQty: 0,
      balanceQty: 12000,
      nextAction: "PRODUCTION_PENDING",
      cycleNo: 2,
    });
    const built = buildDashboardProductionStatusRows([wo167, wo168], { limit: 8 });
    expect(built.totalInQueue).toBe(2);
    expect(built.activeCount).toBe(1);
    expect(built.activeWorkOrderCount).toBe(1);
    expect(built.carriedForwardCount).toBe(1);
    expect(built.visible).toHaveLength(1);
    expect(built.visible[0].workOrderId).toBe(168);
  });
});

describe("summarizeDashboardProductionAttention", () => {
  it("matches active WO count for KPI", () => {
    const wo167 = row({
      workOrderId: 167,
      orderType: "NO_QTY",
      itemId: 1,
      salesOrderId: 1,
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "NEXT_RS_REQUIRED",
    });
    const wo168 = row({
      workOrderId: 168,
      orderType: "NO_QTY",
      itemId: 1,
      salesOrderId: 1,
      producedQty: 0,
      balanceQty: 5000,
      nextAction: "PRODUCTION_PENDING",
    });
    const s = summarizeDashboardProductionAttention([wo167, wo168]);
    expect(s.activeWorkOrderCount).toBe(1);
    expect(s.carriedForwardLineCount).toBe(1);
  });
});
