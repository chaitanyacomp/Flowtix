import { describe, expect, it } from "vitest";
import {
  isRmPoIrrelevantNextStepText,
  shouldShowPostGrnStripOnRmPoPage,
} from "../../src/lib/rmPoDocumentActions";
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
});
