import { describe, expect, it } from "vitest";
import type { ProductionExecutionSummary } from "../../src/lib/productionExecutionApi";
import {
  CARRY_FORWARD_REASON_OPTIONS,
  formatCarryForwardSuccessMessage,
  formatNoQtyProductionAdvanceMessage,
  formatNoQtyProductionQueueCompleteMessage,
  formatProductionCompletionSuccessMessage,
  formatProductionExecutionFinishSuccessMessage,
  formatWaiveSuccessMessage,
  PAUSE_REASON_OPTIONS,
  productionEntriesRefreshSignature,
  remainingQtyForProductionLine,
  resolveProductionCompletionScenario,
  selectNextNoQtyProductionReadyLine,
  SHORTFALL_DECISION_CHOICES,
  shouldAutoEvaluateProductionCompletion,
  hasPendingShortfallDecision,
  hasPausedShortfallDecision,
  allowsNoQtyProductionEntry,
  shouldBlockNoQtyProductionEntry,
  shouldShowShortfallResolutionPanel,
  PAUSED_SHORTFALL_DECISION_CHOICES,
  shouldShowProductionExecutionPanel,
  WAIVE_REASON_OPTIONS,
  workOrderLinesMetricsSignature,
} from "../../src/lib/productionCompletionUx";

function summary(partial: Partial<ProductionExecutionSummary>): ProductionExecutionSummary {
  return {
    workOrderId: 1,
    workOrderStatus: "IN_PROGRESS",
    executionStatus: "RUNNING",
    plannedQty: 1500,
    producedQty: 0,
    remainderQty: 1500,
    productionPendingQty: 1500,
    hasShortfall: true,
    blockReasons: [],
    resolutionReasons: [],
    lines: [],
    ...partial,
  };
}

describe("productionCompletionUx", () => {
  it("resolves shortfall, complete, and surplus scenarios", () => {
    expect(resolveProductionCompletionScenario(summary({ producedQty: 1350, remainderQty: 150 }))).toBe("SHORTFALL");
    expect(
      resolveProductionCompletionScenario(
        summary({ executionStatus: "SHORTFALL_PENDING", producedQty: 2800, remainderQty: 200 }),
      ),
    ).toBe("SHORTFALL");
    expect(resolveProductionCompletionScenario(summary({ producedQty: 1500, remainderQty: 0 }))).toBe("COMPLETE");
    expect(
      resolveProductionCompletionScenario(summary({ producedQty: 1600, remainderQty: 0, surplusQty: 100 })),
    ).toBe("SURPLUS");
    expect(resolveProductionCompletionScenario(summary({ executionStatus: "BLOCKED" }))).toBe("PAUSED");
  });

  it("auto-evaluates after approval for shortfall, complete, and surplus", () => {
    expect(shouldAutoEvaluateProductionCompletion(summary({ producedQty: 1350, remainderQty: 150 }))).toBe(true);
    expect(shouldAutoEvaluateProductionCompletion(summary({ producedQty: 1500, remainderQty: 0 }))).toBe(true);
    expect(shouldAutoEvaluateProductionCompletion(summary({ producedQty: 0 }))).toBe(false);
  });

  it("formats completion success messages", () => {
    expect(formatWaiveSuccessMessage("WO-26-0004", 4, 150)).toContain("waived/cancelled");
    expect(formatCarryForwardSuccessMessage("WO-26-0004", 4, 150)).toContain("carried forward");
    expect(
      formatProductionCompletionSuccessMessage(summary({ workOrderDocNo: "WO-26-0004", surplusQty: 100 })),
    ).toContain("Extra Production: 100");
    expect(formatProductionExecutionFinishSuccessMessage("WO-26-0004", 4, "WAIVE_BALANCE", 150)).toContain(
      "waived/cancelled",
    );
  });

  it("shows panel when shortfall action is required or production is paused", () => {
    expect(shouldShowProductionExecutionPanel(summary({ producedQty: 1350, remainderQty: 150 }))).toBe(true);
    expect(
      shouldShowProductionExecutionPanel(
        summary({ executionStatus: "SHORTFALL_PENDING", producedQty: 2800, remainderQty: 200 }),
      ),
    ).toBe(true);
    expect(shouldShowProductionExecutionPanel(summary({ executionStatus: "BLOCKED" }))).toBe(true);
    expect(shouldShowProductionExecutionPanel(summary({ executionStatus: "COMPLETED" }))).toBe(false);
  });

  it("persists shortfall decision read model and blocks production entry", () => {
    const pending = summary({
      executionStatus: "SHORTFALL_PENDING",
      pendingShortfallResolution: true,
      producedQty: 2800,
      remainderQty: 200,
    });
    expect(hasPendingShortfallDecision(pending)).toBe(true);
    expect(shouldBlockNoQtyProductionEntry(pending)).toBe(true);
    expect(hasPendingShortfallDecision(summary({ executionStatus: "RUNNING", producedQty: 1000, remainderQty: 2000 }))).toBe(
      false,
    );
    expect(hasPendingShortfallDecision(summary({ executionStatus: "BLOCKED" }))).toBe(false);
  });

  it("paused shortfall after Pause exposes resume/waive/carry resolution panel", () => {
    const paused = summary({
      executionStatus: "BLOCKED",
      producedQty: 2800,
      remainderQty: 200,
      plannedQty: 3000,
    });
    expect(hasPausedShortfallDecision(paused)).toBe(true);
    expect(shouldShowShortfallResolutionPanel(paused)).toBe(true);
    expect(shouldBlockNoQtyProductionEntry(paused)).toBe(true);
    expect(PAUSED_SHORTFALL_DECISION_CHOICES.map((c) => c.id)).toEqual(["resume", "waive", "carry"]);
    expect(hasPausedShortfallDecision(summary({ executionStatus: "BLOCKED", producedQty: 0, remainderQty: 200 }))).toBe(
      false,
    );
  });

  it("allows production entry after pause shortfall resume returns execution to RUNNING", () => {
    const resumed = summary({
      executionStatus: "RUNNING",
      pendingShortfallResolution: false,
      producedQty: 3800,
      remainderQty: 200,
      plannedQty: 4000,
      productionPendingQty: 200,
    });
    expect(hasPendingShortfallDecision(resumed)).toBe(false);
    expect(hasPausedShortfallDecision(resumed)).toBe(false);
    expect(shouldShowShortfallResolutionPanel(resumed)).toBe(false);
    expect(allowsNoQtyProductionEntry(resumed)).toBe(true);
  });

  it("exposes operator reason options for waive, carry forward, and pause", () => {
    expect(WAIVE_REASON_OPTIONS.length).toBeGreaterThan(0);
    expect(CARRY_FORWARD_REASON_OPTIONS.length).toBeGreaterThan(0);
    expect(PAUSE_REASON_OPTIONS.length).toBeGreaterThan(0);
    expect(PAUSE_REASON_OPTIONS.some((r) => /CARRY|WAIVE/i.test(r))).toBe(false);
  });

  it("detects WO line metric changes for refresh signature", () => {
    const before = [{ id: 10, lines: [{ id: 100, approvedProducedQty: 0, remainingQty: 1500 }] }];
    const after = [{ id: 10, lines: [{ id: 100, approvedProducedQty: 1350, remainingQty: 150 }] }];
    expect(workOrderLinesMetricsSignature(before)).not.toBe(workOrderLinesMetricsSignature(after));
  });

  it("detects entry approval in refresh signature", () => {
    const before = [{ id: 5, producedQty: 1350, workflowStatus: "DRAFT" }];
    const after = [{ id: 5, producedQty: 1350, workflowStatus: "APPROVED" }];
    expect(productionEntriesRefreshSignature(before)).not.toBe(productionEntriesRefreshSignature(after));
  });

  it("selects next production-ready line after WO closes", () => {
    const lines = [
      { id: 1, workOrderId: 10, salesOrderId: 5, qty: "1000", approvedProducedQty: 1000, remainingQty: 0 },
      { id: 2, workOrderId: 11, salesOrderId: 5, qty: "800", approvedProducedQty: 0, remainingQty: 800 },
      { id: 3, workOrderId: 12, salesOrderId: 5, qty: "500", approvedProducedQty: 200, remainingQty: 300 },
    ];
    expect(remainingQtyForProductionLine(lines[1])).toBe(800);
    const next = selectNextNoQtyProductionReadyLine({
      lines,
      salesOrderId: 5,
      excludeWorkOrderId: 10,
      qcPendingByWolId: {},
      approvedWolIds: [],
    });
    expect(next?.workOrderId).toBe(11);
    expect(
      selectNextNoQtyProductionReadyLine({
        lines,
        salesOrderId: 5,
        excludeWorkOrderId: 11,
        qcPendingByWolId: { 3: 50 },
        approvedWolIds: [3],
      }),
    ).toBeNull();
  });

  it("exposes compact shortfall decision choices and queue-complete copy", () => {
    expect(SHORTFALL_DECISION_CHOICES.map((c) => c.id)).toEqual(["waive", "carry", "pause"]);
    expect(formatNoQtyProductionQueueCompleteMessage("WO-26-0001")).toContain("WO-26-0001");
    expect(formatNoQtyProductionAdvanceMessage("WO-26-0002", "Dummy Plug")).toContain("Dummy Plug");
  });
});
