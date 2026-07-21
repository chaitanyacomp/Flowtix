import { describe, expect, it } from "vitest";
import {
  isReviewFinalizeDispositionReady,
  REVIEW_FINALIZE_REMAINING_OPTIONS,
  reviewFinalizeOptionsIncludeContinue,
  reviewFinalizePrimaryButtonLabel,
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
});
