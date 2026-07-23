import { describe, expect, it } from "vitest";
import {
  guidedTimelineIndexForStoreAction,
  isStoreActionIssueReady,
  isStoreActionPostIssueHandoff,
  mapStoreActionToGuidedPhase,
  readinessBadgeFromBackendCase,
  resolveStoreActionPrimaryPresentation,
  rmControlCenterCaseStatusLabel,
} from "../../src/lib/rmControlCenterReadinessUx";

describe("rmControlCenterReadinessUx", () => {
  it("maps backend store action keys to guided phases", () => {
    expect(mapStoreActionToGuidedPhase("ISSUE")).toBe("E_READY_TO_ISSUE");
    expect(mapStoreActionToGuidedPhase("WAIT_PO")).toBe("C_PR_CREATED");
    expect(mapStoreActionToGuidedPhase("HANDOFF_TO_PRODUCTION")).toBe("F_ISSUED_OPEN_PRODUCTION");
    expect(guidedTimelineIndexForStoreAction("WAIT_GRN")).toBe(3);
  });

  it("detects issue-ready and post-issue handoff from store action", () => {
    expect(isStoreActionIssueReady({ key: "ISSUE", label: "Issue RM to Production" })).toBe(true);
    expect(isStoreActionIssueReady({ key: "REVIEW", label: "Review" })).toBe(false);
    expect(
      isStoreActionPostIssueHandoff({ key: "HANDOFF_TO_PRODUCTION", label: "RM issued — waiting for Production" }),
    ).toBe(true);
  });

  it("builds primary presentation from backend store action", () => {
    expect(
      resolveStoreActionPrimaryPresentation({
        storeAction: { key: "ISSUE", label: "Issue RM to Production", description: "Transfer stock" },
        issueHref: "/material-issue?workOrderId=1",
        grnHref: "/rm-po-grn",
      }),
    ).toEqual({
      kind: "link",
      label: "Issue RM to Production",
      href: "/material-issue?workOrderId=1",
      description: "Transfer stock",
    });
  });

  it("prefers backend status labels for readiness badge", () => {
    expect(
      readinessBadgeFromBackendCase({
        issueStatusLabel: "Ready for issue",
        procurementStatusLabel: "Fully procured",
      }),
    ).toEqual({ label: "Ready for issue", variant: "success" });
  });

  it("case status chip never mirrors Create Work Order CTA", () => {
    expect(rmControlCenterCaseStatusLabel({ storeActionKey: "CREATE_WO", storeActionLabel: "Create Work Order" })).toBe(
      "RM Ready",
    );
  });
});
