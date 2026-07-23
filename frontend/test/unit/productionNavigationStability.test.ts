import { describe, expect, it } from "vitest";
import {
  buildRegularExecutableProductionSearch,
  productionScopedUrlAlreadyMatches,
  resolveExtraRmCapacityQty,
  resolveUseRemainingQtyFill,
  shouldHoldProductionIdentityUnresolved,
} from "../../src/lib/productionNavigationStability";
import { PRODUCTION_FLOW_GREEN_LEVEL, PRODUCTION_FLOW_REGULAR } from "../../src/lib/productionFlowContract";

/** Mirrors ProductionPage resolveProductionRegularBack return rules for unit coverage. */
function resolveRegularBackForTest(args: {
  fromParam: string;
  salesOrderId: number;
  workOrderId?: number;
  hasActiveDraft?: boolean;
}): { label: string; to: string } {
  const from = args.fromParam.trim().toLowerCase();
  const woId = Number(args.workOrderId ?? 0);
  if (from === "production-workspace") {
    const qs = new URLSearchParams();
    if (args.hasActiveDraft) qs.set("pwSection", "draftPending");
    if (woId > 0) qs.set("pwFocus", String(woId));
    const q = qs.toString();
    return { label: "Back to Production Workspace", to: q ? `/production?${q}` : "/production" };
  }
  if (from === "pending-actions") return { label: "Back to Pending Actions", to: "/pending-actions" };
  if (from === "work-order-workspace" || from === "work-orders") {
    const qs = new URLSearchParams();
    if (woId > 0) qs.set("workOrderId", String(woId));
    const q = qs.toString();
    return { label: "Back to Work Orders", to: q ? `/work-orders?${q}` : "/work-orders" };
  }
  return { label: "Back to Production Workspace", to: "/production" };
}

describe("productionNavigationStability — flicker guards", () => {
  it("does not hold identity resolving when flow is already REGULAR_SO", () => {
    expect(
      shouldHoldProductionIdentityUnresolved({
        fromNoQtySo: false,
        explicitNoQtyUrlNavigate: false,
        flowParam: PRODUCTION_FLOW_REGULAR,
        focusSoIdValid: true,
        focusSoId: 10,
        soOrderTypeKnown: false,
        woIdFromUrlValid: true,
        initialRefreshDone: true,
        woSalesOrderId: 10,
        woSoOrderTypeKnown: false,
        woIsGreenLevel: false,
        regularFlowToken: PRODUCTION_FLOW_REGULAR,
        greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
      }),
    ).toBe(false);
  });

  it("still waits for initial WO refresh when REGULAR URL pins a WO", () => {
    expect(
      shouldHoldProductionIdentityUnresolved({
        fromNoQtySo: false,
        explicitNoQtyUrlNavigate: false,
        flowParam: PRODUCTION_FLOW_REGULAR,
        focusSoIdValid: true,
        focusSoId: 10,
        soOrderTypeKnown: true,
        woIdFromUrlValid: true,
        initialRefreshDone: false,
        woSalesOrderId: 10,
        woSoOrderTypeKnown: true,
        woIsGreenLevel: false,
        regularFlowToken: PRODUCTION_FLOW_REGULAR,
        greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
      }),
    ).toBe(true);
  });

  it("holds identity when flow is unknown and SO master is not loaded", () => {
    expect(
      shouldHoldProductionIdentityUnresolved({
        fromNoQtySo: false,
        explicitNoQtyUrlNavigate: false,
        flowParam: null,
        focusSoIdValid: true,
        focusSoId: 10,
        soOrderTypeKnown: false,
        woIdFromUrlValid: false,
        initialRefreshDone: true,
        woSalesOrderId: null,
        woSoOrderTypeKnown: true,
        woIsGreenLevel: false,
        regularFlowToken: PRODUCTION_FLOW_REGULAR,
        greenLevelFlowToken: PRODUCTION_FLOW_GREEN_LEVEL,
      }),
    ).toBe(true);
  });

  it("skips navigate when URL already matches WO/line/flow (one click → one navigate)", () => {
    const search = "workOrderId=42&workOrderLineId=99&flow=REGULAR_SO&salesOrderId=10&from=work-orders";
    expect(
      productionScopedUrlAlreadyMatches(search, {
        workOrderId: 42,
        workOrderLineId: 99,
        flow: PRODUCTION_FLOW_REGULAR,
      }),
    ).toBe(true);
    expect(
      productionScopedUrlAlreadyMatches(search, {
        workOrderId: 42,
        workOrderLineId: 100,
        flow: PRODUCTION_FLOW_REGULAR,
      }),
    ).toBe(false);
  });

  it("builds a stable REGULAR production search without cloning volatile params", () => {
    const qs = buildRegularExecutableProductionSearch({
      workOrderId: 42,
      workOrderLineId: 99,
      flow: PRODUCTION_FLOW_REGULAR,
      salesOrderId: 10,
      from: "work-orders",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("workOrderId")).toBe("42");
    expect(params.get("workOrderLineId")).toBe("99");
    expect(params.get("flow")).toBe(PRODUCTION_FLOW_REGULAR);
    expect(params.get("salesOrderId")).toBe("10");
    expect(params.get("from")).toBe("work-orders");
    expect(params.has("liveTick")).toBe(false);
  });

  it("Use Remaining fills WO target remaining, not full RM surplus", () => {
    expect(resolveUseRemainingQtyFill(5000, 5142)).toBe(5000);
    expect(resolveUseRemainingQtyFill(5000, 4000)).toBe(4000);
  });

  it("Extra RM Capacity is RM-supported max minus planned (not Target Remaining)", () => {
    expect(resolveExtraRmCapacityQty(5142, 5000)).toBe(142);
    expect(resolveExtraRmCapacityQty(5000, 5000)).toBe(0);
    expect(resolveExtraRmCapacityQty(4800, 5000)).toBe(0);
  });

  it("Back from Work Orders focuses WO list — never obsolete Create WO via salesOrderId", () => {
    const back = resolveRegularBackForTest({
      fromParam: "work-orders",
      salesOrderId: 10,
      workOrderId: 42,
    });
    expect(back.label).toBe("Back to Work Orders");
    expect(back.to).toBe("/work-orders?workOrderId=42");
    expect(back.to).not.toContain("salesOrderId=");
  });

  it("Back from Production Workspace with draft opens Draft Awaiting Approval", () => {
    const back = resolveRegularBackForTest({
      fromParam: "production-workspace",
      salesOrderId: 10,
      workOrderId: 42,
      hasActiveDraft: true,
    });
    expect(back.label).toBe("Back to Production Workspace");
    expect(back.to).toContain("pwSection=draftPending");
    expect(back.to).toContain("pwFocus=42");
  });

  it("Back from Pending Actions returns to Pending Actions", () => {
    expect(
      resolveRegularBackForTest({ fromParam: "pending-actions", salesOrderId: 1 }).to,
    ).toBe("/pending-actions");
  });
});
