import { describe, expect, it } from "vitest";
import {
  filterPendingPmrsForSessionScope,
  formatMaterialIssueInlineStatus,
  formatMaterialIssueSuccessMessage,
  materialIssueSessionCompleteMessage,
  materialIssueSessionCompleteTitle,
  parseMaterialIssueSessionScope,
  pickNextPendingPmrInScope,
  placementQuantitiesMatchSuggested,
} from "../../src/lib/materialIssueContinuousSession";
import type { PendingPmrSummary } from "../../src/lib/materialIssueWorkspace";

function pmr(partial: Partial<PendingPmrSummary> & { id: number; workOrderId: number }): PendingPmrSummary {
  return {
    docNo: partial.docNo ?? `PMR-${partial.id}`,
    status: partial.status ?? "REQUESTED",
    workOrderNo: partial.workOrderNo ?? `WO-${partial.workOrderId}`,
    salesOrderId: partial.salesOrderId ?? null,
    salesOrderNo: partial.salesOrderNo ?? null,
    requirementSheetId: partial.requirementSheetId ?? null,
    productionItemName: partial.productionItemName ?? null,
    totalPending: partial.totalPending ?? 10,
    lineCount: partial.lineCount ?? 1,
    ...partial,
  };
}

describe("materialIssueContinuousSession", () => {
  it("detects unchanged suggested placement quantities", () => {
    expect(
      placementQuantitiesMatchSuggested(
        [
          { itemId: 1, suggestedExecutableQty: 100 },
          { itemId: 2, suggestedExecutableQty: 50 },
        ],
        { 1: "100", 2: "50" },
      ),
    ).toBe(true);
    expect(
      placementQuantitiesMatchSuggested([{ itemId: 1, suggestedExecutableQty: 100 }], { 1: "90" }),
    ).toBe(false);
  });

  it("filters pending PMRs by requirement sheet scope", () => {
    const rows = [
      pmr({ id: 1, workOrderId: 10, requirementSheetId: 99 }),
      pmr({ id: 2, workOrderId: 11, requirementSheetId: 100 }),
    ];
    expect(filterPendingPmrsForSessionScope(rows, { requirementSheetId: 99 }).map((r) => r.id)).toEqual([1]);
  });

  it("formats per-issue success toast copy", () => {
    expect(formatMaterialIssueSuccessMessage("WO-26-0004")).toBe("Material issued successfully for WO-26-0004.");
  });

  it("uses store handoff completion copy", () => {
    expect(materialIssueSessionCompleteTitle()).toBe("All material issued successfully.");
    expect(materialIssueSessionCompleteMessage()).toContain("Store handoff complete");
  });

  it("formats inline PMR status chip", () => {
    expect(
      formatMaterialIssueInlineStatus({ pmrDocNo: "PMR-26-0003", pmrId: 3, pendingLineCount: 1 }),
    ).toBe("PMR-26-0003 · Waiting for RM Issue · 1 line pending");
  });

  it("picks the next pending PMR after issuing one work order", () => {
    const rows = [
      pmr({ id: 1, workOrderId: 10, requirementSheetId: 99 }),
      pmr({ id: 2, workOrderId: 11, requirementSheetId: 99 }),
    ];
    const next = pickNextPendingPmrInScope(rows, { requirementSheetId: 99 }, 10);
    expect(next?.id).toBe(2);
  });

  it("parses session scope from URL params", () => {
    expect(
      parseMaterialIssueSessionScope({ requirementSheetId: "12", salesOrderId: "0" }),
    ).toEqual({ requirementSheetId: 12, salesOrderId: null });
  });
});
