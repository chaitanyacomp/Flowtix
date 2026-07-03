import { describe, expect, it, vi } from "vitest";
import {
  buildCreateSalesBillWorkQueue,
  navigateOpenNextWorkQueueItem,
  parsePendingActionSalesBillTarget,
  remainingWorkQueueCount,
  workQueueItemFromPendingAction,
  workQueuePositionLabel,
} from "../../src/lib/workQueueContext";
import type { PendingAction } from "../../src/lib/pendingActionsApi";

function salesBillRow(partial: Partial<PendingAction> & { documentNo: string; href: string }): PendingAction {
  return {
    id: partial.id ?? "admin:sales-bill:dispatch:1",
    priority: "MEDIUM",
    action: "Create Sales Bill",
    ownerRole: "ADMIN",
    ageHours: 2,
    ...partial,
  };
}

describe("workQueueContext", () => {
  it("parses draft bill and new-dispatch href targets", () => {
    expect(parsePendingActionSalesBillTarget("/sales-bills/42?from=pending-actions")).toEqual({ billId: 42 });
    expect(parsePendingActionSalesBillTarget("/sales-bills/new?dispatchId=7&from=pending-actions")).toEqual({
      dispatchId: 7,
    });
  });

  it("builds create-sales-bill queue from pending actions", () => {
    const queue = buildCreateSalesBillWorkQueue([
      salesBillRow({
        id: "a",
        documentNo: "D-26-0001 · SO-26-0001 · Acme",
        href: "/sales-bills/new?dispatchId=1&from=pending-actions",
      }),
      salesBillRow({
        id: "b",
        documentNo: "D-26-0002 · SO-26-0002 · Beta",
        href: "/sales-bills/99?from=pending-actions",
      }),
    ]);
    expect(queue).toMatchObject({
      queueType: "CREATE_SALES_BILL",
      currentIndex: 0,
      returnToPendingActions: true,
    });
    expect(queue?.queueItems).toHaveLength(2);
    expect(queue?.queueItems[0]).toMatchObject({ dispatchId: 1, documentNo: "D-26-0001 · SO-26-0001 · Acme" });
    expect(queue?.queueItems[1]).toMatchObject({ billId: 99, documentNo: "D-26-0002 · SO-26-0002 · Beta" });
  });

  it("computes remaining queue count after current item", () => {
    const queue = buildCreateSalesBillWorkQueue([
      salesBillRow({ documentNo: "D-1", href: "/sales-bills/new?dispatchId=1&from=pending-actions" }),
      salesBillRow({ id: "b", documentNo: "D-2", href: "/sales-bills/new?dispatchId=2&from=pending-actions" }),
      salesBillRow({ id: "c", documentNo: "D-3", href: "/sales-bills/new?dispatchId=3&from=pending-actions" }),
    ]);
    expect(queue).not.toBeNull();
    if (!queue) return;
    expect(remainingWorkQueueCount(queue, true)).toBe(2);
    expect(workQueuePositionLabel(queue)).toBe("Document 1 of 3");
    expect(remainingWorkQueueCount({ ...queue, currentIndex: 2 }, true)).toBe(0);
  });

  it("navigateOpenNextWorkQueueItem advances with replace navigation", () => {
    const queue = buildCreateSalesBillWorkQueue([
      salesBillRow({ documentNo: "D-1", href: "/sales-bills/new?dispatchId=1&from=pending-actions" }),
      salesBillRow({ id: "b", documentNo: "D-2", href: "/sales-bills/55?from=pending-actions" }),
    ]);
    expect(queue).not.toBeNull();
    if (!queue) return;
    const navigate = vi.fn();
    expect(navigateOpenNextWorkQueueItem(navigate, queue)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      "/sales-bills/55?from=pending-actions",
      expect.objectContaining({
        replace: true,
        state: expect.objectContaining({
          workQueue: expect.objectContaining({ currentIndex: 1 }),
        }),
      }),
    );
  });

  it("workQueueItemFromPendingAction maps pending row fields", () => {
    const item = workQueueItemFromPendingAction(
      salesBillRow({
        id: "admin:sales-bill:dispatch:12",
        documentNo: "D-26-0012",
        href: "/sales-bills/new?dispatchId=12&from=pending-actions",
      }),
    );
    expect(item).toEqual({
      id: "admin:sales-bill:dispatch:12",
      documentNo: "D-26-0012",
      href: "/sales-bills/new?dispatchId=12&from=pending-actions",
      dispatchId: 12,
    });
  });
});
