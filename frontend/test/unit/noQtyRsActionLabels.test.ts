import { describe, expect, it } from "vitest";
import {
  createCycleRsButtonLabel,
  createNextRsButtonLabel,
  noQtyBusinessNextRsBlockReason,
  noQtyBusinessWorkflowStage,
  noQtyNextRsStatusHeadline,
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
    expect(createNextRsButtonLabel(null)).toBe("Create Next RS");
    expect(createNextRsButtonLabel(3)).toBe("Create Cycle 3 RS");
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
    ).toBe("Create Cycle 2 RS");
  });

  it("uses standard Next RS status headlines", () => {
    expect(noQtyNextRsStatusHeadline(true)).toBe("Next RS Ready");
    expect(noQtyNextRsStatusHeadline(false)).toBe("Next RS Blocked");
  });

  it("builds NO_QTY SO list href with optional focus", () => {
    expect(noQtySoListHref()).toBe("/sales-orders?soType=NO_QTY");
    expect(noQtySoListHref(42)).toBe("/sales-orders?soType=NO_QTY&salesOrderId=42");
  });
});
