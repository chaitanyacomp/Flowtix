import { describe, expect, it } from "vitest";
import {
  buildRmPoTraceabilityHref,
  isRmPoIrrelevantNextStepText,
  printRmPoInternalTraceability,
  shouldShowPostGrnStripOnRmPoPage,
} from "../../src/lib/rmPoDocumentActions";
import {
  isRmPoDocumentOnly,
  RM_PO_FINAL_GRN_COMPLETION_TOAST,
  RM_PO_FINAL_GRN_REDIRECT_DELAY_MS,
} from "../../src/lib/rmPurchaseWoContinuity";
import type { PostGrnNextStep } from "../../src/lib/rmPurchaseWoContinuity";

function step(partial: Partial<PostGrnNextStep> & { stageKey: string }): PostGrnNextStep {
  return {
    headline: "",
    detail: "",
    nextStepLine: "",
    actionLabel: "",
    actionHref: "/",
    isWorkflowComplete: false,
    ...partial,
  };
}

describe("rmPoDocumentActions", () => {
  it("suppresses sales billing next step on RM PO page", () => {
    const s = step({
      stageKey: "SALES_BILL_PENDING",
      nextStepLine: "Next step: Complete sales billing for dispatched goods.",
      actionLabel: "Continue To Sales Billing",
    });
    expect(shouldShowPostGrnStripOnRmPoPage(s)).toBe(false);
    expect(isRmPoIrrelevantNextStepText(s.nextStepLine)).toBe(true);
  });

  it("suppresses dispatch next step on RM PO page", () => {
    const s = step({
      stageKey: "DISPATCH_PENDING",
      nextStepLine: "Next step: Dispatch finished goods to customer.",
    });
    expect(shouldShowPostGrnStripOnRmPoPage(s)).toBe(false);
  });

  it("allows RM-relevant next steps", () => {
    const s = step({
      stageKey: "CREATE_WO",
      nextStepLine: "Next step: Create Work Order when RM is available in Store.",
      actionLabel: "Create Work Order",
    });
    expect(shouldShowPostGrnStripOnRmPoPage(s)).toBe(true);
  });

  it("allows material issue next step", () => {
    const s = step({
      stageKey: "MATERIAL_ISSUE",
      nextStepLine: "Next step: Issue raw material from Store to Production.",
    });
    expect(shouldShowPostGrnStripOnRmPoPage(s)).toBe(true);
  });

  it("builds traceability page href", () => {
    expect(buildRmPoTraceabilityHref(42)).toBe("/rm-po-grn/42/traceability");
  });

  it("identifies completed PO document-only mode", () => {
    expect(isRmPoDocumentOnly("COMPLETED")).toBe(true);
    expect(isRmPoDocumentOnly("PARTIAL")).toBe(false);
  });

  it("exports final GRN completion UX constants", () => {
    expect(RM_PO_FINAL_GRN_COMPLETION_TOAST).toContain("Goods Receipt completed successfully");
    expect(RM_PO_FINAL_GRN_REDIRECT_DELAY_MS).toBeGreaterThanOrEqual(2000);
    expect(typeof printRmPoInternalTraceability).toBe("function");
  });
});
