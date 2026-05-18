import { describe, expect, it } from "vitest";

import {
  resolveNoQtyCycleDisplayStatus,
  resolveNoQtyCycleDisplayStatusForWorkOrder,
} from "../../src/lib/noQtyCycleDisplayStatus";
import type { DashboardProductionStatusSource } from "../../src/lib/dashboardProductionStatus";

function row(partial: Partial<DashboardProductionStatusSource> = {}): DashboardProductionStatusSource {
  return {
    workOrderId: 167,
    workOrderNo: "WO-167",
    itemName: "Widget",
    requiredQty: 10000,
    producedQty: 8000,
    balanceQty: 2000,
    orderType: "NO_QTY",
    itemId: 99,
    salesOrderId: 26,
    status: "IN_PROGRESS",
    cycleNo: 4,
    ...partial,
  };
}

describe("resolveNoQtyCycleDisplayStatus", () => {
  it("shows Carried Forward when shortage absorbed by later WO (not IN_PROGRESS)", () => {
    const older = row({ workOrderId: 167, cycleNo: 4, producedQty: 8000, balanceQty: 2000 });
    const newer = row({
      workOrderId: 168,
      cycleNo: 5,
      producedQty: 0,
      balanceQty: 12000,
      nextAction: "PRODUCTION_PENDING",
    });
    const display = resolveNoQtyCycleDisplayStatus({
      ...older,
      allQueueRows: [older, newer],
      woLifecycleStatus: "IN_PROGRESS",
      isPriorCycle: true,
      scope: "historical",
    });
    expect(display.label).toBe("Carried Forward");
    expect(display.isHistorical).toBe(true);
  });

  it("maps active production to In Progress", () => {
    const r = row({
      workOrderId: 168,
      cycleNo: 5,
      producedQty: 100,
      balanceQty: 900,
      nextAction: "PRODUCTION_PENDING",
    });
    const display = resolveNoQtyCycleDisplayStatus({ ...r, allQueueRows: [r] });
    expect(display.label).toBe("In Progress");
    expect(display.isHistorical).toBe(false);
  });

  it("maps QC pending for active cycle", () => {
    const r = row({
      producedQty: 10000,
      balanceQty: 0,
      nextAction: "QC_PENDING",
      hasPendingQc: true,
    });
    const display = resolveNoQtyCycleDisplayStatus({ ...r, allQueueRows: [r] });
    expect(display.label).toBe("QC Pending");
  });
});

describe("resolveNoQtyCycleDisplayStatusForWorkOrder", () => {
  it("uses queue rows over raw WO IN_PROGRESS for prior cycle", () => {
    const older = row({ workOrderId: 167, cycleNo: 4 });
    const newer = row({ workOrderId: 168, cycleNo: 5, nextAction: "PRODUCTION_PENDING" });
    const display = resolveNoQtyCycleDisplayStatusForWorkOrder(
      { id: 167, status: "IN_PROGRESS", salesOrderId: 26, cycleId: 40, cycle: { cycleNo: 4 }, lines: [{ qty: "10000" }] },
      [older, newer],
      { isPriorCycle: true, scope: "historical" },
    );
    expect(display.label).toBe("Carried Forward");
  });
});
