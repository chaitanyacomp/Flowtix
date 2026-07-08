import { describe, expect, it, vi } from "vitest";
import {
  isFreshProductionReadinessExecutable,
  pickFreshExecutableProductionLine,
} from "../../src/lib/productionWorkspaceReadiness";
import { buildReadinessSeedFromQueueRow } from "../../src/lib/productionWorkspaceReadinessUx";
import type { ProductionRmReadiness } from "../../src/components/erp/ProductionRmReadinessStrip";

function readiness(partial: Partial<ProductionRmReadiness> = {}): ProductionRmReadiness {
  return {
    gate: "READY_FOR_PRODUCTION",
    fgItemName: "Cap",
    fgUnit: "Nos",
    woQty: 100,
    productionAllowedNowQty: 100,
    maxAdditionalQty: 100,
    latestPmrId: 10,
    latestPmrDocNo: "PMR-10",
    workOrderId: 20,
    workOrderLineId: 200,
    rmLines: [{ status: "READY" } as never],
    flags: {
      readyForProduction: true,
      materialReleasedToProduction: true,
    },
    ...partial,
  };
}

describe("productionWorkspaceReadiness", () => {
  it("treats store-issued READY_FOR_PRODUCTION state as immediately executable", () => {
    expect(isFreshProductionReadinessExecutable(readiness())).toBe(true);
  });

  it("does not treat waiting RM state as executable even when queue qty remains", () => {
    expect(
      isFreshProductionReadinessExecutable(
        readiness({
          gate: "WAITING_STORE_ISSUE",
          productionAllowedNowQty: 0,
        }),
      ),
    ).toBe(false);
  });

  it("auto-advance skips cached previous-WO waiting state and uses fresh readiness per candidate", async () => {
    const fetchReadiness = vi
      .fn()
      .mockResolvedValueOnce(readiness({ workOrderId: 11, workOrderLineId: 101, gate: "WAITING_STORE_ISSUE" }))
      .mockResolvedValueOnce(readiness({ workOrderId: 12, workOrderLineId: 102 }));

    const pick = await pickFreshExecutableProductionLine(
      [
        { id: 101, workOrderId: 11, remainingQty: 50 },
        { id: 102, workOrderId: 12, remainingQty: 60 },
      ],
      fetchReadiness,
    );

    expect(fetchReadiness).toHaveBeenNthCalledWith(1, 101);
    expect(fetchReadiness).toHaveBeenNthCalledWith(2, 102);
    expect(pick?.line.workOrderId).toBe(12);
    expect(pick?.readiness.workOrderLineId).toBe(102);
  });

  it("prefers queue-seeded readiness and skips RM fetch when backend gate is sufficient", async () => {
    const fetchReadiness = vi.fn();
    const queueByLineId = new Map([
      [
        101,
        {
          workOrderId: 11,
          workOrderLineId: 101,
          workOrderNo: "WO-11",
          itemName: "Cap",
          requiredQty: 50,
          producedQty: 0,
          balanceQty: 50,
          nextAction: "PRODUCTION_PENDING",
          rmReadinessGate: "WAITING_STORE_ISSUE",
          rmReadyForProduction: false,
        },
      ],
      [
        102,
        {
          workOrderId: 12,
          workOrderLineId: 102,
          workOrderNo: "WO-12",
          itemName: "Cap",
          requiredQty: 60,
          producedQty: 0,
          balanceQty: 60,
          nextAction: "PRODUCTION_PENDING",
          rmReadinessGate: "READY_FOR_PRODUCTION",
          rmReadyForProduction: true,
          rmProductionAllowedNowQty: 60,
        },
      ],
    ]);

    const pick = await pickFreshExecutableProductionLine(
      [
        { id: 101, workOrderId: 11, remainingQty: 50 },
        { id: 102, workOrderId: 12, remainingQty: 60 },
      ],
      fetchReadiness,
      queueByLineId,
    );

    expect(fetchReadiness).not.toHaveBeenCalled();
    expect(pick).not.toBeNull();
    expect(pick?.line.id).toBe(102);
    expect(pick?.readiness.gate).toBe("READY_FOR_PRODUCTION");
  });

  it("queue seed from production-queue row is executable without RM fetch", () => {
    const seed = buildReadinessSeedFromQueueRow({
      workOrderId: 12,
      workOrderLineId: 102,
      workOrderNo: "WO-12",
      itemName: "Cap",
      requiredQty: 60,
      producedQty: 0,
      balanceQty: 60,
      nextAction: "PRODUCTION_PENDING",
      rmReadinessGate: "READY_FOR_PRODUCTION",
      rmReadyForProduction: true,
      rmProductionAllowedNowQty: 60,
    });
    expect(isFreshProductionReadinessExecutable(seed)).toBe(true);
  });

  it("returns null when no FIFO candidate is fresh-RM executable", async () => {
    const pick = await pickFreshExecutableProductionLine(
      [{ id: 101, workOrderId: 11, remainingQty: 50 }],
      async () => readiness({ gate: "WAITING_RELEASE_TO_PRODUCTION" }),
    );

    expect(pick).toBeNull();
  });
});
