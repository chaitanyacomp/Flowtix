import { describe, expect, it } from "vitest";
import type { WoTrackingRow } from "../../src/lib/woTrackingResponse";
import {
  classifyRecoveryBadge,
  computeNoQtyKpiStrip,
  filterRowsByWoScope,
  formatProgressPair,
  includeClosedForScope,
  productionProgress,
  statusDisplay,
} from "../../src/lib/woTrackingReportUi";

function row(partial: Partial<WoTrackingRow>): WoTrackingRow {
  return {
    workOrderLineId: 1,
    salesOrderId: 1,
    salesOrderNo: "SO-1",
    salesOrderDate: "2026-07-01T00:00:00.000Z",
    customerName: "Acme",
    workOrderId: 10,
    workOrderNo: "WO-10",
    workOrderDate: "2026-07-01T00:00:00.000Z",
    workOrderStatus: "IN_PROGRESS",
    itemId: 5,
    itemName: "FG",
    orderedQty: null,
    customerDemandQty: 80,
    workOrderQty: 100,
    requiredQty: 100,
    plannedQty: 2000,
    producedQty: 1905,
    acceptedQty: 1892,
    rejectedQty: 13,
    dispatchedQty: 3782,
    productionPendingQty: 0,
    qcPendingQty: 0,
    dispatchPendingQty: 0,
    status: "COMPLETED",
    ...partial,
  };
}

describe("woTrackingReportUi", () => {
  it("formats production progress compactly", () => {
    const p = productionProgress(row({}));
    expect(p.label).toBe(formatProgressPair(1905, 2000));
    expect(p.label).toBe("1905 / 2000");
  });

  it("maps recovery outcome to badge kinds", () => {
    expect(classifyRecoveryBadge(row({ recoveryCarryForwardOutcome: "NONE" }))).toBe("NONE");
    expect(
      classifyRecoveryBadge(
        row({ recoveryCarryForwardOutcome: "PRODUCTION SHORTFALL: KEEP / carry-forward (12)" }),
      ),
    ).toBe("KEEP");
    expect(
      classifyRecoveryBadge(row({ recoveryCarryForwardOutcome: "PRODUCTION SHORTFALL: WAIVE (20)" })),
    ).toBe("WAIVED");
  });

  it("maps status to single-line labels including Cycle/SO Closed", () => {
    expect(statusDisplay(row({ status: "IN_PRODUCTION" }), true).label).toBe("In Production");
    expect(
      statusDisplay(
        row({ status: "COMPLETED", salesOrderInternalStatus: "CLOSED_WITH_WAIVER" }),
        true,
      ).label,
    ).toBe("SO Closed");
    expect(
      statusDisplay(row({ status: "COMPLETED", cycleStatus: "CLOSED", cycleNo: 1 }), true).label,
    ).toBe("Cycle Closed");
    expect(statusDisplay(row({ status: "SHORTFALL_PENDING" }), true).label).toBe("Carry Forward");
  });

  it("Open/Closed/All scope filtering and includeClosed mapping", () => {
    expect(includeClosedForScope("open")).toBe(false);
    expect(includeClosedForScope("closed")).toBe(true);
    expect(includeClosedForScope("all")).toBe(true);
    const rows = [
      row({ workOrderLineId: 1, status: "IN_PRODUCTION", cycleStatus: "ACTIVE", workOrderStatus: "IN_PROGRESS" }),
      row({
        workOrderLineId: 2,
        status: "COMPLETED",
        cycleStatus: "CLOSED",
        workOrderStatus: "COMPLETED",
        salesOrderInternalStatus: "COMPLETED",
      }),
    ];
    expect(filterRowsByWoScope(rows, "open", true)).toHaveLength(1);
    expect(filterRowsByWoScope(rows, "closed", true)).toHaveLength(1);
    expect(filterRowsByWoScope(rows, "all", true)).toHaveLength(2);
  });

  it("computes NO_QTY KPI strip from rows", () => {
    const kpis = computeNoQtyKpiStrip([
      row({
        workOrderId: 1,
        cycleId: 10,
        cycleStatus: "ACTIVE",
        status: "IN_PRODUCTION",
        workOrderStatus: "IN_PROGRESS",
        activeProductionPendingQty: 5,
        recoveryAllocatedQty: 12,
        recoveryCarryForwardOutcome: "OPEN (3)",
        recoverySourceStatus: "OPEN",
      }),
      row({
        workOrderLineId: 2,
        workOrderId: 2,
        cycleId: 10,
        cycleStatus: "ACTIVE",
        status: "IN_PRODUCTION",
        workOrderStatus: "IN_PROGRESS",
        activeProductionPendingQty: 2,
        recoveryAllocatedQty: 0,
        recoveryCarryForwardOutcome: "NONE",
      }),
    ]);
    expect(kpis.openWos).toBe(2);
    expect(kpis.openCycles).toBe(1);
    expect(kpis.activeProductionPending).toBe(7);
    expect(kpis.carryForwardQty).toBe(12);
    expect(kpis.recoveryPending).toBeGreaterThanOrEqual(1);
  });
});
