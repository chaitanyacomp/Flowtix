import { describe, expect, it } from "vitest";
import {
  buildActionableWorkOrderDropdownOptions,
  buildIssuedWorkOrderInfoRows,
  filterPmrsWithPendingIssue,
  groupPendingPmrsByWorkOrder,
} from "../../src/lib/materialIssueWorkspace";
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

describe("materialIssueWorkspace", () => {
  it("excludes fully issued PMRs from pending-issue filter", () => {
    const rows = [
      pmr({ id: 1, workOrderId: 10, totalPending: 5 }),
      pmr({ id: 2, workOrderId: 11, totalPending: 0, status: "ISSUED" }),
      pmr({ id: 3, workOrderId: 12, totalPending: 0, status: "REQUESTED" }),
    ];
    expect(filterPmrsWithPendingIssue(rows).map((r) => r.id)).toEqual([1]);
  });

  it("builds dropdown options only for WOs with pending RM", () => {
    const rows = [
      pmr({ id: 1, workOrderId: 10, workOrderNo: "WO-001", totalPending: 8 }),
      pmr({ id: 2, workOrderId: 11, workOrderNo: "WO-002", totalPending: 0, status: "ISSUED" }),
    ];
    const options = buildActionableWorkOrderDropdownOptions(rows);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe(10);
    expect(options[0].label).toContain("WO-001");
  });

  it("groups queue by WO and skips fully issued work orders", () => {
    const rows = [
      pmr({ id: 1, workOrderId: 10, totalPending: 4 }),
      pmr({ id: 2, workOrderId: 11, totalPending: 0, status: "ISSUED" }),
    ];
    const groups = groupPendingPmrsByWorkOrder(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].workOrderId).toBe(10);
  });

  it("lists issued WOs for informational panel when not in actionable set", () => {
    const actionable = new Set([10]);
    const rows = buildIssuedWorkOrderInfoRows({
      recentIssues: [
        { workOrderId: 10, workOrderNo: "WO-001" },
        { workOrderId: 11, workOrderNo: "WO-002" },
      ],
      actionableWorkOrderIds: actionable,
    });
    expect(rows).toEqual([{ workOrderId: 11, label: "WO-002" }]);
  });
});
