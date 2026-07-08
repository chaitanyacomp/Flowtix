import { describe, expect, it } from "vitest";
import {
  canSubmitFromBackendIssueDecision,
  filterStoreReadyPmrs,
  isBackendStoreIssueReady,
  mapBackendLineReadiness,
  waitingProcurementFromIssueDecision,
} from "../../src/lib/materialIssueReadinessUx";

describe("materialIssueReadinessUx", () => {
  it("filters PMRs using backend storeIssueReady", () => {
    const rows = [
      { id: 1, status: "REQUESTED", totalPending: 5, storeIssueReady: true, storeActionKey: "ISSUE" },
      { id: 2, status: "REQUESTED", totalPending: 0, storeIssueReady: false, storeActionKey: "NONE" },
      { id: 3, status: "ISSUED", totalPending: 0, storeIssueReady: false },
    ];
    expect(filterStoreReadyPmrs(rows).map((r) => r.id)).toEqual([1]);
    expect(isBackendStoreIssueReady({ storeActionKey: "ISSUE" })).toBe(true);
  });

  it("maps backend line readiness labels", () => {
    expect(
      mapBackendLineReadiness({
        lineReadinessKey: "WAITING_PROCUREMENT",
        lineReadinessLabel: "Waiting procurement",
        lineReadinessExplanation: "GRN pending",
      }),
    ).toEqual({
      status: "WAITING_PROCUREMENT",
      label: "Waiting procurement",
      explanation: "GRN pending",
    });
  });

  it("gates submit from backend issue decision", () => {
    expect(
      canSubmitFromBackendIssueDecision(
        {
          canIssueMore: true,
          canIssueAnyPendingLine: true,
          storeActionKey: "ISSUE",
        },
        { hasPositiveIssueQty: true, hasToleranceBlockedLine: false, submitting: false, loading: false },
      ),
    ).toBe(true);
    expect(
      canSubmitFromBackendIssueDecision(
        { canIssueMore: true, canIssueAnyPendingLine: false },
        { hasPositiveIssueQty: true, hasToleranceBlockedLine: false, submitting: false, loading: false },
      ),
    ).toBe(false);
  });

  it("reads waiting procurement from issue decision", () => {
    expect(waitingProcurementFromIssueDecision({ waitingProcurement: true })).toBe(true);
    expect(waitingProcurementFromIssueDecision({ waitingProcurement: false })).toBe(false);
  });
});
