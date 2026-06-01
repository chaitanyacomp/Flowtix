import { describe, expect, it } from "vitest";
import {
  buildCompleteQaNextStep,
  buildCreateSalesBillNextStep,
  buildExportTallyNextStep,
  buildGoToDispatchNextStep,
  buildRmIssueNextStep,
  buildRmReadyProductionNextStep,
  readinessBlocksProduction,
  resolveProductionStickyContext,
  resolveProductionStickyMetrics,
} from "../../src/lib/regularSoOperationalGuidance";
import type { ProductionRmReadiness } from "../../src/components/erp/ProductionRmReadinessStrip";

const baseReadiness = (overrides: Partial<ProductionRmReadiness> = {}): ProductionRmReadiness => ({
  workOrderId: 42,
  workOrderLineId: 7,
  gate: "WAITING_STORE_ISSUE",
  latestPmrId: 99,
  fgUnit: "KG",
  productionAllowedNowQty: 100,
  rmLines: [],
  ...overrides,
});

describe("regularSoOperationalGuidance", () => {
  it("buildRmIssueNextStep links to material requests when no PMR", () => {
    const step = buildRmIssueNextStep(baseReadiness({ gate: "NO_PMR", latestPmrId: null }), "work-orders");
    expect(step.statusTitle).toBe("Waiting for RM Issue");
    expect(step.primaryAction.label).toBe("Issue RM to Production");
    expect(step.primaryAction.href).toContain("production-material-requests");
    expect(step.primaryAction.href).toContain("workOrderId=42");
  });

  it("buildRmIssueNextStep links to material issue when PMR is submitted", () => {
    const step = buildRmIssueNextStep(baseReadiness({ gate: "WAITING_STORE_ISSUE" }), "production-workspace");
    expect(step.primaryAction.href).toContain("material-issue");
    expect(step.primaryAction.href).toContain("pmrId=99");
  });

  it("buildRmReadyProductionNextStep points to production workspace", () => {
    const step = buildRmReadyProductionNextStep(10, 3);
    expect(step.statusTitle).toContain("RM Ready");
    expect(step.primaryAction.href).toContain("/production");
    expect(step.primaryAction.href).toContain("workOrderId=10");
  });

  it("buildCompleteQaNextStep includes production id when provided", () => {
    const step = buildCompleteQaNextStep(5, 12);
    expect(step.primaryAction.href).toContain("salesOrderId=5");
    expect(step.primaryAction.href).toContain("productionId=12");
  });

  it("buildGoToDispatchNextStep and billing helpers build expected hrefs", () => {
    expect(buildGoToDispatchNextStep(8).primaryAction.href).toBe("/dispatch?salesOrderId=8");
    expect(buildCreateSalesBillNextStep(3).primaryAction.href).toContain("dispatchId=3");
    expect(buildExportTallyNextStep(15).primaryAction.href).toContain("/sales-bills/15");
  });

  it("readinessBlocksProduction delegates to RM readiness gate", () => {
    expect(readinessBlocksProduction(baseReadiness({ gate: "NO_PMR" }))).toBe(true);
    expect(readinessBlocksProduction(baseReadiness({ gate: "FULLY_ISSUED_READY" }))).toBe(false);
    expect(readinessBlocksProduction(null)).toBe(false);
  });

  it("resolveProductionStickyContext preserves context from production entries when WO line drops off picker", () => {
    const ctx = resolveProductionStickyContext({
      selected: null,
      woId: 42,
      wolId: 7,
      workOrders: [],
      entries: [
        {
          workOrderLine: {
            id: 7,
            fgItem: { itemName: "Widget A" },
            workOrder: { id: 42, salesOrderId: 5, docNo: "WO-26-0001" },
          },
        },
      ],
      focusSo: { docNo: "SO-26-0001" },
    });
    expect(ctx).toEqual({
      salesOrderId: 5,
      workOrderId: 42,
      itemName: "Widget A",
      woDocNo: "WO-26-0001",
      soDocNo: "SO-26-0001",
    });
  });

  it("resolveProductionStickyMetrics falls back to flat line qty when picker selection clears", () => {
    expect(
      resolveProductionStickyMetrics({
        selectedMetrics: null,
        wolId: 7,
        flatLines: [{ id: 7, qty: "100", approvedProducedQty: 40, remainingQty: 60 }],
      }),
    ).toEqual({ woLineQty: 100, usedQty: 40, remainingQty: 60 });
  });

  it("resolveProductionStickyMetrics prefers live selected metrics", () => {
    expect(
      resolveProductionStickyMetrics({
        selectedMetrics: { woLineQty: 50, usedQty: 10, remainingQty: 40 },
        wolId: 7,
        flatLines: [{ id: 7, qty: "100", approvedProducedQty: 40 }],
      }),
    ).toEqual({ woLineQty: 50, usedQty: 10, remainingQty: 40 });
  });
});
