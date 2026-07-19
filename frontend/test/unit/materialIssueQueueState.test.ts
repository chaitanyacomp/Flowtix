import { describe, expect, it } from "vitest";
import {
  derivePmrIssueQueueState,
  formatPartialIssueSuccessMessage,
  isReadyToIssueQueuePmr,
  resolveMaterialIssueQueueFilter,
} from "../../src/lib/materialIssueQueueState";
import type { PendingPmrSummary } from "../../src/lib/materialIssueWorkspace";

function pmr(partial: Partial<PendingPmrSummary> & { id: number }): PendingPmrSummary {
  return {
    id: partial.id,
    docNo: partial.docNo ?? `PMR-${partial.id}`,
    status: partial.status ?? "REQUESTED",
    workOrderId: partial.workOrderId ?? partial.id,
    workOrderNo: partial.workOrderNo ?? `WO-${partial.id}`,
    totalPending: partial.totalPending ?? 10,
    totalRequired: partial.totalRequired ?? 30,
    totalIssued: partial.totalIssued ?? 0,
    issueQueueState: partial.issueQueueState,
    allowanceStatus: partial.allowanceStatus,
  };
}

describe("materialIssueQueueState", () => {
  it("classifies ready vs partially issued", () => {
    expect(derivePmrIssueQueueState({ status: "REQUESTED", totalIssued: 0, totalPending: 30 })).toBe(
      "READY_TO_ISSUE",
    );
    expect(
      derivePmrIssueQueueState({ status: "PARTIALLY_ISSUED", totalIssued: 15, totalPending: 15 }),
    ).toBe("PARTIALLY_ISSUED");
  });

  it("approval pending never maps to Ready filter", () => {
    expect(
      resolveMaterialIssueQueueFilter({
        allowanceStatus: "PENDING_APPROVAL",
        issueQueueState: "READY_TO_ISSUE",
      }),
    ).toBe("PENDING");
    expect(
      resolveMaterialIssueQueueFilter({
        allowanceStatus: "NONE",
        issueQueueState: "PARTIALLY_ISSUED",
      }),
    ).toBe("PARTIAL");
  });

  it("Ready picker excludes Partially Issued and Approval Pending", () => {
    expect(isReadyToIssueQueuePmr(pmr({ id: 1, status: "REQUESTED", totalIssued: 0 }))).toBe(true);
    expect(
      isReadyToIssueQueuePmr(
        pmr({ id: 2, status: "PARTIALLY_ISSUED", totalIssued: 15, totalPending: 15 }),
      ),
    ).toBe(false);
    expect(
      isReadyToIssueQueuePmr(
        pmr({ id: 3, status: "REQUESTED", allowanceStatus: "PENDING_APPROVAL" }),
      ),
    ).toBe(false);
  });

  it("formats partial-issue success without forcing immediate balance", () => {
    expect(formatPartialIssueSuccessMessage({ issuedQty: 15, remainingQty: 15, unit: "Kg" })).toBe(
      "15 Kg issued. Remaining 15 Kg moved to Partially Issued.",
    );
  });
});
