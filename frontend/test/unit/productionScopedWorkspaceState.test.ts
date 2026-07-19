import { describe, expect, it } from "vitest";

import type { ProductionExecutionSummary } from "../../src/lib/productionExecutionApi";
import {
  coerceExecutionSummaryForWorkOrder,
  executionSummaryMatchesWorkOrder,
  formatScopedWorkOrderCompletionMessage,
  isProductionScopedContextConsistent,
  isScopedWorkOrderClosed,
  parseUrlWorkOrderId,
  resolveStaleScopedProductionNavigation,
  scopedProductionWorkspaceKey,
  scopedWorkOrderHasProducibleLine,
  shouldHideNoQtyAddProductionEntry,
  shouldShowScopedProductionReport,
  type NoQtyLineProducibility,
} from "../../src/lib/productionScopedWorkspaceState";

function summary(partial: Partial<ProductionExecutionSummary>): ProductionExecutionSummary {
  return {
    workOrderId: 1,
    workOrderStatus: "IN_PROGRESS",
    executionStatus: "RUNNING",
    plannedQty: 100,
    producedQty: 50,
    remainderQty: 50,
    productionPendingQty: 50,
    hasShortfall: false,
    blockReasons: [],
    resolutionReasons: [],
    lines: [],
    ...partial,
  };
}

describe("productionScopedWorkspaceState", () => {
  it("drops execution summary when WO id does not match scoped URL", () => {
    const woA = summary({ workOrderId: 10, executionStatus: "COMPLETED" });
    expect(coerceExecutionSummaryForWorkOrder(woA, 20)).toBeNull();
    expect(coerceExecutionSummaryForWorkOrder(woA, 10)).toBe(woA);
  });

  it("does not show production report from stale completed WO A when opening WO B", () => {
    const staleCompleted = summary({ workOrderId: 10, executionStatus: "COMPLETED" });
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 20,
        hasApprovedProductionOnWorkOrder: false,
        navigateNoQtyContext: true,
        executionSummary: staleCompleted,
      }),
    ).toBe(false);
  });

  it("shows production report for the exact closed WO when URL matches", () => {
    const closed = summary({ workOrderId: 20, executionStatus: "COMPLETED" });
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 20,
        hasApprovedProductionOnWorkOrder: false,
        navigateNoQtyContext: true,
        executionSummary: closed,
      }),
    ).toBe(true);
  });

  it("keeps a resumed partial WO in production entry mode even when an entry is approved or Pending QC", () => {
    const resumed = summary({ workOrderId: 20, executionStatus: "RUNNING", producedQty: 1500, remainderQty: 1500 });
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 20,
        hasApprovedProductionOnWorkOrder: true,
        navigateNoQtyContext: true,
        executionSummary: resumed,
      }),
    ).toBe(false);
  });

  it("never shows the final report for a paused WO", () => {
    const paused = summary({ workOrderId: 20, executionStatus: "BLOCKED", producedQty: 1500, remainderQty: 1500 });
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 20,
        hasApprovedProductionOnWorkOrder: true,
        navigateNoQtyContext: true,
        executionSummary: paused,
      }),
    ).toBe(false);
  });

  it("shows production report when equal/extra production parks as SHORTFALL_PENDING", () => {
    const reportPending = summary({
      workOrderId: 20,
      executionStatus: "SHORTFALL_PENDING",
      producedQty: 3075,
      remainderQty: 0,
      surplusQty: 75,
    });
    expect(
      shouldShowScopedProductionReport({
        workOrderId: 20,
        hasApprovedProductionOnWorkOrder: true,
        navigateNoQtyContext: true,
        executionSummary: reportPending,
      }),
    ).toBe(true);
  });

  it("allows a WO line to continue while an earlier entry is Pending QC", () => {
    expect(
      scopedWorkOrderHasProducibleLine(
        [{ workOrderId: 20, workOrderLineId: 2, remainingQty: 1500, qcPendingQty: 1500, isCarryForwardLine: false }],
        20,
      ),
    ).toBe(true);
  });

  it("redirects to dashboard when browser back lands on unknown work order", () => {
    expect(
      resolveStaleScopedProductionNavigation({
        urlWorkOrderId: 99,
        initialRefreshDone: true,
        workOrdersLoaded: true,
        workOrderExists: false,
      }),
    ).toBe("redirect_dashboard");
    expect(
      resolveStaleScopedProductionNavigation({
        urlWorkOrderId: 99,
        initialRefreshDone: false,
        workOrdersLoaded: true,
        workOrderExists: false,
      }),
    ).toBe("stay");
  });

  it("redirects to dashboard when browser back lands on a closed work order", () => {
    expect(
      resolveStaleScopedProductionNavigation({
        urlWorkOrderId: 10,
        initialRefreshDone: true,
        workOrdersLoaded: true,
        workOrderExists: true,
        workOrderStatus: "COMPLETED",
      }),
    ).toBe("redirect_dashboard");
  });

  it("does not show SO-wide completion when opening WO B with producible remaining qty", () => {
    const lines: NoQtyLineProducibility[] = [
      {
        workOrderId: 10,
        workOrderLineId: 100,
        remainingQty: 0,
        qcPendingQty: 0,
        isCarryForwardLine: false,
      },
      {
        workOrderId: 20,
        workOrderLineId: 200,
        remainingQty: 50,
        qcPendingQty: 0,
        isCarryForwardLine: false,
      },
    ];
    expect(scopedWorkOrderHasProducibleLine(lines, 20)).toBe(true);
    expect(
      shouldHideNoQtyAddProductionEntry({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: true,
        effectiveScopedWoId: 20,
        noQtyBlockProductionEntry: false,
        noQtyNextRsReady: false,
        noQtyAllowShopFloorContinue: false,
        approvedForSo: true,
        noQtyAutoPickLinesCount: 0,
        currentWoHasProducibleLine: true,
        currentWoHasApprovedProduction: false,
        currentWoIsClosed: false,
      }),
    ).toBe(false);
  });

  it("shows completion only for scoped WO A after WO A is done, not when WO B is active", () => {
    expect(
      shouldHideNoQtyAddProductionEntry({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: true,
        effectiveScopedWoId: 10,
        noQtyBlockProductionEntry: false,
        noQtyNextRsReady: false,
        noQtyAllowShopFloorContinue: false,
        approvedForSo: true,
        noQtyAutoPickLinesCount: 0,
        currentWoHasProducibleLine: false,
        currentWoHasApprovedProduction: true,
        currentWoIsClosed: false,
      }),
    ).toBe(true);
    expect(
      shouldHideNoQtyAddProductionEntry({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: true,
        effectiveScopedWoId: 20,
        noQtyBlockProductionEntry: false,
        noQtyNextRsReady: false,
        noQtyAllowShopFloorContinue: false,
        approvedForSo: true,
        noQtyAutoPickLinesCount: 0,
        currentWoHasProducibleLine: true,
        currentWoHasApprovedProduction: false,
        currentWoIsClosed: false,
      }),
    ).toBe(false);
  });

  it("detects closed scoped work orders", () => {
    expect(isScopedWorkOrderClosed("COMPLETED")).toBe(true);
    expect(isScopedWorkOrderClosed("IN_PROGRESS")).toBe(false);
  });

  it("keeps context row and WO card aligned with current URL workOrderId", () => {
    expect(
      isProductionScopedContextConsistent({
        urlWorkOrderId: 20,
        effectiveWorkOrderId: 20,
        selectedWorkOrderId: 20,
        contextWorkOrderId: 20,
        summaryWorkOrderId: 20,
      }),
    ).toBe(true);
    expect(
      isProductionScopedContextConsistent({
        urlWorkOrderId: 20,
        effectiveWorkOrderId: 20,
        selectedWorkOrderId: 10,
        contextWorkOrderId: 20,
        summaryWorkOrderId: 10,
      }),
    ).toBe(false);
  });

  it("formats completion message with exact WO number and item", () => {
    expect(formatScopedWorkOrderCompletionMessage("WO-26-0006", "Square Box")).toBe(
      "WO-26-0006 Square Box completed.",
    );
  });

  it("parses workOrderId from URL params", () => {
    const params = new URLSearchParams("workOrderId=42&workOrderLineId=7");
    expect(parseUrlWorkOrderId(params)).toBe(42);
  });

  it("uses distinct panel keys per scoped WO/line", () => {
    expect(scopedProductionWorkspaceKey(10, 100)).not.toBe(scopedProductionWorkspaceKey(20, 200));
    expect(executionSummaryMatchesWorkOrder(summary({ workOrderId: 5 }), 5)).toBe(true);
  });
});
