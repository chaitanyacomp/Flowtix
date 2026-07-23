import { describe, expect, it } from "vitest";
import { assessProductionEntryEligibility } from "../../src/lib/productionActiveEligibility";
import {
  buildProductionWorkspaceSectionCounts,
  buildProductionWorkspaceSectionRows,
  classifyProductionWorkspaceSection,
  filterProductionWorkspaceRows,
} from "../../src/lib/productionWorkspaceSections";

describe("production pause / entry QC separation", () => {
  it("partial 500 of 1500 with entry Pending QC stays Active (not QC-only)", () => {
    const row = {
      workOrderId: 260004,
      workOrderNo: "WO-26-0004",
      itemName: "Square Box",
      requiredQty: 1500,
      producedQty: 500,
      balanceQty: 1000,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      nextAction: "PRODUCTION_PENDING",
      hasPendingQc: true,
      canAcceptProductionEntry: true,
    };
    const e = assessProductionEntryEligibility(row);
    expect(e.canAcceptNewProductionEntry).toBe(true);
    expect(e.isPausedProduction).toBe(false);
    expect(e.isPendingQaOnly).toBe(false);
    expect(classifyProductionWorkspaceSection(row)).toBe("active");
  });

  it("pause → Paused section with remaining 1000; not Active", () => {
    const row = {
      workOrderId: 260004,
      workOrderNo: "WO-26-0004",
      itemName: "Square Box",
      requiredQty: 1500,
      producedQty: 500,
      balanceQty: 1000,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "BLOCKED",
      nextAction: "PRODUCTION_EXECUTION_BLOCKED",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
      productionBlockReasonLabel: "Waiting for RM",
      pausedAt: "2026-07-18T10:00:00.000Z",
    };
    const e = assessProductionEntryEligibility(row);
    expect(e.canAcceptNewProductionEntry).toBe(false);
    expect(e.isPausedProduction).toBe(true);
    expect(e.terminalForProduction).toBe(false);
    expect(classifyProductionWorkspaceSection(row)).toBe("paused");
  });

  it("fully produced + Pending QC (execution final) → Pending QA only", () => {
    const row = {
      workOrderId: 99,
      itemName: "FG",
      requiredQty: 1500,
      producedQty: 1500,
      balanceQty: 0,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "COMPLETED",
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
    };
    const e = assessProductionEntryEligibility(row);
    expect(e.canAcceptNewProductionEntry).toBe(false);
    expect(e.isPendingQaOnly).toBe(true);
    expect(classifyProductionWorkspaceSection(row)).toBe("pendingQa");
  });

  it("extra production with unconfirmed report → Production Report Pending (QC may coexist)", () => {
    const row = {
      workOrderId: 260001,
      workOrderNo: "WO-26-0001",
      itemName: "FG",
      requiredQty: 3000,
      producedQty: 3075,
      balanceQty: 0,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "SHORTFALL_PENDING",
      nextAction: "PRODUCTION_SHORTFALL_DECISION",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
    };
    expect(classifyProductionWorkspaceSection(row)).toBe("reportPending");
  });

  it("places a finalized Regular report in Pending QA, not Report Pending", () => {
    const finalizedRegular = {
      workOrderId: 639,
      workOrderNo: "WO-26-0001",
      itemName: "Nozzle",
      requiredQty: 15075,
      producedQty: 14958,
      balanceQty: 117,
      orderType: "NORMAL",
      status: "IN_PROGRESS",
      productionExecutionStatus: "SHORTFALL_PENDING",
      productionReportConfirmed: true,
      productionReportId: 197,
      nextAction: "QC_PENDING",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
    };
    const built = buildProductionWorkspaceSectionRows([finalizedRegular]);
    expect(built.reportPending).toHaveLength(0);
    expect(built.pendingQa.map((row) => row.workOrderId)).toEqual([639]);
    const counts = buildProductionWorkspaceSectionCounts(
      [finalizedRegular],
      [{ id: 52, workOrderId: 639, requestedQty: 1, unit: "Kg", status: "PENDING" }],
    );
    expect(counts.reportPending).toBe(0);
    expect(counts.pendingQa).toBe(1);
    expect(counts.awaitingStore).toBe(1);
  });

  it("sections keep paused and active independent in same cycle", () => {
    const paused = {
      workOrderId: 4,
      workOrderNo: "WO-4",
      itemName: "Square Box",
      requiredQty: 1500,
      producedQty: 500,
      balanceQty: 1000,
      orderType: "NO_QTY" as const,
      itemId: 1,
      salesOrderId: 1,
      status: "IN_PROGRESS",
      productionExecutionStatus: "BLOCKED",
      nextAction: "PRODUCTION_EXECUTION_BLOCKED",
      hasPendingQc: true,
      canAcceptProductionEntry: false,
    };
    const active = {
      workOrderId: 3,
      workOrderNo: "WO-3",
      itemName: "Round Plate",
      requiredQty: 2000,
      producedQty: 0,
      balanceQty: 2000,
      orderType: "NO_QTY" as const,
      itemId: 2,
      salesOrderId: 1,
      status: "IN_PROGRESS",
      productionExecutionStatus: "NOT_STARTED",
      nextAction: "PRODUCTION_PENDING",
      canAcceptProductionEntry: true,
    };
    const built = buildProductionWorkspaceSectionRows([paused, active]);
    expect(built.ready.map((r) => r.workOrderId)).toEqual([3]);
    expect(built.paused.map((r) => r.workOrderId)).toEqual([4]);
  });

  it("search/filter supports 25 concurrent rows", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      workOrderId: 100 + i,
      workOrderNo: `WO-${100 + i}`,
      itemName: i % 2 === 0 ? "Square Box" : "Round Plate",
      requiredQty: 100,
      producedQty: 10,
      balanceQty: 90,
      remainingQty: 90,
      shortageQty: 90,
      erpAdjustedPlanningQty: 0,
      progressPct: 10,
      showProgressBar: true,
      countsAsActive: true,
      countsAsActiveProduction: true,
      sortRank: 0,
      flowLabel: "NO_QTY",
      operationalStatus: { label: "Continue Production", tone: "running" as const },
      orderType: "NO_QTY" as const,
      salesOrderId: 200 + i,
      salesOrderNo: `SO-${200 + i}`,
      customerName: `Cust ${i}`,
      productionExecutionStatus: "RUNNING",
      nextAction: "PRODUCTION_PENDING",
      canAcceptProductionEntry: true,
    }));
    const filtered = filterProductionWorkspaceRows(rows, { query: "square", flow: "NO_QTY" });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((r) => r.itemName.toLowerCase().includes("square"))).toBe(true);
  });

  it("uses backend work-state and parks every blocking draft under Draft Awaiting Approval", () => {
    const draftReady = {
      workOrderId: 501,
      workOrderNo: "WO-26-0501",
      itemName: "Round Plate",
      requiredQty: 6000,
      producedQty: 0,
      balanceQty: 6000,
      productionWorkState: "READY_TO_START" as const,
      hasOpenDraft: true,
      openDraftProductionId: 91,
      canAcceptProductionEntry: false,
    };
    const draftContinue = {
      ...draftReady,
      workOrderId: 502,
      producedQty: 3000,
      balanceQty: 3000,
      productionWorkState: "CONTINUE_PRODUCTION" as const,
    };
    expect(classifyProductionWorkspaceSection(draftReady)).toBe("draftPending");
    expect(classifyProductionWorkspaceSection(draftContinue)).toBe("draftPending");
  });
});
