import { describe, expect, it } from "vitest";
import {
  buildPageSearchParams,
  buildQueueApiQuery,
  isCaseGroupSelected,
  reconcileSelectionAfterLoad,
  resolveDetailFromWorkspace,
  selectionFromQueueRow,
  splitSearchParams,
} from "../../src/lib/rmControlCenterSelection";

describe("rmControlCenterSelection", () => {
  it("treats workOrderId in URL as selection, not queue filter", () => {
    const params = new URLSearchParams("workOrderId=42&salesOrderId=7&onlyBlocked=true");
    const { queueFilters, initialSelection } = splitSearchParams(params);
    expect(initialSelection).toEqual({ workOrderId: 42, materialRequirementId: null, rmItemId: null });
    expect(queueFilters.workOrderId).toBe("");
    expect(queueFilters.salesOrderId).toBe("7");
    expect(queueFilters.onlyBlocked).toBe(true);
    expect(buildQueueApiQuery(queueFilters)).toBe("?salesOrderId=7&onlyBlocked=true");
  });

  it("buildPageSearchParams encodes selection and queue filters", () => {
    const qs = buildPageSearchParams(
      { ...splitSearchParams(new URLSearchParams()).queueFilters, salesOrderId: "7", status: "", onlyBlocked: false },
      { workOrderId: 42, materialRequirementId: null, rmItemId: 99 },
      "dashboard",
    );
    expect(qs).toContain("workOrderId=42");
    expect(qs).toContain("rmItemId=99");
    expect(qs).toContain("salesOrderId=7");
    expect(qs).toContain("returnTo=dashboard");
  });

  it("resolveDetailFromWorkspace picks WO detail without API filter", () => {
    const details = [
      { workOrder: { id: 1 }, woShortageCase: null },
      { workOrder: { id: 2 }, woShortageCase: null },
    ];
    expect(resolveDetailFromWorkspace(details, { workOrderId: 2, rmItemId: 1 })).toEqual(details[1]);
  });

  it("reconcileSelectionAfterLoad keeps selection when WO still in queue", () => {
    const queue = [
      { workOrderId: 1, materialRequirementId: null, rmItemId: 10 },
      { workOrderId: 2, materialRequirementId: null, rmItemId: 20 },
    ];
    const result = reconcileSelectionAfterLoad({ workOrderId: 2, rmItemId: 20 }, queue, false);
    expect(result?.workOrderId).toBe(2);
    expect(result?.rmItemId).toBe(20);
  });

  it("reconcileSelectionAfterLoad auto-selects first row when pending", () => {
    const queue = [{ workOrderId: 1, materialRequirementId: null, rmItemId: 10 }];
    expect(reconcileSelectionAfterLoad(null, queue, true)).toEqual(selectionFromQueueRow(queue[0]));
  });

  it("isCaseGroupSelected matches WO card highlight", () => {
    expect(isCaseGroupSelected({ workOrderId: 2, rmItemId: 1 }, { workOrderId: 2, materialRequirementId: null })).toBe(
      true,
    );
    expect(isCaseGroupSelected({ workOrderId: 1, rmItemId: 1 }, { workOrderId: 2, materialRequirementId: null })).toBe(
      false,
    );
  });
});
