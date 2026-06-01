import { describe, expect, it } from "vitest";
import {
  coverageFromOperationalBlockers,
  operationalControlColumnHasContent,
  shouldShowProductionPendingRegularControlCard,
} from "../../src/lib/dashboardOperationalDedup";
import type { OperationalSoAction } from "../../src/lib/operationalBlockers";

describe("dashboardOperationalDedup", () => {
  it("collects SO and WO ids from operational blocker actions", () => {
    const coverage = coverageFromOperationalBlockers([
      {
        key: "wo:237",
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        primaryFgName: "Widget",
        stageLabel: "RM ready in Store",
        actionLabel: "Issue RM to Production",
        actionTo: "/material-issue?workOrderId=237&returnTo=dashboard",
        variant: "blocker",
      } as OperationalSoAction,
    ]);
    expect(coverage.soIds.has(1)).toBe(true);
    expect(coverage.woIds.has(237)).toBe(true);
  });

  it("hides production pending control card when blocker already owns the same SO", () => {
    const coverage = coverageFromOperationalBlockers([
      {
        key: "so:1",
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        primaryFgName: null,
        stageLabel: "RM ready in Store",
        actionLabel: "Issue RM to Production",
        actionTo: "/material-issue?workOrderId=237&returnTo=dashboard",
        variant: "blocker",
      } as OperationalSoAction,
    ]);
    const show = shouldShowProductionPendingRegularControlCard({
      woProdRegularSalesOrderIds: [1],
      hasOperationalBlockerCards: true,
      blockerCoverage: coverage,
      prodQueue: [
        {
          workOrderId: 237,
          workOrderNo: "WO-237",
          salesOrderId: 1,
          itemName: "Widget",
          requiredQty: 5100,
          producedQty: 0,
          balanceQty: 5100,
          status: "PENDING",
          orderType: "NORMAL",
          rmReadinessGate: "WAITING_STORE_ISSUE",
        },
      ],
    });
    expect(show).toBe(false);
  });

  it("keeps production pending control card when another SO still needs shop-floor action", () => {
    const coverage = coverageFromOperationalBlockers([
      {
        key: "so:1",
        salesOrderId: 1,
        salesOrderDocNo: "SO-26-0001",
        primaryFgName: null,
        stageLabel: "RM ready in Store",
        actionLabel: "Issue RM to Production",
        actionTo: "/material-issue?workOrderId=237&returnTo=dashboard",
        variant: "blocker",
      } as OperationalSoAction,
    ]);
    const show = shouldShowProductionPendingRegularControlCard({
      woProdRegularSalesOrderIds: [1, 2],
      hasOperationalBlockerCards: true,
      blockerCoverage: coverage,
      prodQueue: [
        {
          workOrderId: 237,
          workOrderNo: "WO-237",
          salesOrderId: 1,
          itemName: "Widget",
          requiredQty: 5100,
          producedQty: 0,
          balanceQty: 5100,
          status: "PENDING",
          orderType: "NORMAL",
          rmReadinessGate: "WAITING_STORE_ISSUE",
        },
        {
          workOrderId: 300,
          workOrderNo: "WO-300",
          salesOrderId: 2,
          itemName: "Gadget",
          requiredQty: 100,
          producedQty: 0,
          balanceQty: 100,
          status: "IN_PROGRESS",
          orderType: "NORMAL",
          rmReadinessGate: "FULLY_ISSUED_READY",
          rmReadyForProduction: true,
        },
      ],
    });
    expect(show).toBe(true);
  });

  it("operationalControlColumnHasContent is false when all card groups are empty", () => {
    expect(
      operationalControlColumnHasContent({
        neutralCardCount: 0,
        regularCardCount: 0,
        noQtyCardCount: 0,
        hasVisibleNoQtyContinuation: false,
      }),
    ).toBe(false);
  });
});
