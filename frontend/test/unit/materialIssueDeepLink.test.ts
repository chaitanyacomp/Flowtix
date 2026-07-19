import { describe, expect, it } from "vitest";
import {
  appendMaterialIssueBucketToHref,
  buildMaterialIssueDeepLink,
  materialIssueBucketForPendingAction,
  parseMaterialIssueBucketParam,
  parseMaterialIssueDeepLink,
  resolveMaterialIssueDeepLinkTarget,
} from "../../src/lib/materialIssueDeepLink";
import {
  groupPendingActionsIntoWorkBuckets,
  pendingActionWorkspaceListHref,
} from "../../src/lib/pendingActionsWorkBuckets";
import type { PendingPmrSummary } from "../../src/lib/materialIssueWorkspace";

function pmr(partial: Partial<PendingPmrSummary> & { id: number }): PendingPmrSummary {
  return {
    id: partial.id,
    docNo: `PMR-${partial.id}`,
    status: partial.status ?? "REQUESTED",
    workOrderId: partial.workOrderId ?? partial.id,
    workOrderNo: `WO-${partial.workOrderId ?? partial.id}`,
    totalPending: partial.totalPending ?? 10,
    totalIssued: partial.totalIssued ?? 0,
    issueQueueState: partial.issueQueueState,
    allowanceStatus: partial.allowanceStatus,
    ...partial,
  };
}

describe("materialIssueDeepLink", () => {
  it("parses canonical bucket tokens", () => {
    expect(parseMaterialIssueBucketParam("readyToIssue")).toBe("readyToIssue");
    expect(parseMaterialIssueBucketParam("partiallyIssued")).toBe("partiallyIssued");
    expect(parseMaterialIssueBucketParam("approvalPending")).toBe("approvalPending");
    expect(parseMaterialIssueBucketParam("approved")).toBe("approved");
    expect(parseMaterialIssueBucketParam("rejected")).toBe("rejected");
  });

  it("accepts legacy queue aliases", () => {
    expect(parseMaterialIssueBucketParam("partially-issued")).toBe("partiallyIssued");
    expect(parseMaterialIssueBucketParam("approval-pending")).toBe("approvalPending");
    expect(parseMaterialIssueDeepLink(new URLSearchParams("queue=partially-issued")).bucket).toBe(
      "partiallyIssued",
    );
  });

  it("maps Pending Action labels to buckets", () => {
    expect(materialIssueBucketForPendingAction("Issue Material")).toBe("readyToIssue");
    expect(materialIssueBucketForPendingAction("Continue RM Issue")).toBe("partiallyIssued");
    expect(materialIssueBucketForPendingAction("RM Allowance Awaiting Admin")).toBe("approvalPending");
    expect(materialIssueBucketForPendingAction("RM Allowance Approved")).toBe("approved");
    expect(materialIssueBucketForPendingAction("RM Allowance Rejected")).toBe("rejected");
  });

  it("builds grouped and specific deep links", () => {
    expect(
      buildMaterialIssueDeepLink({
        bucket: "partiallyIssued",
        returnTo: "pending-actions",
        listOnly: true,
      }),
    ).toBe("/material-issue?bucket=partiallyIssued&returnTo=pending-actions&from=pending-actions");

    expect(
      buildMaterialIssueDeepLink({
        bucket: "readyToIssue",
        workOrderId: 7,
        pmrId: 9,
        returnTo: "pending-actions",
      }),
    ).toContain("bucket=readyToIssue");
    expect(
      buildMaterialIssueDeepLink({
        bucket: "readyToIssue",
        workOrderId: 7,
        pmrId: 9,
        returnTo: "pending-actions",
      }),
    ).toContain("workOrderId=7");
  });

  it("Open List preserves Material Issue bucket and strips WO/PMR", () => {
    expect(
      pendingActionWorkspaceListHref(
        "/material-issue?bucket=partiallyIssued&workOrderId=101&pmrId=55&returnTo=pending-actions&from=pending-actions",
      ),
    ).toBe("/material-issue?bucket=partiallyIssued&returnTo=pending-actions&from=pending-actions");
  });

  it("grouped Continue RM Issue Open List activates partiallyIssued", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      {
        id: "a",
        priority: "MEDIUM",
        action: "Continue RM Issue",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/material-issue?bucket=partiallyIssued&workOrderId=1&pmrId=2&returnTo=pending-actions&from=pending-actions",
      },
      {
        id: "b",
        priority: "MEDIUM",
        action: "Continue RM Issue",
        documentNo: "WO-2",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/material-issue?bucket=partiallyIssued&workOrderId=3&pmrId=4&returnTo=pending-actions&from=pending-actions",
      },
    ]);
    expect(buckets[0]?.openLabel).toBe("Open List");
    expect(buckets[0]?.openHref).toContain("bucket=partiallyIssued");
    expect(buckets[0]?.openHref).not.toContain("workOrderId=");
    expect(buckets[0]?.openHref).not.toContain("pmrId=");
  });

  it("grouped Issue Material Open List activates readyToIssue", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      {
        id: "a",
        priority: "MEDIUM",
        action: "Issue Material",
        documentNo: "WO-1",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/material-issue?bucket=readyToIssue&workOrderId=1&pmrId=2&returnTo=pending-actions",
      },
      {
        id: "b",
        priority: "MEDIUM",
        action: "Issue Material",
        documentNo: "WO-2",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/material-issue?bucket=readyToIssue&workOrderId=3&pmrId=4&returnTo=pending-actions",
      },
    ]);
    expect(buckets[0]?.openHref).toContain("bucket=readyToIssue");
  });

  it("resolves target membership and stale bucket reclassification", () => {
    const rows = [
      pmr({
        id: 1,
        workOrderId: 10,
        status: "PARTIALLY_ISSUED",
        issueQueueState: "PARTIALLY_ISSUED",
        totalIssued: 15,
        totalPending: 15,
      }),
    ];
    const ok = resolveMaterialIssueDeepLinkTarget({
      requestedBucket: "partiallyIssued",
      pmrId: 1,
      pmrs: rows,
    });
    expect(ok.ok).toBe(true);

    const stale = resolveMaterialIssueDeepLinkTarget({
      requestedBucket: "readyToIssue",
      pmrId: 1,
      pmrs: rows,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("WRONG_BUCKET");
      expect(stale.actualBucket).toBe("partiallyIssued");
    }
  });

  it("appendMaterialIssueBucketToHref writes canonical bucket", () => {
    expect(appendMaterialIssueBucketToHref("/material-issue?returnTo=pending-actions", "Continue RM Issue")).toContain(
      "bucket=partiallyIssued",
    );
  });

  it("marks invalid bucket tokens safely", () => {
    const parsed = parseMaterialIssueDeepLink(new URLSearchParams("bucket=notARealBucket"));
    expect(parsed.bucket).toBeNull();
    expect(parsed.invalidBucketRequested).toBe(true);
    expect(parsed.filterKey).toBe("READY");
  });
});
