import { describe, expect, it } from "vitest";
import {
  isNoQtyDispatchReadyFromNextAction,
  mapRegularPostQcDispatchHandoff,
  parseProductionIdFromQcRef,
  qcQueueRowHref,
  qcStatusFromRollups,
} from "../../src/lib/qcWorkspaceReadinessUx";
import { resolveProductionBatchQcRollups } from "../../src/lib/qcBatchRollups";

describe("qcWorkspaceReadinessUx", () => {
  it("maps REGULAR post-QC dispatch from fg-work-order-balance fields only", () => {
    expect(
      mapRegularPostQcDispatchHandoff({
        balanceItem: { itemId: 1, pendingSoQty: 1000, dispatchableQty: 1000, shortageQty: 0 },
        batchAcceptedQty: 800,
        batchRejectedQty: 0,
        workOrderId: 9,
      }),
    ).toMatchObject({ kind: "DISPATCH_ONLY", dispatchableNow: 1000, qtyPendingToDeliver: 1000 });

    expect(
      mapRegularPostQcDispatchHandoff({
        balanceItem: { itemId: 1, pendingSoQty: 1000, dispatchableQty: 400, shortageQty: 600 },
        batchAcceptedQty: 500,
        batchRejectedQty: 10,
        workOrderId: 9,
      }),
    ).toMatchObject({ kind: "DECISION", workOrderShortfall: 600 });

    expect(
      mapRegularPostQcDispatchHandoff({
        balanceItem: { itemId: 1, pendingSoQty: 1000, dispatchableQty: 0, shortageQty: 1000 },
        batchAcceptedQty: 0,
        batchRejectedQty: 0,
        workOrderId: 9,
      }),
    ).toMatchObject({ kind: "SHORTFALL_WO" });
  });

  it("returns null when backend balance has no pending SO qty", () => {
    expect(
      mapRegularPostQcDispatchHandoff({
        balanceItem: { itemId: 1, pendingSoQty: 0, dispatchableQty: 0 },
        batchAcceptedQty: 100,
        batchRejectedQty: 0,
        workOrderId: 1,
      }),
    ).toBeNull();
  });

  it("detects NO_QTY dispatch readiness from backend next-action", () => {
    expect(
      isNoQtyDispatchReadyFromNextAction({
        nextAction: "STORE",
        primaryAction: "DISPATCH",
        dispatchableQty: 50,
      }),
    ).toBe(true);
    expect(
      isNoQtyDispatchReadyFromNextAction({
        nextAction: "PRODUCTION",
        dispatchableQty: 50,
      }),
    ).toBe(false);
  });

  it("builds qc-entry href from dashboard qc-queue row", () => {
    expect(parseProductionIdFromQcRef("PE-42")).toBe(42);
    expect(
      qcQueueRowHref({
        qcRef: "PE-42",
        salesOrderId: 5,
        workOrderId: 9,
        orderType: "NORMAL",
      }),
    ).toContain("productionId=42");
    expect(
      qcQueueRowHref({
        qcRef: "PE-7",
        salesOrderId: 3,
        workOrderId: 2,
        orderType: "NO_QTY",
        cycleId: 11,
      }),
    ).toContain("cycleId=11");
  });

  it("classifies QC batch status from rollups", () => {
    expect(qcStatusFromRollups({ accepted: 0, rejected: 0, pending: 10 })).toBe("AWAITING_QC");
    expect(qcStatusFromRollups({ accepted: 5, rejected: 0, pending: 5 })).toBe("PARTIAL_QC");
    expect(qcStatusFromRollups({ accepted: 10, rejected: 0, pending: 0 })).toBe("COMPLETED_QC");
  });
});

describe("resolveProductionBatchQcRollups", () => {
  it("prefers backend API rollup fields over local qcEntries math", () => {
    const fromApi = resolveProductionBatchQcRollups({
      producedQty: 100,
      qcAcceptedQty: 60,
      qcRejectedQty: 10,
      qcPendingQty: 30,
      qcEntries: [{ acceptedQty: 999, rejectedQty: 0 }],
    });
    expect(fromApi).toEqual({ produced: 100, accepted: 60, rejected: 10, pending: 30 });
  });
});
