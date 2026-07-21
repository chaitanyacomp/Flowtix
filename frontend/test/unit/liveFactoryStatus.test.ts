import { describe, expect, it } from "vitest";
import {
  classifyLiveFactoryBucket,
  countAuthoritativeRmShortageCases,
  isAuthoritativeRmShortageRiskRow,
  liveFactoryMonitorHref,
  pickLiveFactoryHighlights,
  summarizeLiveFactoryCounters,
} from "../../src/lib/liveFactoryStatus";
import type { DashboardProductionStatusSource } from "../../src/lib/dashboardProductionStatus";

function row(partial: Partial<DashboardProductionStatusSource> = {}): DashboardProductionStatusSource {
  return {
    workOrderId: 1,
    workOrderNo: "WO-100",
    itemName: "Widget",
    requiredQty: 100,
    producedQty: 0,
    balanceQty: 100,
    orderType: "NORMAL",
    itemId: 10,
    salesOrderId: 5,
    nextAction: "PRODUCTION_PENDING",
    rmReadyForProduction: true,
    rmReadinessGate: "READY_FOR_PRODUCTION",
    productionWorkState: "READY_TO_START",
    canAcceptProductionEntry: true,
    status: "PENDING",
    ...partial,
  };
}

describe("liveFactoryStatus", () => {
  it("1. Dashboard counters: Ready WO is not Blocked", () => {
    const counters = summarizeLiveFactoryCounters([
      row({ workOrderId: 6, workOrderNo: "WO-26-0006", liveFactoryBucket: "READY_TO_START" }),
      row({ workOrderId: 7, workOrderNo: "WO-26-0007", liveFactoryBucket: "READY_TO_START" }),
      row({ workOrderId: 8, workOrderNo: "WO-26-0008", liveFactoryBucket: "READY_TO_START" }),
      row({ workOrderId: 9, workOrderNo: "WO-26-0009", liveFactoryBucket: "READY_TO_START" }),
    ]);
    expect(counters.readyToStart).toBe(4);
    expect(counters.blocked).toBe(0);
    expect(counters.running).toBe(0);
  });

  it("2. Highlights max 3–5", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ workOrderId: i + 1, workOrderNo: `WO-${i + 1}`, liveFactoryBucket: "READY_TO_START" }),
    );
    expect(pickLiveFactoryHighlights(rows, 5).length).toBe(5);
    expect(pickLiveFactoryHighlights(rows, 3).length).toBe(3);
  });

  it("4–6. Ready ≠ Blocked ≠ Running", () => {
    expect(classifyLiveFactoryBucket(row({ liveFactoryBucket: "READY_TO_START" }))).toBe("READY_TO_START");
    expect(classifyLiveFactoryBucket(row({ liveFactoryBucket: "BLOCKED" }))).toBe("BLOCKED");
    expect(
      classifyLiveFactoryBucket(
        row({
          producedQty: 20,
          balanceQty: 80,
          productionWorkState: "CONTINUE_PRODUCTION",
          liveFactoryBucket: "RUNNING",
        }),
      ),
    ).toBe("RUNNING");
  });

  it("8. Stale READY_TO_RELEASE does not create RM blocker", () => {
    expect(
      isAuthoritativeRmShortageRiskRow({
        queueType: "READY_TO_RELEASE_WO",
        status: "LOW_BUFFER",
        shortageQty: 0,
      }),
    ).toBe(false);
    expect(
      countAuthoritativeRmShortageCases([
        {
          workOrderId: 9,
          workOrderNo: "WO-26-0009",
          queueType: "READY_TO_RELEASE_WO",
          status: "LOW_BUFFER",
          shortageQty: 0,
        },
      ]).caseCount,
    ).toBe(0);
  });

  it("9. View Full Factory Monitor opens Control Tower with Production filter", () => {
    expect(liveFactoryMonitorHref()).toBe("/control-tower?group=PRODUCTION&focus=factory");
  });
});
