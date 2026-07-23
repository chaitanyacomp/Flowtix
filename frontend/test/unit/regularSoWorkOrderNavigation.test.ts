import { describe, expect, it } from "vitest";
import { regularSoWorkOrderDetailHref, workOrdersFocusHref } from "../../src/lib/drillDownRoutes";
import {
  buildRegularSoPostCreateMaterialIssueHref,
  buildRegularSoViewWorkOrderHref,
  shouldReuseExistingRegularWo,
} from "../../src/lib/regularSoPrepareWoCreateHandoff";
import { workOrderHrefForOpenWo } from "../../src/lib/operationalWorkspaceLinks";

describe("REGULAR_SO WO navigation", () => {
  it("permanent detail href is path-based by workOrderId", () => {
    expect(regularSoWorkOrderDetailHref(26)).toBe("/work-orders/26");
    expect(regularSoWorkOrderDetailHref(26, { from: "prepare-wo" })).toBe("/work-orders/26?from=prepare-wo");
    expect(workOrdersFocusHref(26)).toBe("/work-orders/26");
  });

  it("post-create keeps Material Issue handoff and exposes View WO path", () => {
    const mi = buildRegularSoPostCreateMaterialIssueHref({
      workOrderId: 26,
      pmrId: 9,
      salesOrderId: 3,
    });
    expect(mi).toContain("/material-issue");
    expect(mi).toContain("workOrderId=26");
    expect(mi).not.toContain("/work-orders?");
    expect(buildRegularSoViewWorkOrderHref(26)).toBe("/work-orders/26?from=prepare-wo");
    expect(shouldReuseExistingRegularWo(26)).toBe(true);
  });

  it("REGULAR open-WO links go to permanent detail; NO_QTY stays guided list", () => {
    expect(
      workOrderHrefForOpenWo({
        orderType: "NORMAL",
        salesOrderId: 3,
        workOrderId: 26,
      }),
    ).toBe("/work-orders/26?from=work-order-workspace");
    expect(
      workOrderHrefForOpenWo({
        orderType: "NO_QTY",
        salesOrderId: 3,
        workOrderId: 26,
        cycleId: 2,
      }),
    ).toContain("/work-orders?");
    expect(
      workOrderHrefForOpenWo({
        orderType: "NO_QTY",
        salesOrderId: 3,
        workOrderId: 26,
        cycleId: 2,
      }),
    ).not.toMatch(/^\/work-orders\/26/);
  });
});
