import { describe, expect, it } from "vitest";
import {
  isProductionReportCloseDecision,
  productionStageLabelForReportPending,
  shouldClearProductionReportTransition,
  shouldForceProductionReportTransition,
  shouldHideContinueWhileProductionReportPending,
  shouldIgnoreClearedExecutionSummaryDuringReportTransition,
} from "../../src/lib/productionReportTransition";

describe("productionReportTransition", () => {
  it("treats End with Shortage and zero remaining as close decisions", () => {
    expect(
      isProductionReportCloseDecision({ remainingAfterEntry: 150, disposition: "END_WITH_SHORTAGE" }),
    ).toBe(true);
    expect(isProductionReportCloseDecision({ remainingAfterEntry: 0, disposition: "PAUSE" })).toBe(true);
    expect(
      isProductionReportCloseDecision({ remainingAfterEntry: 150, disposition: "CONTINUE" }),
    ).toBe(false);
    expect(isProductionReportCloseDecision({ remainingAfterEntry: 150, disposition: "PAUSE" })).toBe(false);
  });

  it("forces the Opening Report gate for the closing WO until selection catches up", () => {
    expect(
      shouldForceProductionReportTransition({ transitionWorkOrderId: 10, effectiveScopedWoId: 0 }),
    ).toBe(true);
    expect(
      shouldForceProductionReportTransition({ transitionWorkOrderId: 10, effectiveScopedWoId: 10 }),
    ).toBe(true);
    expect(
      shouldForceProductionReportTransition({ transitionWorkOrderId: 10, effectiveScopedWoId: 99 }),
    ).toBe(false);
    expect(
      shouldForceProductionReportTransition({ transitionWorkOrderId: 0, effectiveScopedWoId: 10 }),
    ).toBe(false);
  });

  it("clears the gate only when compact report layout is showing", () => {
    expect(
      shouldClearProductionReportTransition({
        transitionWorkOrderId: 10,
        showProductionReport: true,
        showCompactClosureLayout: false,
      }),
    ).toBe(false);
    expect(
      shouldClearProductionReportTransition({
        transitionWorkOrderId: 10,
        showProductionReport: true,
        showCompactClosureLayout: true,
      }),
    ).toBe(true);
  });

  it("ignores null execution-summary clears during the transition", () => {
    expect(
      shouldIgnoreClearedExecutionSummaryDuringReportTransition({
        transitionWorkOrderId: 10,
        summary: null,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreClearedExecutionSummaryDuringReportTransition({
        transitionWorkOrderId: 10,
        summary: { workOrderId: 10, executionStatus: "SHORTFALL_PENDING" },
      }),
    ).toBe(false);
    expect(
      shouldIgnoreClearedExecutionSummaryDuringReportTransition({
        transitionWorkOrderId: 0,
        summary: null,
      }),
    ).toBe(false);
  });

  it("hides Continue while mandatory Production Report is pending or open", () => {
    expect(
      shouldHideContinueWhileProductionReportPending({
        executionStatus: "SHORTFALL_PENDING",
      }),
    ).toBe(true);
    expect(
      shouldHideContinueWhileProductionReportPending({
        executionStatus: "REPORT_PENDING",
      }),
    ).toBe(true);
    expect(
      shouldHideContinueWhileProductionReportPending({
        showCompactClosureLayout: true,
      }),
    ).toBe(true);
    expect(
      shouldHideContinueWhileProductionReportPending({
        showProductionReport: true,
      }),
    ).toBe(true);
    expect(
      shouldHideContinueWhileProductionReportPending({
        forceProductionReportTransition: true,
      }),
    ).toBe(true);
    expect(
      shouldHideContinueWhileProductionReportPending({
        pendingShortfallDecision: true,
      }),
    ).toBe(true);
    expect(
      shouldHideContinueWhileProductionReportPending({
        executionStatus: "RUNNING",
      }),
    ).toBe(false);
    expect(
      shouldHideContinueWhileProductionReportPending({
        executionStatus: "BLOCKED",
      }),
    ).toBe(false);
    expect(
      shouldHideContinueWhileProductionReportPending({
        executionStatus: "COMPLETED",
      }),
    ).toBe(false);
  });

  it("maps report-pending stage labels without Continue wording", () => {
    expect(productionStageLabelForReportPending({ executionStatus: "SHORTFALL_PENDING" })).toBe(
      "Report pending",
    );
    expect(productionStageLabelForReportPending({ executionStatus: "COMPLETED" })).toBe("Complete");
    expect(productionStageLabelForReportPending({ executionStatus: "CLOSED" })).toBe("Complete");
  });
});
