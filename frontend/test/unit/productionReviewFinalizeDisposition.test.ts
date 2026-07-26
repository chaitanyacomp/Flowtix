import { describe, expect, it } from "vitest";
import {
  computeReviewFinalizeShortageQty,
  isReviewFinalizeDispositionReady,
  REVIEW_FINALIZE_REMAINING_OPTIONS,
  reviewFinalizeOptionsIncludeContinue,
  reviewFinalizePrimaryButtonLabel,
  reviewFinalizeShortagePanelCopy,
} from "../../src/lib/productionReviewFinalizeDisposition";
import { isProductionReportCloseDecision } from "../../src/lib/productionReportTransition";
import { PRODUCTION_WORKSPACE_SECTION_LABELS } from "../../src/lib/productionWorkspaceSections";

describe("productionReviewFinalizeDisposition", () => {
  it("does not offer Continue Production as a finalize decision card", () => {
    expect(REVIEW_FINALIZE_REMAINING_OPTIONS).toHaveLength(2);
    expect(REVIEW_FINALIZE_REMAINING_OPTIONS.map((o) => o.id)).toEqual(["PAUSE", "END_WITH_SHORTAGE"]);
    expect(reviewFinalizeOptionsIncludeContinue()).toBe(false);
    expect(REVIEW_FINALIZE_REMAINING_OPTIONS.some((o) => /continue/i.test(o.title))).toBe(false);
  });

  it("requires a deliberate Pause or End choice when balance remains", () => {
    expect(
      isReviewFinalizeDispositionReady({ remainingAfterEntry: 1000, disposition: null }),
    ).toBe(false);
    expect(
      isReviewFinalizeDispositionReady({ remainingAfterEntry: 1000, disposition: "PAUSE" }),
    ).toBe(true);
    expect(
      isReviewFinalizeDispositionReady({
        remainingAfterEntry: 1000,
        disposition: "END_WITH_SHORTAGE",
      }),
    ).toBe(true);
    expect(isReviewFinalizeDispositionReady({ remainingAfterEntry: 0, disposition: null })).toBe(true);
  });

  it("labels the primary button from the selected outcome", () => {
    expect(reviewFinalizePrimaryButtonLabel({ remainingAfterEntry: 0, disposition: null })).toBe(
      "Complete Production",
    );
    expect(reviewFinalizePrimaryButtonLabel({ remainingAfterEntry: 500, disposition: "PAUSE" })).toBe(
      "Pause Production",
    );
    expect(
      reviewFinalizePrimaryButtonLabel({ remainingAfterEntry: 500, disposition: "END_WITH_SHORTAGE" }),
    ).toBe("End Production");
    expect(reviewFinalizePrimaryButtonLabel({ remainingAfterEntry: 500, disposition: null })).toBe(
      "Select an outcome",
    );
  });

  it("maps dispositions to report vs pause correctly", () => {
    expect(isProductionReportCloseDecision({ remainingAfterEntry: 100, disposition: "PAUSE" })).toBe(false);
    expect(
      isProductionReportCloseDecision({ remainingAfterEntry: 100, disposition: "END_WITH_SHORTAGE" }),
    ).toBe(true);
    expect(isProductionReportCloseDecision({ remainingAfterEntry: 0, disposition: null })).toBe(true);
  });

  it("keeps the Production Workspace Continue Production tab label", () => {
    expect(PRODUCTION_WORKSPACE_SECTION_LABELS.active).toBe("Continue Production");
  });

  it("computes shortage as WO planned − previously finalized − current draft", () => {
    expect(computeReviewFinalizeShortageQty(2000, 0, 1972)).toBe(28);
    expect(computeReviewFinalizeShortageQty(2000, 500, 1472)).toBe(28);
    expect(computeReviewFinalizeShortageQty(2000, 2000, 0)).toBe(0);
    expect(computeReviewFinalizeShortageQty(100, 0, 120)).toBe(0);
  });

  it("NO_QTY shortage copy transfers to RS-1 recovery (not Regular no-carry-forward)", () => {
    const copy = reviewFinalizeShortagePanelCopy({
      flow: "NO_QTY",
      shortageQty: 28,
      formatQty: (n) => String(n),
      unit: "Nos",
    });
    expect(copy.body).toBe(
      "This WO will close permanently. The 28 Nos shortage will be transferred to RS-1 recovery for Keep/Waive decision and can be planned in the next cycle/new WO.",
    );
    expect(copy.checkbox).toMatch(/transfers to RS-1 recovery \(Keep\/Waive\)/i);
    expect(copy.checkbox).not.toMatch(/will not carry forward|lost|discarded/i);
    expect(copy.button).toBe("End Production — Transfer Shortage");
    expect(copy.button).not.toMatch(/Permanently Close WO with Shortage/i);
    expect(copy.body).not.toMatch(/will not carry forward/i);
    expect(copy.testId).toBe("noqty-review-finalize-shortage-recovery");
  });

  it("does not use Regular permanent-close loss language for GREEN_LEVEL", () => {
    const copy = reviewFinalizeShortagePanelCopy({
      flow: "GREEN_LEVEL",
      shortageQty: 5,
      formatQty: (n) => String(n),
      unit: "Nos",
    });
    expect(copy.body).not.toMatch(/will not carry forward/i);
    expect(copy.checkbox).not.toMatch(/will not carry forward|lost/i);
  });
});
