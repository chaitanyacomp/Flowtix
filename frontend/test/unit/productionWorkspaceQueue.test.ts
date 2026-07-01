import { describe, expect, it } from "vitest";
import {
  PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES,
  buildProductionQueueLines,
  buildQcPendingByWorkOrderLineId,
  executableWorkOrderIds,
  filterExecutableProductionLines,
  pickFirstExecutableProductionLine,
  pickNextExecutableProductionLineExcludingWorkOrder,
  resolvePostProductionReportConfirmAdvance,
  sortProductionLinesFifo,
} from "../../src/lib/productionWorkspaceQueue";

describe("productionWorkspaceQueue", () => {
  it("sorts lines FIFO by work order then line id", () => {
    const sorted = sortProductionLinesFifo([
      { id: 20, workOrderId: 5, remainingQty: 100 },
      { id: 10, workOrderId: 2, remainingQty: 50 },
      { id: 11, workOrderId: 5, remainingQty: 80 },
    ]);
    expect(sorted.map((l) => l.id)).toEqual([10, 11, 20]);
  });

  it("picks first executable line and skips QC-only rows", () => {
    const pick = pickFirstExecutableProductionLine([
      { id: 1, workOrderId: 1, remainingQty: 0, qcPendingQty: 5 },
      { id: 2, workOrderId: 2, remainingQty: 120 },
      { id: 3, workOrderId: 3, remainingQty: 80 },
    ]);
    expect(pick?.id).toBe(2);
    expect(filterExecutableProductionLines([{ id: 1, workOrderId: 1, remainingQty: 0, qcPendingQty: 5 }])).toEqual([]);
  });

  it("auto-advances to the next FIFO work order after full production report confirm", () => {
    const lines = [
      { id: 10, workOrderId: 10, remainingQty: 0 },
      { id: 20, workOrderId: 20, remainingQty: 50 },
      { id: 30, workOrderId: 30, remainingQty: 80 },
    ];
    const advance = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines,
    });
    expect(advance).toEqual({ kind: "advance", line: expect.objectContaining({ workOrderId: 20, id: 20 }) });
  });

  it("stays on the same work order when partial production remains", () => {
    const lines = [
      { id: 10, workOrderId: 10, remainingQty: 25 },
      { id: 20, workOrderId: 20, remainingQty: 50 },
    ];
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines,
    });
    expect(result).toEqual({ kind: "stay", line: expect.objectContaining({ workOrderId: 10, id: 10 }) });
  });

  it("stays on the same work order when shortfall decision is required", () => {
    const lines = [
      { id: 10, workOrderId: 10, remainingQty: 0 },
      { id: 20, workOrderId: 20, remainingQty: 50 },
    ];
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines,
      requiresShortfallDecision: true,
    });
    expect(result.kind).toBe("stay");
  });

  it("clears to empty advance when the final executable work order is confirmed", () => {
    const lines = [{ id: 10, workOrderId: 10, remainingQty: 0 }];
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines,
    });
    expect(result).toEqual({ kind: "advance", line: null });
  });

  it("auto-advances shortfall Carry Forward to the next FIFO executable work order", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [
        { id: 10, workOrderId: 10, remainingQty: 25 },
        { id: 20, workOrderId: 20, remainingQty: 50 },
        { id: 30, workOrderId: 30, remainingQty: 80 },
      ],
      forceAdvanceFromConfirmedWorkOrder: true,
    });
    expect(result).toEqual({ kind: "advance", line: expect.objectContaining({ workOrderId: 20, id: 20 }) });
  });

  it("auto-advances shortfall Waive to the next FIFO executable work order", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [
        { id: 10, workOrderId: 10, remainingQty: 25 },
        { id: 20, workOrderId: 20, remainingQty: 50 },
      ],
      forceAdvanceFromConfirmedWorkOrder: true,
    });
    expect(result.line?.workOrderId).toBe(20);
  });

  it("removes paused shortfall WO from executable auto-advance and picks next FIFO work", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [
        { id: 10, workOrderId: 10, remainingQty: 25 },
        { id: 11, workOrderId: 10, remainingQty: 10 },
        { id: 20, workOrderId: 20, remainingQty: 50 },
      ],
      forceAdvanceFromConfirmedWorkOrder: true,
    });
    expect(result).toEqual({ kind: "advance", line: expect.objectContaining({ workOrderId: 20, id: 20 }) });
  });

  it("shows empty state after final shortfall work order decision", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [{ id: 10, workOrderId: 10, remainingQty: 25 }],
      forceAdvanceFromConfirmedWorkOrder: true,
    });
    expect(result).toEqual({ kind: "advance", line: null });
  });

  it("excludes the completed work order from the executable queue", () => {
    const lines = [
      { id: 10, workOrderId: 10, remainingQty: 0 },
      { id: 20, workOrderId: 20, remainingQty: 40 },
    ];
    const ids = executableWorkOrderIds(lines);
    expect(ids.has(10)).toBe(false);
    expect(ids.has(20)).toBe(true);
    expect(pickNextExecutableProductionLineExcludingWorkOrder(lines, 10)?.workOrderId).toBe(20);
  });

  it("builds queue lines from refreshed flat lines and production entries", () => {
    const entries = [
      {
        workflowStatus: "APPROVED",
        workOrderLine: { id: 101 },
        qcPendingQty: 3,
      },
    ];
    const qcMap = buildQcPendingByWorkOrderLineId(entries);
    const queue = buildProductionQueueLines(
      [{ id: 101, workOrderId: 10, remainingQty: 12, approvedProducedQty: 8 }],
      qcMap,
    );
    expect(queue[0]).toEqual({
      id: 101,
      workOrderId: 10,
      remainingQty: 12,
      approvedProducedQty: 8,
      qcPendingQty: 3,
    });
  });

  it("includes dashboard and pending-actions refresh scopes after report confirm", () => {
    expect(PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES).toContain("dashboard");
    expect(PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES).toContain("pending-actions");
    expect(PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES).toContain("production");
    expect(PRODUCTION_REPORT_CONFIRM_REFRESH_SCOPES).toContain("stock");
  });

  it("preserves FIFO next WO when browser reload would pick first executable line", () => {
    const refreshedQueue = [
      { id: 11, workOrderId: 20, remainingQty: 30 },
      { id: 12, workOrderId: 30, remainingQty: 60 },
    ];
    const next = pickFirstExecutableProductionLine(refreshedQueue);
    expect(next?.workOrderId).toBe(20);
    expect(executableWorkOrderIds(refreshedQueue)).toEqual(new Set([20, 30]));
  });
});
