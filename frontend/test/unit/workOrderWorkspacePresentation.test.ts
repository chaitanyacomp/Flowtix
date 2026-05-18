import { describe, expect, it } from "vitest";

import {
  buildCycleOutcomeFromQueueLines,
  buildWorkOrderWorkspaceSections,
  formatCycleHistoryOutcomeLine,
  formatOperationalOutcomeLine,
  noQtyWorkspaceActionLabel,
  noQtyWorkspaceStatusLabel,
} from "../../src/lib/workOrderWorkspacePresentation";
import { buildDashboardProductionStatusRows } from "../../src/lib/dashboardProductionStatus";
import type { DashboardProductionStatusSource } from "../../src/lib/dashboardProductionStatus";

function queueRow(partial: Partial<DashboardProductionStatusSource> = {}): DashboardProductionStatusSource {
  return {
    workOrderId: 1,
    workOrderNo: "WO-1",
    itemName: "Widget",
    requiredQty: 10000,
    producedQty: 0,
    balanceQty: 10000,
    orderType: "NO_QTY",
    itemId: 10,
    salesOrderId: 26,
    ...partial,
  };
}

describe("noQtyWorkspaceStatusLabel", () => {
  it("maps next cycle dashboard label to workspace label", () => {
    expect(noQtyWorkspaceStatusLabel("Next Cycle")).toBe("Next Cycle Pending");
  });
});

describe("noQtyWorkspaceActionLabel", () => {
  it("maps production route to Continue Production", () => {
    expect(noQtyWorkspaceActionLabel("/production?source=no_qty_so&salesOrderId=1")).toBe("Continue Production");
  });
  it("maps requirement route to Next Cycle", () => {
    expect(
      noQtyWorkspaceActionLabel("/sales-orders/26/requirement-sheets?intent=add&source=no_qty_so"),
    ).toBe("Next Cycle");
  });
});

describe("buildWorkOrderWorkspaceSections", () => {
  it("puts carried-forward WO in history, active WO in operational open", () => {
    const wo167 = queueRow({
      workOrderId: 167,
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "NEXT_RS_REQUIRED",
      cycleNo: 1,
    });
    const wo168 = queueRow({
      workOrderId: 168,
      producedQty: 0,
      balanceQty: 12000,
      nextAction: "PRODUCTION_PENDING",
      cycleNo: 2,
    });
    const sections = buildWorkOrderWorkspaceSections([wo167, wo168], [], []);
    expect(sections.operationalOpen.map((g) => g.woId)).toEqual([168]);
    expect(sections.cycleHistory.map((g) => g.woId)).toEqual([167]);
    expect(sections.cycleHistory[0]?.presentationStatus).toBe("Carried Forward");
    expect(sections.cycleHistory[0]?.actionLabel).toBe("View Cycle");
    expect(sections.operationalOpen[0]?.presentationStatus).toBe("In Progress");
  });

  it("formats history outcome with operator pending (planned − produced)", () => {
    const wo167 = queueRow({
      workOrderId: 167,
      requiredQty: 4295,
      producedQty: 4100,
      balanceQty: 195,
      lastShortageQty: 100,
      nextAction: "NEXT_RS_REQUIRED",
      cycleNo: 5,
    });
    const built = buildDashboardProductionStatusRows([wo167], { limit: 1 });
    const trace = buildCycleOutcomeFromQueueLines(built.visible);
    expect(trace.rsQty).toBe(4295);
    expect(trace.produced).toBe(4100);
    expect(trace.pendingQty).toBe(195);
    expect(trace.erpAdjustedPlanningQty).toBe(100);
    expect(formatCycleHistoryOutcomeLine(trace)).toBe("RS 4,295 · Produced 4,100 · Pending qty 195");
    expect(formatOperationalOutcomeLine(trace, { nextCycle: true })).toBe(
      "Planned 4,295 · Produced 4,100 · Pending qty 195",
    );
  });

  it("does not put dispatchable headroom-only row in operational open as dispatch", () => {
    const r = queueRow({
      workOrderId: 169,
      producedQty: 8000,
      balanceQty: 2000,
      dispatchableQty: 500,
      nextAction: "NEXT_RS_REQUIRED",
      actionHref:
        "/sales-orders/26/requirement-sheets?intent=add&source=no_qty_so&salesOrderId=26",
    });
    const sections = buildWorkOrderWorkspaceSections([r], [], []);
    expect(sections.operationalOpen[0]?.presentationStatus).toBe("Next Cycle Pending");
    expect(sections.operationalOpen[0]?.actionLabel).toBe("Next Cycle");
  });
});
