import { describe, expect, it } from "vitest";
import {
  filterActionableDispatchBacklogRows,
  type DispatchBacklogRow,
} from "../../src/lib/dispatchBacklog";

function row(partial: Partial<DispatchBacklogRow> & Pick<DispatchBacklogRow, "salesOrderId" | "itemId">): DispatchBacklogRow {
  return {
    salesOrderNo: `SO-${partial.salesOrderId}`,
    customerName: "Acme",
    itemName: partial.itemName ?? "Item",
    orderedQty: partial.orderedQty ?? 100,
    dispatchedQty: partial.dispatchedQty ?? 0,
    pendingQty: partial.pendingQty ?? 100,
    dispatchableNow: partial.dispatchableNow ?? 0,
    salesOrderDate: "2026-07-01T00:00:00.000Z",
    status: "IN_PROCESS",
    ...partial,
  };
}

describe("filterActionableDispatchBacklogRows", () => {
  it("three blocked lines with dispatchableQty=0 → backlog 0 (matches Cannot prepare now)", () => {
    const blocked = [
      row({ salesOrderId: 252, itemId: 1, itemName: "Square Box", pendingQty: 100, dispatchableNow: 0 }),
      row({ salesOrderId: 252, itemId: 2, itemName: "Round Plate", pendingQty: 50, dispatchableNow: 0 }),
      row({ salesOrderId: 252, itemId: 3, itemName: "PVC Angle", pendingQty: 25, dispatchableNow: 0 }),
    ];
    expect(filterActionableDispatchBacklogRows(blocked)).toEqual([]);
  });

  it("one line with positive QC/stock headroom → ready 1", () => {
    const rows = [
      row({ salesOrderId: 1, itemId: 1, pendingQty: 100, dispatchableNow: 0 }),
      row({ salesOrderId: 1, itemId: 2, pendingQty: 80, dispatchableNow: 40 }),
    ];
    const out = filterActionableDispatchBacklogRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].dispatchableNow).toBe(40);
  });

  it("historical ledger / zero-balance rows never increase backlog", () => {
    const rows = [
      row({ salesOrderId: 9, itemId: 1, pendingQty: 0, dispatchableNow: 0, orderedQty: 10, dispatchedQty: 10 }),
      row({ salesOrderId: 9, itemId: 2, pendingQty: 0, dispatchableNow: 0 }),
    ];
    expect(filterActionableDispatchBacklogRows(rows)).toHaveLength(0);
  });

  it("dashboard count matches workspace prepare-headroom category only", () => {
    const workspacePrepareHeadroom = [
      row({ salesOrderId: 3, itemId: 1, pendingQty: 20, dispatchableNow: 15 }),
    ];
    const workspaceCannotPrepare = [
      row({ salesOrderId: 3, itemId: 2, pendingQty: 30, dispatchableNow: 0 }),
      row({ salesOrderId: 3, itemId: 3, pendingQty: 10, dispatchableNow: 0 }),
    ];
    const dashboard = filterActionableDispatchBacklogRows([
      ...workspacePrepareHeadroom,
      ...workspaceCannotPrepare,
    ]);
    expect(dashboard).toHaveLength(workspacePrepareHeadroom.length);
    expect(dashboard.every((r) => Number(r.dispatchableNow) > 0)).toBe(true);
  });
});
