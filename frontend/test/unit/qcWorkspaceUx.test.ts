import { describe, expect, it } from "vitest";
import {
  buildQcBackLink,
  buildQcEmbeddedStageSteps,
  buildQualityQueueRows,
  formatQcCompletionMessage,
  qcCompletionPostActionHash,
  resolveQcCompletionOutcome,
} from "../../src/lib/qcWorkspaceUx";

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
    expect(buildQcBackLink({ fromNoQtySo: false, source: "pending-actions", from: "", role: "QA" })?.label).toContain(
      "Quality Inspection Dashboard",
    );
  });

  it("builds embedded stage steps for production-embedded QA", () => {
    expect(buildQcEmbeddedStageSteps(false)).toEqual([]);
    expect(buildQcEmbeddedStageSteps(true).find((s) => s.active)?.label).toBe("Quality Inspection");
  });
});
