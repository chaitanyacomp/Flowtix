import { describe, expect, it } from "vitest";
import {
  buildStoreMonitorWorkspaceParity,
  buildStoreProductionMonitorCounts,
  enrichStoreProductionMonitorRow,
  filterStoreProductionMonitorRows,
  formatMonitorQty,
  formatMonitorUnitLabel,
  isStoreProductionMutationHref,
  sortStoreProductionMonitorRows,
  workbenchStateToMonitorStatus,
} from "../../src/lib/storeProductionMonitor";
import { classifyProductionWorkbenchState } from "../../src/lib/productionWorkbenchState";

function baseRow(partial: Record<string, unknown>) {
  return {
    workOrderId: 100,
    workOrderNo: "WO-100",
    itemName: "FG Box",
    requiredQty: 1000,
    producedQty: 0,
    balanceQty: 1000,
    orderType: "NO_QTY",
    status: "IN_PROGRESS",
    productionExecutionStatus: "RUNNING",
    nextAction: "PRODUCTION_PENDING",
    canAcceptProductionEntry: true,
    productionWorkState: "READY_TO_START" as const,
    ...partial,
  };
}

describe("storeProductionMonitor", () => {
  it("maps Ready / Running / Paused / Awaiting Report using workbench classifier (matches workspace)", () => {
    const ready = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 1,
        productionWorkState: "READY_TO_START",
        producedQty: 0,
        balanceQty: 1000,
      }),
    );
    const running = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 2,
        productionWorkState: "CONTINUE_PRODUCTION",
        producedQty: 400,
        balanceQty: 600,
        canAcceptProductionEntry: true,
      }),
    );
    const paused = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 3,
        productionWorkState: "PAUSED_PRODUCTION",
        nextAction: "PRODUCTION_PAUSED",
        productionExecutionStatus: "BLOCKED",
        canAcceptProductionEntry: false,
        producedQty: 200,
        balanceQty: 800,
      }),
    );
    const report = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 4,
        productionWorkState: null,
        nextAction: "PRODUCTION_SHORTFALL_DECISION",
        productionExecutionStatus: "SHORTFALL_PENDING",
        canAcceptProductionEntry: false,
        producedQty: 900,
        balanceQty: 100,
      }),
    );

    expect(ready.monitorStatus).toBe("READY_TO_START");
    expect(running.monitorStatus).toBe("RUNNING");
    expect(paused.monitorStatus).toBe("PAUSED");
    expect(report.monitorStatus).toBe("AWAITING_REPORT");

    const counts = buildStoreProductionMonitorCounts([ready, running, paused, report], []);
    const parity = buildStoreMonitorWorkspaceParity([ready, running, paused, report]);
    expect(counts.readyToStart).toBe(parity.ready);
    expect(counts.running).toBe(parity.active);
    expect(counts.paused).toBe(parity.paused);
    expect(counts.awaitingReport).toBe(parity.reportPending);
  });

  it("paused WO remains visible under All Active and Paused filter", () => {
    const paused = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 33,
        productionWorkState: "PAUSED_PRODUCTION",
        nextAction: "PRODUCTION_EXECUTION_BLOCKED",
        productionExecutionStatus: "BLOCKED",
        canAcceptProductionEntry: false,
        producedQty: 50,
        balanceQty: 950,
      }),
    );
    const all = filterStoreProductionMonitorRows([paused], [], { filter: "ALL_ACTIVE" });
    const onlyPaused = filterStoreProductionMonitorRows([paused], [], { filter: "PAUSED" });
    expect(all).toHaveLength(1);
    expect(onlyPaused).toHaveLength(1);
    expect(onlyPaused[0].monitorStatus).toBe("PAUSED");
  });

  it("pending QC with executable remaining does not hide WO or mark completed/blocked", () => {
    const row = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 260001,
        productionWorkState: "CONTINUE_PRODUCTION",
        producedQty: 2000,
        balanceQty: 3000,
        hasPendingQc: true,
        pendingQcQty: 2000,
        canAcceptProductionEntry: true,
        nextAction: "PRODUCTION_PENDING",
      }),
    );
    expect(classifyProductionWorkbenchState(row)).toBe("CONTINUE_PRODUCTION");
    expect(row.monitorStatus).toBe("RUNNING");
    expect(row.monitorStatus).not.toBe("COMPLETED");
    expect(row.monitorStatus).not.toBe("BLOCKED");
  });

  it("completed-old WOs are not mixed into active; completed today stays in Completed Today only", () => {
    const active = enrichStoreProductionMonitorRow(
      baseRow({ workOrderId: 10, productionWorkState: "READY_TO_START" }),
    );
    const completedToday = enrichStoreProductionMonitorRow(
      baseRow({
        workOrderId: 11,
        completedToday: true,
        producedQty: 1000,
        balanceQty: 0,
        canAcceptProductionEntry: false,
        productionExecutionStatus: "COMPLETED",
        status: "COMPLETED",
      }),
    );
    const activeList = filterStoreProductionMonitorRows([active], [completedToday], {
      filter: "ALL_ACTIVE",
    });
    const completedList = filterStoreProductionMonitorRows([active], [completedToday], {
      filter: "COMPLETED_TODAY",
    });
    expect(activeList.map((r) => r.workOrderId)).toEqual([10]);
    expect(completedList.map((r) => r.workOrderId)).toEqual([11]);
    expect(completedToday.monitorStatus).toBe("COMPLETED");
  });

  it("default sort priority: Blocked → Paused → Running → Awaiting → Ready → Completed", () => {
    const rows = [
      enrichStoreProductionMonitorRow(
        baseRow({ workOrderId: 1, productionWorkState: "READY_TO_START" }),
      ),
      enrichStoreProductionMonitorRow(
        baseRow({
          workOrderId: 2,
          productionWorkState: "CONTINUE_PRODUCTION",
          producedQty: 10,
          balanceQty: 90,
        }),
      ),
      enrichStoreProductionMonitorRow(
        baseRow({
          workOrderId: 3,
          productionWorkState: "PAUSED_PRODUCTION",
          nextAction: "PRODUCTION_PAUSED",
          canAcceptProductionEntry: false,
        }),
      ),
      enrichStoreProductionMonitorRow(
        baseRow({
          workOrderId: 4,
          nextAction: "ON_HOLD",
          canAcceptProductionEntry: false,
          productionWorkState: null,
        }),
      ),
      enrichStoreProductionMonitorRow(
        baseRow({
          workOrderId: 5,
          nextAction: "PRODUCTION_SHORTFALL_DECISION",
          productionExecutionStatus: "SHORTFALL_PENDING",
          canAcceptProductionEntry: false,
          productionWorkState: null,
        }),
      ),
    ];
    const sorted = sortStoreProductionMonitorRows(rows);
    expect(sorted.map((r) => r.monitorStatus)).toEqual([
      "BLOCKED",
      "PAUSED",
      "RUNNING",
      "AWAITING_REPORT",
      "READY_TO_START",
    ]);
  });

  it("never treats production mutation deep-links as safe Store navigation", () => {
    expect(isStoreProductionMutationHref("/production?action=start")).toBe(true);
    expect(isStoreProductionMutationHref("/production?action=pause")).toBe(true);
    expect(isStoreProductionMutationHref(null)).toBe(false);
  });

  it("next-action text uses short single-line labels", () => {
    const ready = enrichStoreProductionMonitorRow(
      baseRow({ productionWorkState: "READY_TO_START", rmReadyForProduction: true }),
    );
    const running = enrichStoreProductionMonitorRow(
      baseRow({
        productionWorkState: "CONTINUE_PRODUCTION",
        producedQty: 10,
        balanceQty: 90,
      }),
    );
    const paused = enrichStoreProductionMonitorRow(
      baseRow({
        productionWorkState: "PAUSED_PRODUCTION",
        nextAction: "PRODUCTION_PAUSED",
        canAcceptProductionEntry: false,
      }),
    );
    const report = enrichStoreProductionMonitorRow(
      baseRow({
        nextAction: "PRODUCTION_SHORTFALL_DECISION",
        productionExecutionStatus: "SHORTFALL_PENDING",
        canAcceptProductionEntry: false,
        productionWorkState: null,
      }),
    );
    expect(ready.nextActionText).toBe("Start production");
    expect(running.nextActionText).toBe("Continue production");
    expect(paused.nextActionText).toBe("Resume production");
    expect(report.nextActionText).toBe("Resolve shortage");
    expect(ready.nextActionText.includes("\n")).toBe(false);
  });

  it("formats quantities with consistent unit casing and grouping", () => {
    expect(formatMonitorUnitLabel("nos")).toBe("Nos");
    expect(formatMonitorUnitLabel("NOS")).toBe("Nos");
    expect(formatMonitorQty(2000, "nos")).toBe("2,000 Nos");
    expect(formatMonitorQty(0, "Nos")).toBe("0 Nos");
    expect(formatMonitorQty(8000, "NOS")).toBe("8,000 Nos");
  });

  it("workbenchStateToMonitorStatus maps COMPLETED_OR_CLOSED and DRAFT by produced qty", () => {
    expect(workbenchStateToMonitorStatus("COMPLETED_OR_CLOSED")).toBe("COMPLETED");
    expect(workbenchStateToMonitorStatus("DRAFT_PENDING", { producedQty: 0 })).toBe("READY_TO_START");
    expect(workbenchStateToMonitorStatus("DRAFT_PENDING", { producedQty: 5 })).toBe("RUNNING");
  });
});
