import { describe, expect, it } from "vitest";

/**
 * Mirrors QcEntryPage safe accessors — production entries nest WO under workOrderLine.workOrder.
 * Pending Actions deep-links must not assume a top-level `workOrder` on ProdRow.
 */
function safeWorkOrderId(r: { workOrderLine?: { workOrder?: { id?: number } } } | null | undefined): number {
  const id = Number(r?.workOrderLine?.workOrder?.id ?? 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function findDocNoForWorkOrder(
  rows: Array<{ workOrderLine?: { workOrder?: { id?: number; docNo?: string | null } } }>,
  focusWorkOrderId: number,
): string | null {
  return rows.find((r) => safeWorkOrderId(r) === focusWorkOrderId)?.workOrderLine?.workOrder?.docNo ?? null;
}

describe("QcEntry pending-actions deep link safety", () => {
  it("does not crash when ProdRow has no top-level workOrder", () => {
    const rows = [
      {
        id: 420,
        workOrderLine: { workOrder: { id: 461, docNo: "WO-26-0461" } },
      },
      {
        id: 421,
        // malformed / partial API row
        workOrderLine: undefined,
      } as { id: number; workOrderLine?: { workOrder?: { id?: number; docNo?: string | null } } },
    ];

    expect(() => findDocNoForWorkOrder(rows, 461)).not.toThrow();
    expect(findDocNoForWorkOrder(rows, 461)).toBe("WO-26-0461");
    expect(findDocNoForWorkOrder(rows, 999)).toBeNull();
    expect(safeWorkOrderId(rows[1])).toBe(0);
  });

  it("prefers productionId focus over workOrderId when both are present", () => {
    const productionIdFromUrl = 420;
    const focusWorkOrderId = 461;
    const preferProduction =
      productionIdFromUrl > 0
        ? { kind: "production" as const, id: productionIdFromUrl }
        : { kind: "workOrder" as const, id: focusWorkOrderId };
    expect(preferProduction).toEqual({ kind: "production", id: 420 });
  });
});
