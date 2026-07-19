import { describe, expect, it } from "vitest";
import {
  assessProductionEntryEligibility,
  canAcceptNewProductionEntry,
} from "../../src/lib/productionActiveEligibility";
import { buildDashboardProductionStatusRows } from "../../src/lib/dashboardProductionStatus";
import { buildProductionWorkspaceStatusCounts } from "../../src/lib/productionWorkspaceStatusCards";

describe("assessProductionEntryEligibility", () => {
  it("partially produced but not finalized → can accept (active)", () => {
    const e = assessProductionEntryEligibility({
      workOrderId: 10,
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      nextAction: "PRODUCTION_PENDING",
      producedQty: 1224,
      balanceQty: 276,
    });
    expect(e.canAcceptNewProductionEntry).toBe(true);
    expect(e.reason).toBe("READY_OR_IN_PROGRESS");
  });

  it("partially produced + final report + carried forward → not active", () => {
    const e = assessProductionEntryEligibility({
      workOrderId: 11,
      status: "IN_PROGRESS",
      productionExecutionStatus: "COMPLETED",
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      producedQty: 1224,
      balanceQty: 0,
      absorbedByLaterWo: true,
    });
    expect(e.canAcceptNewProductionEntry).toBe(false);
    expect(e.terminalForProduction).toBe(true);
    expect(e.reason).toBe("EXECUTION_COMPLETED");
  });

  it("fully produced + pending QC → not active", () => {
    const e = assessProductionEntryEligibility({
      workOrderId: 12,
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      producedQty: 1500,
      balanceQty: 0,
    });
    expect(e.canAcceptNewProductionEntry).toBe(false);
    expect(e.reason).toBe("PENDING_QA_ONLY");
  });

  it("partial produced + entry Pending QC + remaining capacity → still active", () => {
    const e = assessProductionEntryEligibility({
      workOrderId: 15,
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      nextAction: "PRODUCTION_PENDING",
      hasPendingQc: true,
      producedQty: 500,
      balanceQty: 1000,
      canAcceptProductionEntry: true,
    });
    expect(e.canAcceptNewProductionEntry).toBe(true);
    expect(e.isPendingQaOnly).toBe(false);
  });

  it("paused execution with remaining → paused not active", () => {
    const e = assessProductionEntryEligibility({
      workOrderId: 16,
      status: "IN_PROGRESS",
      productionExecutionStatus: "BLOCKED",
      nextAction: "PRODUCTION_EXECUTION_BLOCKED",
      hasPendingQc: true,
      producedQty: 500,
      balanceQty: 1000,
    });
    expect(e.canAcceptNewProductionEntry).toBe(false);
    expect(e.isPausedProduction).toBe(true);
    expect(e.reason).toBe("EXECUTION_PAUSED");
  });

  it("server flag false locks production even when qty remains", () => {
    expect(
      canAcceptNewProductionEntry({
        workOrderId: 13,
        canAcceptProductionEntry: false,
        nextAction: "PRODUCTION_PENDING",
        producedQty: 100,
        balanceQty: 50,
      }),
    ).toBe(false);
  });

  it("does not treat planned − produced alone as eligibility", () => {
    expect(
      canAcceptNewProductionEntry({
        workOrderId: 14,
        status: "IN_PROGRESS",
        productionExecutionStatus: "COMPLETED",
        nextAction: "NEXT_RS_REQUIRED",
        producedQty: 1224,
        balanceQty: 0,
        // planned-produced residual is informational only
      }),
    ).toBe(false);
  });
});

describe("Active Production list + Pending QA counter", () => {
  it("keeps four same-cycle sibling WOs independently active with business numbers", () => {
    const rows = [
      [569, "WO-26-0001", 11, "Round Plate", 3000],
      [570, "WO-26-0002", 12, "Square Box", 2000],
      [571, "WO-26-0003", 11, "Round Plate", 2000],
      [572, "WO-26-0004", 12, "Square Box", 1000],
    ].map(([workOrderId, workOrderNo, itemId, itemName, requiredQty], index) => ({
      workOrderId: Number(workOrderId), workOrderNo: String(workOrderNo), workOrderLineId: index + 1,
      itemId: Number(itemId), salesOrderId: 91, itemName: String(itemName), requiredQty: Number(requiredQty),
      producedQty: 0, balanceQty: Number(requiredQty), orderType: "NO_QTY" as const,
      status: "IN_PROGRESS", productionExecutionStatus: "NOT_STARTED", nextAction: "PRODUCTION_PENDING",
      canAcceptProductionEntry: true, cycleNo: 1,
    }));
    const built = buildDashboardProductionStatusRows(rows, { limit: 24 });
    expect(built.activeCount).toBe(4);
    expect(built.activeWorkOrderCount).toBe(4);
    expect(built.carriedForwardCount).toBe(0);
    expect(new Set(built.visible.map((r) => r.workOrderNo))).toEqual(
      new Set(["WO-26-0001", "WO-26-0002", "WO-26-0003", "WO-26-0004"]),
    );
  });

  it("finalized CF WO is not active; sibling WO in same SO stays active; history still enrichable", () => {
    const finalized = {
      workOrderId: 260002,
      workOrderNo: "WO-26-0002",
      workOrderLineId: 1,
      itemId: 99,
      salesOrderId: 245,
      salesOrderNo: "SO-245",
      itemName: "Square Box",
      requiredQty: 1500,
      producedQty: 1224,
      balanceQty: 0,
      orderType: "NO_QTY" as const,
      status: "IN_PROGRESS",
      productionExecutionStatus: "COMPLETED",
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
      cycleNo: 1,
    };
    const sibling = {
      workOrderId: 260003,
      workOrderNo: "WO-26-0003",
      workOrderLineId: 2,
      itemId: 100,
      salesOrderId: 245,
      salesOrderNo: "SO-245",
      itemName: "Other FG",
      requiredQty: 500,
      producedQty: 100,
      balanceQty: 400,
      orderType: "NO_QTY" as const,
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      nextAction: "PRODUCTION_PENDING",
      canAcceptProductionEntry: true,
      cycleNo: 1,
    };

    const built = buildDashboardProductionStatusRows([finalized, sibling], { limit: 24 });
    expect(built.all).toHaveLength(2);
    expect(built.visible.map((r) => r.workOrderId)).toEqual([260003]);
    expect(built.activeWorkOrderCount).toBe(1);
    expect(built.all.find((r) => r.workOrderId === 260002)?.countsAsActiveProduction).toBe(false);
    expect(built.all.find((r) => r.workOrderId === 260002)?.operationalStatus.label).toBe("QC Pending");

    const counts = buildProductionWorkspaceStatusCounts([finalized, sibling], [
      { workOrderId: 260002, workOrderNo: "WO-26-0002" },
    ]);
    expect(counts.pendingQa).toBe(1);
    expect(counts.waitingRmReturn).toBe(1);
    expect(counts.readyToStart).toBe(0);
  });

  it("Pending QA counter is WO-scoped (two QC lines on one WO → 1)", () => {
    const lineA = {
      workOrderId: 50,
      workOrderNo: "WO-50",
      workOrderLineId: 1,
      itemName: "A",
      requiredQty: 10,
      producedQty: 10,
      balanceQty: 0,
      nextAction: "QC_PENDING",
      hasPendingQc: true,
    };
    const lineB = {
      workOrderId: 50,
      workOrderNo: "WO-50",
      workOrderLineId: 2,
      itemName: "B",
      requiredQty: 5,
      producedQty: 5,
      balanceQty: 0,
      nextAction: "QC_PENDING",
      hasPendingQc: true,
    };
    const other = {
      workOrderId: 51,
      workOrderNo: "WO-51",
      workOrderLineId: 3,
      itemName: "C",
      requiredQty: 3,
      producedQty: 3,
      balanceQty: 0,
      nextAction: "QC_PENDING",
      hasPendingQc: true,
    };
    const counts = buildProductionWorkspaceStatusCounts([lineA, lineB, other], []);
    expect(counts.pendingQa).toBe(2);
  });

  it("finalized WO does not reopen through Active Production (countsAsActive false)", () => {
    const built = buildDashboardProductionStatusRows(
      [
        {
          workOrderId: 77,
          workOrderNo: "WO-77",
          itemName: "FG",
          requiredQty: 1500,
          producedQty: 1224,
          balanceQty: 0,
          orderType: "NO_QTY",
          itemId: 1,
          salesOrderId: 1,
          productionExecutionStatus: "COMPLETED",
          nextAction: "QC_PENDING",
          hasPendingQc: true,
          canAcceptProductionEntry: false,
          status: "IN_PROGRESS",
        },
      ],
      { limit: 8 },
    );
    expect(built.visible).toHaveLength(0);
    expect(built.activeCount).toBe(0);
  });

  it("absorbed carried-forward prior WO is not active while next-cycle WO remains", () => {
    const prior = {
      workOrderId: 167,
      workOrderNo: "WO-167",
      orderType: "NO_QTY" as const,
      itemId: 99,
      salesOrderId: 26,
      itemName: "Widget",
      requiredQty: 10000,
      producedQty: 8000,
      balanceQty: 2000,
      nextAction: "NEXT_RS_REQUIRED",
      cycleNo: 1,
      status: "IN_PROGRESS",
      productionExecutionStatus: "COMPLETED",
      canAcceptProductionEntry: false,
    };
    const next = {
      workOrderId: 168,
      workOrderNo: "WO-168",
      orderType: "NO_QTY" as const,
      itemId: 99,
      salesOrderId: 26,
      itemName: "Widget",
      requiredQty: 12000,
      producedQty: 0,
      balanceQty: 12000,
      nextAction: "PRODUCTION_PENDING",
      cycleNo: 2,
      status: "IN_PROGRESS",
      productionExecutionStatus: "NOT_STARTED",
      canAcceptProductionEntry: true,
    };
    const built = buildDashboardProductionStatusRows([prior, next], { limit: 8 });
    expect(built.visible).toHaveLength(1);
    expect(built.visible[0].workOrderId).toBe(168);
    expect(built.all.find((r) => r.workOrderId === 167)?.operationalStatus.label).toBe("Carried Forward");
  });
});
