import { describe, expect, it } from "vitest";
import {
  buildQcBackLink,
  buildQcEmbeddedStageSteps,
  buildQualityQueueRows,
  formatQcCompletionMessage,
  qcCompletionPostActionHash,
  resolvePostQcSaveAdvance,
  resolveQcCompletionOutcome,
  sortPendingQcByProductionFifo,
} from "../../src/lib/qcWorkspaceUx";
import { erpRefreshScopesForMutation } from "../../src/lib/erpRefresh";

describe("qcWorkspaceUx", () => {
  it("resolves QC completion outcomes from split quantities", () => {
    expect(resolveQcCompletionOutcome({ acceptedQty: 10, rejectedQty: 0, reworkQty: 0, holdQty: 0, scrapQty: 0 })).toBe(
      "ACCEPTED",
    );
    expect(resolveQcCompletionOutcome({ acceptedQty: 0, rejectedQty: 2, reworkQty: 2, holdQty: 0, scrapQty: 0 })).toBe(
      "REWORK",
    );
    expect(resolveQcCompletionOutcome({ acceptedQty: 0, rejectedQty: 2, reworkQty: 0, holdQty: 2, scrapQty: 0 })).toBe(
      "HOLD",
    );
    expect(resolveQcCompletionOutcome({ acceptedQty: 0, rejectedQty: 2, reworkQty: 0, holdQty: 0, scrapQty: 2 })).toBe(
      "REJECTED",
    );
  });

  it("formats workflow-aware completion messages", () => {
    expect(formatQcCompletionMessage("ACCEPTED")).toContain("released for Dispatch");
    expect(formatQcCompletionMessage("REJECTED")).toContain("Rejected quantity recorded");
    expect(formatQcCompletionMessage("REWORK")).toContain("moved to Rework");
    expect(formatQcCompletionMessage("HOLD")).toContain("placed on Hold");
  });

  it("maps post-completion navigation hashes", () => {
    expect(qcCompletionPostActionHash("REWORK")).toBe("qc-rework-pending");
    expect(qcCompletionPostActionHash("HOLD")).toBe("qc-hold-decisions");
    expect(qcCompletionPostActionHash("ACCEPTED")).toBeNull();
  });

  it("builds unified quality queue rows in priority order", () => {
    const rows = buildQualityQueueRows({
      pendingQc: [{ productionId: 9, itemName: "Widget", workOrderLabel: "WO-1", pendingQty: 5 }],
      dispositions: [
        {
          id: 3,
          kind: "HOLD_DECISION",
          itemName: "Widget",
          qty: 1,
          workOrderLabel: "WO-1",
        },
        {
          id: 2,
          kind: "REWORK_PENDING",
          itemName: "Widget",
          qty: 2,
          workOrderLabel: "WO-1",
        },
      ],
      customerReturns: [{ id: 7, returnNo: "CR-1", itemName: "Widget", qty: 1 }],
    });
    expect(rows.map((r) => r.kind)).toEqual(["PENDING_QC", "REWORK_PENDING", "HOLD_DECISION", "CUSTOMER_RETURN"]);
    expect(rows[0]?.anchor).toBe("#qc-production-pending");
    expect(rows[1]?.anchor).toBe("#qc-rework-pending");
  });

  it("builds context-aware back links", () => {
    expect(buildQcBackLink({ fromNoQtySo: true, source: "", from: "", role: "QA" })).toBeNull();
    expect(buildQcBackLink({ fromNoQtySo: false, source: "", from: "production", role: "PRODUCTION" })?.label).toContain(
      "Production Workspace",
    );
    expect(buildQcBackLink({ fromNoQtySo: false, source: "pending-actions", from: "", role: "QA" })).toEqual({
      to: "/pending-actions",
      label: "Back to Pending Actions",
    });
  });

  it("builds embedded stage steps for production-embedded QA", () => {
    expect(buildQcEmbeddedStageSteps(false)).toEqual([]);
    expect(buildQcEmbeddedStageSteps(true).find((s) => s.active)?.label).toBe("Quality Inspection");
  });

  it("auto-loads the next FIFO pending QC item after a completed save", () => {
    const rows = [
      { productionId: 12, pendingQty: 4487, date: "2026-06-04T09:00:00.000Z", itemName: "Square Box" },
      { productionId: 10, pendingQty: 2448, date: "2026-06-02T09:00:00.000Z", itemName: "PVC Angle" },
      { productionId: 11, pendingQty: 2658, date: "2026-06-03T09:00:00.000Z", itemName: "Round Plate" },
    ];

    const advance = resolvePostQcSaveAdvance({ savedProductionId: 9, freshPending: rows });

    expect(advance).toEqual({ kind: "advance", productionId: 10 });
  });

  it("keeps partial QC on the same production entry when pending qty remains", () => {
    const advance = resolvePostQcSaveAdvance({
      savedProductionId: 9,
      freshPending: [
        { productionId: 9, pendingQty: 500, date: "2026-06-01T09:00:00.000Z" },
        { productionId: 10, pendingQty: 2448, date: "2026-06-02T09:00:00.000Z" },
      ],
    });

    expect(advance).toEqual({ kind: "stay", productionId: 9 });
  });

  it("returns an empty advance after the final QC item is completed", () => {
    expect(resolvePostQcSaveAdvance({ savedProductionId: 12, freshPending: [] })).toEqual({
      kind: "advance",
      productionId: null,
    });
  });

  it("orders pending production entries FIFO, not by quantity", () => {
    const fifo = sortPendingQcByProductionFifo([
      { productionId: 4, pendingQty: 4487, date: "2026-06-04T09:00:00.000Z", itemName: "Square Box" },
      { productionId: 1, pendingQty: 2000, date: "2026-06-01T09:00:00.000Z", itemName: "Dummy Plug" },
      { productionId: 3, pendingQty: 2658, date: "2026-06-03T09:00:00.000Z", itemName: "Round Plate" },
      { productionId: 2, pendingQty: 2448, date: "2026-06-02T09:00:00.000Z", itemName: "PVC Angle" },
    ]);

    expect(fifo.map((r) => `${r.itemName} - ${r.pendingQty}`)).toEqual([
      "Dummy Plug - 2000",
      "PVC Angle - 2448",
      "Round Plate - 2658",
      "Square Box - 4487",
    ]);
  });

  it("does not use a Pending Actions redirect after accepted QC save", () => {
    expect(qcCompletionPostActionHash("ACCEPTED")).toBeNull();
    expect(qcCompletionPostActionHash("REJECTED")).toBeNull();
  });

  it("keeps queue rows directly selectable without requiring a separate open button", () => {
    const rows = buildQualityQueueRows({
      pendingQc: [
        { productionId: 10, itemName: "PVC Angle", workOrderLabel: "WO-2", pendingQty: 2448 },
      ],
      dispositions: [],
      customerReturns: [],
    });

    expect(rows[0]).toMatchObject({
      kind: "PENDING_QC",
      productionId: 10,
      anchor: "#qc-production-pending",
    });
  });

  it("refreshes dashboard, dispatch, stock, and pending actions after QC mutations", () => {
    const scopes = erpRefreshScopesForMutation("/api/production/qc-entries", "POST");

    expect(scopes).toContain("dashboard");
    expect(scopes).toContain("pending-actions");
    expect(scopes).toContain("qc");
    expect(scopes).toContain("dispatch");
    expect(scopes).toContain("stock");
  });
});
