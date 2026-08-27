import { describe, expect, it } from "vitest";
import {
  navContextMaterialIssueFromOperations,
  navContextMaterialIssueFromWorkOrder,
  resolveStoreExecutionNavContext,
} from "../../src/lib/erpNavContext";
import { resolveERPBackTarget } from "../../src/lib/erpBackNavigation";
import { buildRegularSoPostCreateMaterialIssueHref } from "../../src/lib/regularSoPrepareWoCreateHandoff";
import { materialWorkflowBackHref } from "../../src/lib/materialWorkflowLinks";

describe("Material Issue post-create back navigation", () => {
  it("post-create href carries WO context and create-work-order source", () => {
    const href = buildRegularSoPostCreateMaterialIssueHref({
      workOrderId: 41,
      pmrId: 7,
      salesOrderId: 2,
      workOrderNo: "WO-R-26-0001",
    });
    const q = new URL(href, "http://erp.local").searchParams;
    expect(q.get("workOrderId")).toBe("41");
    expect(q.get("salesOrderId")).toBe("2");
    expect(q.get("pmrId")).toBe("7");
    expect(q.get("returnTo")).toBe("work-order-detail");
    expect(q.get("from")).toBe("create-work-order");
    expect(q.get("workOrderNo")).toBe("WO-R-26-0001");
  });

  it("resolves Back to Work Order from create-WO context (no Operations breadcrumb UI)", () => {
    const search =
      "?workOrderId=41&salesOrderId=2&pmrId=7&returnTo=work-order-detail&from=create-work-order&workOrderNo=WO-R-26-0001&bucket=readyToIssue";
    const ctx = resolveStoreExecutionNavContext(
      { pathname: "/material-issue", search, state: null },
      "material-issue",
    );
    expect(ctx.parentHref).toBe("/work-orders/41");
    expect(ctx.parentLabel).toBe("Work Order");

    const back = resolveERPBackTarget(
      { pathname: "/material-issue", search, state: null },
      { defaultTo: "/dashboard", defaultLabel: "Back to Operations", navContext: ctx },
    );
    expect(back.to).toBe("/work-orders/41");
    expect(back.label).toBe("Back to Work Order");
  });

  it("legacy prepare-wo + workOrderId still backs to WO detail (not Prepare)", () => {
    const search = "?workOrderId=41&salesOrderId=2&returnTo=prepare-wo&from=prepare-wo";
    const ctx = resolveStoreExecutionNavContext(
      { pathname: "/material-issue", search, state: null },
      "material-issue",
    );
    expect(ctx.parentHref).toBe("/work-orders/41");
    expect(ctx.parentLabel).toBe("Work Order");
    expect(materialWorkflowBackHref("prepare-wo", 41)).toBe("/work-orders/41");
    expect(materialWorkflowBackHref("work-order-detail", 41)).toBe("/work-orders/41");
  });

  it("sidebar / direct Material Issue backs to Operations (no breadcrumb trail rendered)", () => {
    const fromOps = navContextMaterialIssueFromOperations();
    expect(fromOps.parentLabel).toBe("Operations");
    expect(fromOps.parentHref).toBe("/dashboard");

    const resolved = resolveStoreExecutionNavContext(
      { pathname: "/material-issue", search: "", state: null },
      "material-issue",
    );
    expect(resolved.parentLabel).toBe("Operations");

    const back = resolveERPBackTarget(
      { pathname: "/material-issue", search: "", state: null },
      { defaultTo: "/dashboard", defaultLabel: "Back to Operations", navContext: resolved },
    );
    expect(back.label).toBe("Back to Operations");
    expect(back.to).toBe("/dashboard");
  });

  it("Material Issue page uses contextual Back only — no ErpWorkflowTrail breadcrumb", async () => {
    const { readFileSync } = await import("node:fs");
    const pageSource = readFileSync(
      new URL("../../src/pages/MaterialIssuePage.tsx", import.meta.url),
      "utf8",
    );
    expect(pageSource).toContain('data-testid="material-issue-contextual-back"');
    expect(pageSource).toContain("Back to Work Order");
    expect(pageSource).toContain("Back to Operations");
    expect(pageSource).not.toContain("ErpWorkflowTrail");
  });

  it("navContextMaterialIssueFromWorkOrder keeps a single Create-path parent", () => {
    const ctx = navContextMaterialIssueFromWorkOrder({
      workOrderId: 9,
      workOrderLabel: "WO-R-26-0001",
      origin: "create-work-order",
    });
    expect(ctx.origin).toBe("create-work-order");
    expect(ctx.parentLabel).toBe("Work Order");
    expect(ctx.trail).toHaveLength(3);
  });
});
