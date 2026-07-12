import { describe, expect, it } from "vitest";
import {
  buildPendingActionPreviewLine,
  groupPendingActionsIntoWorkBuckets,
  parseReadyToDispatchQty,
  pendingActionWorkspaceListHref,
  pendingActionsBucketNavigateState,
  resolvePendingActionGroupKey,
} from "../../src/lib/pendingActionsWorkBuckets";
import type { PendingAction } from "../../src/lib/pendingActionsApi";

function row(partial: Partial<PendingAction> & Pick<PendingAction, "action">): PendingAction {
  return {
    priority: "MEDIUM",
    documentNo: "WO-1",
    ownerRole: "STORE",
    ageHours: null,
    href: "/material-issue?returnTo=pending-actions&workOrderId=1",
    ...partial,
  };
}

describe("pendingActionsWorkBuckets", () => {
  it("groups rows with the same action type", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      row({ id: "a", action: "Release to Production", documentNo: "WO-26-0004", href: "/material-issue?returnTo=pending-actions&workOrderId=4" }),
      row({ id: "b", action: "Release to Production", documentNo: "WO-26-0005", href: "/material-issue?returnTo=pending-actions&workOrderId=5" }),
      row({ id: "c", action: "Release to Production", documentNo: "WO-26-0006", href: "/material-issue?returnTo=pending-actions&workOrderId=6" }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.title).toBe("Release to Production (3)");
    expect(buckets[0]?.previewLines.map((l) => l.documentNo)).toEqual(["WO-26-0004", "WO-26-0005", "WO-26-0006"]);
    expect(buckets[0]?.openLabel).toBe("Open List");
  });

  it("shows overflow when more than three documents", () => {
    const buckets = groupPendingActionsIntoWorkBuckets(
      Array.from({ length: 8 }, (_, i) =>
        row({
          id: `r${i}`,
          action: "RM Return Approval Pending",
          documentNo: `WO-${i}`,
          href: `/production/rm-returns?from=pending-actions&workOrderId=${i}`,
        }),
      ),
    );
    expect(buckets[0]?.overflowCount).toBe(5);
    expect(buckets[0]?.previewLines).toHaveLength(3);
    expect(buckets[0]?.title).toBe("RM Return Approval Pending (8)");
  });

  it("groups ready to dispatch rows and shows ready qty detail", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      row({
        action: "Ready to Dispatch — SO-26-0001 — Qty 3710",
        documentNo: "SO-26-0001",
        href: "/dispatch?salesOrderId=1&source=pending-actions",
      }),
      row({
        action: "Ready to Dispatch — SO-26-0002 — Qty 500",
        documentNo: "SO-26-0002",
        href: "/dispatch?salesOrderId=2&source=pending-actions",
      }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.title).toBe("Ready to Dispatch (2 Items)");
    expect(buckets[0]?.previewLines[0]).toEqual({ documentNo: "SO-26-0001", detail: "Dispatchable Qty: 3710" });
    expect(buckets[0]?.openLabel).toBe("Open Dispatch");
  });

  it("single-item bucket uses direct href and Open label", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      row({
        action: "Create Cycle 2 Requirement Sheet",
        documentNo: "SO-26-0001",
        href: "/work-orders/prepare?salesOrderId=1&from=pending-actions",
      }),
    ]);
    expect(buckets[0]?.openLabel).toBe("Open");
    expect(buckets[0]?.openHref).toContain("salesOrderId=1");
  });

  it("workspace list href strips document-specific query params", () => {
    expect(
      pendingActionWorkspaceListHref("/material-issue?returnTo=pending-actions&workOrderId=101"),
    ).toBe("/material-issue?returnTo=pending-actions");
    expect(pendingActionWorkspaceListHref("/dispatch?salesOrderId=42&source=pending-actions")).toBe(
      "/dispatch?source=pending-actions",
    );
    expect(
      pendingActionWorkspaceListHref(
        "/production-release?from=pending-actions&workOrderId=101&pmrId=55&flow=GREEN_LEVEL",
      ),
    ).toBe("/production-release?from=pending-actions");
    expect(
      pendingActionWorkspaceListHref(
        "/store/green-level-wo?from=pending-actions&planId=12",
      ),
    ).toBe("/store/green-level-wo?from=pending-actions&planId=12");
    const buckets = groupPendingActionsIntoWorkBuckets([
      {
        id: "green-level-place-wo:12",
        priority: "MEDIUM",
        action: "Create Green Level WO",
        documentNo: "DOC-26-0001",
        ownerRole: "STORE",
        ageHours: 1,
        href: "/work-orders?focus=green-level-wo&from=pending-actions&planId=12",
      },
    ]);
    expect(buckets[0]?.openHref).toBe("/store/green-level-wo?from=pending-actions&planId=12");
  });

  it("preserves RS execution identity on requirement-sheets deep links", () => {
    const href =
      "/sales-orders/224/requirement-sheets?source=no_qty_so&salesOrderId=224&cycleId=382&focus=execution&from=pending-actions&sheetId=335";
    expect(pendingActionWorkspaceListHref(href)).toContain("sheetId=335");
    expect(pendingActionWorkspaceListHref(href)).toContain("cycleId=382");
    expect(pendingActionWorkspaceListHref(href)).toContain("focus=execution");
    expect(pendingActionWorkspaceListHref(href)).toContain("salesOrderId=224");

    const single = groupPendingActionsIntoWorkBuckets([
      row({
        id: "no-qty-place-wo:224:382",
        action: "Create Suggested WO",
        documentNo: "SO-26-0001 · Cycle 2 · RS-26-0002 · Suggested WO 11,069 Nos",
        href,
      }),
    ]);
    expect(single[0]?.openHref).toContain("sheetId=335");
    expect(single[0]?.openHref).toContain("cycleId=382");

    const multi = groupPendingActionsIntoWorkBuckets([
      row({
        id: "no-qty-place-wo:224:382",
        action: "Create Suggested WO",
        documentNo: "SO-26-0001 · RS-26-0002",
        href,
      }),
      row({
        id: "no-qty-place-wo:99:1",
        action: "Create Suggested WO",
        documentNo: "SO-26-0099 · RS-26-0099",
        href: "/sales-orders/99/requirement-sheets?source=no_qty_so&salesOrderId=99&cycleId=1&focus=execution&from=pending-actions&sheetId=900",
      }),
    ]);
    // Multi-item list must still carry an explicit RS identity (first item), not strip to latest/active cycle.
    expect(multi[0]?.openHref).toContain("sheetId=335");
    expect(multi[0]?.openHref).toContain("cycleId=382");
  });

  it("preserves monthly-planning period and from on Pending Actions Open", () => {
    const href = "/monthly-planning?period=2026-06&from=pending-actions";
    expect(pendingActionWorkspaceListHref(href)).toBe(
      "/monthly-planning?from=pending-actions&period=2026-06",
    );

    const single = groupPendingActionsIntoWorkBuckets([
      row({
        id: "no-qty-monthly-plan:24:5:2026-06",
        action: "Monthly Planning Pending",
        documentNo: "SO-26-0000",
        href,
      }),
    ]);
    expect(single[0]?.openHref).toBe(href);
    expect(single[0]?.openLabel).toBe("Open");

    const multi = groupPendingActionsIntoWorkBuckets([
      row({
        id: "a",
        action: "Monthly Planning Pending",
        documentNo: "SO-26-0000",
        href,
      }),
      row({
        id: "b",
        action: "Monthly Planning Pending",
        documentNo: "SO-26-0001",
        href: "/monthly-planning?period=2026-07&from=pending-actions",
      }),
    ]);
    expect(multi[0]?.openHref).toContain("period=2026-06");
    expect(multi[0]?.openHref).toContain("from=pending-actions");
    expect(multi[0]?.openLabel).toBe("Open List");
  });

  it("production pending buckets deep-link workspace list with scoped bucket filter", () => {
    const ready = groupPendingActionsIntoWorkBuckets([
      row({
        id: "a",
        action: "Ready to Start Production",
        documentNo: "WO-26-0001",
        href: "/production?from=pending-actions&workOrderId=1&flow=REGULAR_SO&salesOrderId=5",
      }),
      row({
        id: "b",
        action: "Ready to Start Production",
        documentNo: "WO-26-0002",
        href: "/production?from=pending-actions&workOrderId=2&flow=REGULAR_SO&salesOrderId=5",
      }),
    ]);
    expect(ready[0]?.listHref).toContain("productionBucket=readyToStart");
    expect(ready[0]?.openLabel).toBe("Open Production Workspace");

    const cont = groupPendingActionsIntoWorkBuckets([
      row({
        id: "c",
        action: "Continue Production",
        documentNo: "WO-26-0003",
        href: "/production?from=pending-actions&workOrderId=3&flow=NO_QTY&salesOrderId=9&cycleId=2",
      }),
      row({
        id: "d",
        action: "Continue Production",
        documentNo: "WO-26-0004",
        href: "/production?from=pending-actions&workOrderId=4&flow=NO_QTY&salesOrderId=9&cycleId=2",
      }),
    ]);
    expect(cont[0]?.listHref).toContain("productionBucket=inProgress");
    expect(cont[0]?.listHref).toContain("flow=NO_QTY");
    expect(cont[0]?.openLabel).toBe("Open Production Workspace");
  });

  it("resolvePendingActionGroupKey normalizes dispatch labels", () => {
    expect(resolvePendingActionGroupKey(row({ action: "Ready to Dispatch — SO-1 — Qty 10" }))).toBe(
      "READY_TO_DISPATCH",
    );
    expect(parseReadyToDispatchQty("Ready to Dispatch — SO-1 — Qty 3710")).toBe("3710");
    expect(buildPendingActionPreviewLine(row({ action: "Ready to Dispatch — SO-1 — Qty 3710", documentNo: "SO-1" }))).toEqual({
      documentNo: "SO-1",
      detail: "Dispatchable Qty: 3710",
    });
  });

  it("create sales bill bucket opens first dispatch with work queue state", () => {
    const buckets = groupPendingActionsIntoWorkBuckets([
      row({
        id: "sb1",
        action: "Create Sales Bill",
        documentNo: "D-26-0001 · SO-26-0001 · Acme",
        href: "/sales-bills/new?dispatchId=1&from=pending-actions",
      }),
      row({
        id: "sb2",
        action: "Create Sales Bill",
        documentNo: "D-26-0002 · SO-26-0002 · Beta",
        href: "/sales-bills/88?from=pending-actions",
      }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.title).toBe("Create Sales Bill (2)");
    expect(buckets[0]?.openLabel).toBe("Open List");
    expect(buckets[0]?.openHref).toBe("/sales-bills/new?dispatchId=1&from=pending-actions");
    expect(buckets[0]?.previewLines.map((l) => l.documentNo)).toEqual(["D-26-0001", "D-26-0002"]);
    const navState = pendingActionsBucketNavigateState(buckets[0]!);
    expect(navState?.workQueue).toMatchObject({
      queueType: "CREATE_SALES_BILL",
      currentIndex: 0,
      returnToPendingActions: true,
    });
    expect(navState?.workQueue?.queueItems).toHaveLength(2);
  });
});
