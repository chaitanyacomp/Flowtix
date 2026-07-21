import { describe, expect, it } from "vitest";
import {
  hydrateIssueLinesWithAllowanceApprovals,
  mergeAllowanceQueueInfoIntoPmrs,
  pickLatestApprovalForPmrLine,
  resolveLineAllowanceBand,
  resolveMaterialIssuePrimaryAction,
  resolvePmrAllowanceQueueInfo,
  type RmAllowanceApprovalRequest,
} from "../../src/lib/rmAllowanceApprovalUx";

function approval(partial: Partial<RmAllowanceApprovalRequest> & { id: number }): RmAllowanceApprovalRequest {
  return {
    workOrderId: 1,
    productionMaterialRequestId: 100,
    pmrLineId: 1000,
    addQty: 2,
    allowancePct: 7,
    issueQty: 22,
    status: "PENDING_APPROVAL",
    storeReason: "Process wastage",
    ...partial,
  };
}

describe("rmAllowanceApprovalUx — line band", () => {
  it("above 10% is always Blocked", () => {
    expect(
      resolveLineAllowanceBand({ blocked: true, requiresAdminApproval: true, hasReason: true }),
    ).toBe("BLOCKED");
  });

  it("0-5% never requires approval", () => {
    expect(
      resolveLineAllowanceBand({ blocked: false, requiresAdminApproval: false, hasReason: false }),
    ).toBe("NORMAL");
  });

  it("above 5% with no reason needs a reason first", () => {
    expect(
      resolveLineAllowanceBand({ blocked: false, requiresAdminApproval: true, hasReason: false }),
    ).toBe("NEEDS_REASON");
  });

  it("above 5% with reason and no request yet is ready to send", () => {
    expect(
      resolveLineAllowanceBand({
        blocked: false,
        requiresAdminApproval: true,
        hasReason: true,
        approvalStatus: "NONE",
      }),
    ).toBe("READY_TO_SEND");
  });

  it("Admin bypasses the approval workflow once a reason is entered", () => {
    expect(
      resolveLineAllowanceBand({
        blocked: false,
        requiresAdminApproval: true,
        hasReason: true,
        approvalStatus: "NONE",
        isAdmin: true,
      }),
    ).toBe("NORMAL");
    expect(
      resolveLineAllowanceBand({
        blocked: false,
        requiresAdminApproval: true,
        hasReason: false,
        isAdmin: true,
      }),
    ).toBe("NEEDS_REASON");
  });

  it("maps active request statuses to their band", () => {
    const base = { blocked: false, requiresAdminApproval: true, hasReason: true };
    expect(resolveLineAllowanceBand({ ...base, approvalStatus: "PENDING_APPROVAL" })).toBe("PENDING_APPROVAL");
    expect(resolveLineAllowanceBand({ ...base, approvalStatus: "APPROVED" })).toBe("APPROVED");
    expect(resolveLineAllowanceBand({ ...base, approvalStatus: "REJECTED" })).toBe("REJECTED");
  });
});

describe("rmAllowanceApprovalUx — primary action aggregation", () => {
  it("defaults to Issue Material with no active allowance lines", () => {
    expect(resolveMaterialIssuePrimaryAction([]).label).toBe("Issue Material");
  });

  it("Blocked wins over every other band", () => {
    const action = resolveMaterialIssuePrimaryAction(["NORMAL", "READY_TO_SEND", "BLOCKED"]);
    expect(action.key).toBe("BLOCKED");
    expect(action.label).toBe("Blocked");
  });

  it("a pending line forces Awaiting Admin Approval and a read-only form", () => {
    const action = resolveMaterialIssuePrimaryAction(["NORMAL", "PENDING_APPROVAL"]);
    expect(action.key).toBe("AWAITING_APPROVAL");
    expect(action.label).toBe("Awaiting Admin Approval");
    expect(action.readOnly).toBe(true);
  });

  it("a missing reason disables sending for approval", () => {
    const action = resolveMaterialIssuePrimaryAction(["NEEDS_REASON", "READY_TO_SEND"]);
    expect(action.key).toBe("NEEDS_REASON");
    expect(action.label).toBe("Enter Reason to Request Approval");
  });

  it("Admin sees an issue-flavoured reason prompt", () => {
    const action = resolveMaterialIssuePrimaryAction(["NEEDS_REASON"], { isAdmin: true });
    expect(action.label).toBe("Enter Reason to Issue");
  });

  it("rejected lines prompt Revise & Resubmit", () => {
    expect(resolveMaterialIssuePrimaryAction(["REJECTED", "NORMAL"]).key).toBe("REVISE_RESUBMIT");
  });

  it("ready-to-send lines prompt Send for Admin Approval", () => {
    expect(resolveMaterialIssuePrimaryAction(["READY_TO_SEND", "NORMAL"]).key).toBe("SEND_FOR_APPROVAL");
  });

  it("approved lines fall back to Issue Material", () => {
    expect(resolveMaterialIssuePrimaryAction(["APPROVED", "NORMAL"]).label).toBe("Issue Material");
  });
});

describe("rmAllowanceApprovalUx — approvals lookup", () => {
  it("picks the highest-id request per PMR line", () => {
    const approvals = [
      approval({ id: 1, pmrLineId: 10, status: "REJECTED" }),
      approval({ id: 2, pmrLineId: 10, status: "PENDING_APPROVAL" }),
      approval({ id: 3, pmrLineId: 11, status: "APPROVED" }),
    ];
    expect(pickLatestApprovalForPmrLine(approvals, 10)?.id).toBe(2);
    expect(pickLatestApprovalForPmrLine(approvals, 99)).toBeNull();
  });

  it("resolves PMR queue info with pending taking priority over approved/rejected", () => {
    const approvals = [
      approval({ id: 1, productionMaterialRequestId: 500, pmrLineId: 10, status: "REJECTED" }),
      approval({ id: 2, productionMaterialRequestId: 500, pmrLineId: 11, status: "PENDING_APPROVAL" }),
    ];
    expect(resolvePmrAllowanceQueueInfo(approvals, 500).status).toBe("PENDING_APPROVAL");
    expect(resolvePmrAllowanceQueueInfo(approvals, 999).status).toBe("NONE");
  });

  it("merges queue info additively onto pending-PMR summaries", () => {
    const pmrs = [{ id: 500, docNo: "PMR-500" }];
    const approvals = [approval({ id: 1, productionMaterialRequestId: 500, status: "APPROVED", allowancePct: 6.5 })];
    const merged = mergeAllowanceQueueInfoIntoPmrs(pmrs, approvals);
    expect(merged[0].allowanceStatus).toBe("APPROVED");
    expect(merged[0].allowancePct).toBe(6.5);
    expect(merged[0].docNo).toBe("PMR-500");
  });
});

describe("rmAllowanceApprovalUx — line hydration", () => {
  it("loads the exact approved quantities and locks further auto-recalculation", () => {
    const approvals = [
      approval({ id: 5, pmrLineId: 10, addQty: 3, issueQty: 43, status: "APPROVED", storeReason: "Trim scrap" }),
    ];
    const lines = [
      {
        pmrLineId: 10,
        plannedAllowanceQty: "0",
        issueQty: "0",
        issueQtyTouched: false,
        allowanceReason: "",
      },
    ];
    const [hydrated] = hydrateIssueLinesWithAllowanceApprovals(lines, approvals);
    expect(hydrated.plannedAllowanceQty).toBe("3");
    expect(hydrated.issueQty).toBe("43");
    expect(hydrated.issueQtyTouched).toBe(true);
    expect(hydrated.allowanceReason).toBe("Trim scrap");
    expect(hydrated.allowanceApprovalStatus).toBe("APPROVED");
  });

  it("only backfills a rejected line while it is still untouched", () => {
    const approvals = [approval({ id: 5, pmrLineId: 10, addQty: 3, issueQty: 43, status: "REJECTED" })];
    const untouched = hydrateIssueLinesWithAllowanceApprovals(
      [{ pmrLineId: 10, plannedAllowanceQty: "0", issueQty: "0", issueQtyTouched: false }],
      approvals,
    )[0];
    expect(untouched.issueQty).toBe("43");
    expect(untouched.allowanceApprovalStatus).toBe("REJECTED");

    // Issue Now-only edits keep REJECTED (operator may still revise & resubmit).
    const issueOnlyTouched = hydrateIssueLinesWithAllowanceApprovals(
      [{ pmrLineId: 10, plannedAllowanceQty: "3", issueQty: "5", issueQtyTouched: true }],
      approvals,
    )[0];
    expect(issueOnlyTouched.issueQty).toBe("5");
    expect(issueOnlyTouched.allowanceApprovalStatus).toBe("REJECTED");

    // Add Qty change invalidates the rejected snapshot — never treat as a fresh rejection.
    const addQtyRevised = hydrateIssueLinesWithAllowanceApprovals(
      [{ pmrLineId: 10, plannedAllowanceQty: "1", issueQty: "5", issueQtyTouched: true }],
      approvals,
    )[0];
    expect(addQtyRevised.issueQty).toBe("5");
    expect(addQtyRevised.allowanceApprovalStatus).toBe("NONE");
  });

  it("clears stale approval markers once no request remains for the line", () => {
    const line = {
      pmrLineId: 10,
      plannedAllowanceQty: "3",
      issueQty: "43",
      issueQtyTouched: true,
      allowanceApprovalId: 5,
      allowanceApprovalStatus: "APPROVED" as const,
    };
    const [hydrated] = hydrateIssueLinesWithAllowanceApprovals([line], []);
    expect(hydrated.allowanceApprovalId).toBeNull();
    expect(hydrated.allowanceApprovalStatus).toBe("NONE");
  });

  it("leaves lines without a PMR line id untouched", () => {
    const line = { issueQty: "10", issueQtyTouched: false };
    const [hydrated] = hydrateIssueLinesWithAllowanceApprovals([line], []);
    expect(hydrated).toBe(line);
  });

  it("ignores SUPERSEDED approvals when picking latest for a line", () => {
    const latest = pickLatestApprovalForPmrLine(
      [
        approval({ id: 2, status: "SUPERSEDED", pmrLineId: 1000 }),
        approval({ id: 1, status: "REJECTED", pmrLineId: 1000 }),
      ],
      1000,
    );
    expect(latest?.id).toBe(1);
    expect(latest?.status).toBe("REJECTED");
  });

  it("clears REJECTED band after operator revises Add Qty", () => {
    const [hydrated] = hydrateIssueLinesWithAllowanceApprovals(
      [
        {
          pmrLineId: 1000,
          plannedAllowanceQty: "1",
          issueQty: "31",
          issueQtyTouched: true,
          allowanceApprovalStatus: "REJECTED" as const,
          allowanceApprovalId: 9,
        },
      ],
      [approval({ id: 9, status: "REJECTED", addQty: 4, pmrLineId: 1000 })],
    );
    expect(hydrated.allowanceApprovalStatus).toBe("NONE");
    expect(hydrated.allowanceApprovalId).toBeNull();
  });

  it("newer pending request supersedes older rejected in queue badge", () => {
    const info = resolvePmrAllowanceQueueInfo(
      [
        approval({ id: 20, status: "PENDING_APPROVAL", productionMaterialRequestId: 100 }),
        approval({ id: 10, status: "REJECTED", productionMaterialRequestId: 100 }),
      ],
      100,
    );
    expect(info.status).toBe("PENDING_APPROVAL");
  });
});
