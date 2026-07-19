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
  resolvePostProductionPauseAdvance,
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

  it("after pause advances to the next executable WO or returns to workspace", () => {
    const lines = [
      { id: 10, workOrderId: 10, remainingQty: 2000 },
      { id: 20, workOrderId: 20, remainingQty: 500 },
    ];
    expect(
      resolvePostProductionPauseAdvance({ pausedWorkOrderId: 10, lines }),
    ).toEqual({ kind: "advance", line: expect.objectContaining({ workOrderId: 20 }) });
    expect(
      resolvePostProductionPauseAdvance({
        pausedWorkOrderId: 10,
        lines: [{ id: 10, workOrderId: 10, remainingQty: 2000 }],
      }),
    ).toEqual({ kind: "workspace" });
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

  it("returns to card workspace after Confirm Report & Close WO (never auto-opens another WO)", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [
        { id: 10, workOrderId: 10, remainingQty: 25 },
        { id: 20, workOrderId: 20, remainingQty: 50 },
        { id: 30, workOrderId: 30, remainingQty: 80 },
      ],
      forceAdvanceFromConfirmedWorkOrder: true,
    });
    expect(result).toEqual({ kind: "workspace" });
  });

  it("returns to workspace when shortfall close has no other executable WO", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [{ id: 10, workOrderId: 10, remainingQty: 25 }],
      forceAdvanceFromConfirmedWorkOrder: true,
    });
    expect(result).toEqual({ kind: "workspace" });
  });

  it("returns to workspace when the final executable WO report is confirmed without close flag", () => {
    const result = resolvePostProductionReportConfirmAdvance({
      confirmedWorkOrderId: 10,
      lines: [{ id: 10, workOrderId: 10, remainingQty: 0 }],
    });
    expect(result).toEqual({ kind: "workspace" });
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
