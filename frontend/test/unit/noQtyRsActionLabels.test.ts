import { describe, expect, it } from "vitest";
import {
  createCycleRequirementSheetButtonLabel,
  createCycleRsButtonLabel,
  createNextRsButtonLabel,
  noQtyAgreementWorkspaceHref,
  noQtyBusinessNextRsBlockReason,
  noQtyBusinessWorkflowStage,
  noQtyCreateNextCycleContinuationLabel,
  noQtyNextRsStatusHeadline,
  noQtyPlanningHubHref,
  noQtySoListHref,
  openCurrentRsButtonLabel,
  resolveCreateRsButtonLabel,
} from "../../src/lib/noQtyRsActionLabels";

describe("noQtyRsActionLabels", () => {
  it("maps workflow stages to cycle-oriented language", () => {
    expect(noQtyBusinessWorkflowStage({ processStageKey: "NO_QTY_DRAFT", hasRs: false })).toBe(
      "Requirement Sheet pending",
    );
    expect(noQtyBusinessWorkflowStage({ processStageKey: "NO_QTY_IN_PRODUCTION", hasRs: true })).toBe(
      "Production / QA in progress",
    );
  });

  it("maps draft RS block reasons", () => {
    expect(noQtyBusinessNextRsBlockReason("DRAFT_RS_ON_CYCLE")).toContain("not locked");
    expect(noQtyBusinessNextRsBlockReason("DRAFT_RS_EXISTS")).toContain("draft");
  });

  it("uses standard button labels", () => {
    expect(openCurrentRsButtonLabel()).toBe("Open Current RS");
    expect(createCycleRsButtonLabel(2)).toBe("Create Cycle 2 RS");
    expect(createNextRsButtonLabel(null)).toBe("Create Next Requirement Sheet");
    expect(createNextRsButtonLabel(3)).toBe("Create Cycle 3 Requirement Sheet");
  });

  it("resolves create labels from context", () => {
    expect(
      resolveCreateRsButtonLabel({
        hasRs: false,
        currentCycleNo: 1,
      }),
    ).toBe("Create Cycle 1 RS");
    expect(
      resolveCreateRsButtonLabel({
        hasRs: true,
        createNextRsEligible: true,
        nextCycleNo: 2,
      }),
    ).toBe("Create Cycle 2 Requirement Sheet");
  });

  it("uses standard Next RS status headlines", () => {
    expect(noQtyNextRsStatusHeadline(true)).toBe("Next RS Ready");
    expect(noQtyNextRsStatusHeadline(false)).toBe("Next RS Blocked");
  });

  it("builds NO_QTY SO list href with optional focus", () => {
    expect(noQtySoListHref()).toBe("/sales-orders?soType=NO_QTY");
    expect(noQtySoListHref(42)).toBe("/sales-orders?soType=NO_QTY&salesOrderId=42");
  });

  it("builds Store-safe planning navigation hrefs", () => {
    expect(noQtyAgreementWorkspaceHref(42, { intent: "add", from: "dashboard" })).toBe(
      "/sales-orders/42/requirement-sheets?source=no_qty_so&salesOrderId=42&intent=add&from=dashboard",
    );
    expect(noQtyPlanningHubHref(42)).toBe("/planning-dashboard?salesOrderId=42&source=no_qty_planning");
    expect(noQtyPlanningHubHref()).toBe("/planning-dashboard");
    expect(createCycleRequirementSheetButtonLabel(2)).toBe("Create Cycle 2 Requirement Sheet");
    expect(noQtyCreateNextCycleContinuationLabel({ currentCycleNo: 1 })).toBe(
      "Create Cycle 2 Requirement Sheet",
    );
  });
});
