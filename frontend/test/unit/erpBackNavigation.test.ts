import { describe, expect, it } from "vitest";
import { resolveERPBackTarget } from "../../src/lib/erpBackNavigation";
import type { ErpNavContext } from "../../src/lib/erpNavContext";

const defaults = { defaultTo: "/dashboard", defaultLabel: "Back to Dashboard" };

describe("resolveERPBackTarget", () => {
  it("resolves pending-actions from query", () => {
    const target = resolveERPBackTarget(
      { pathname: "/production/rm-returns", search: "?from=pending-actions", state: null },
      defaults,
    );
    expect(target).toEqual({ to: "/pending-actions", label: "Back to Pending Actions" });
  });

  it("resolves pending-actions from work queue navigation state", () => {
    const target = resolveERPBackTarget(
      {
        pathname: "/sales-bills/42",
        search: "",
        state: {
          workQueue: {
            queueType: "CREATE_SALES_BILL",
            queueItems: [{ id: "a", documentNo: "D-1", href: "/sales-bills/42?from=pending-actions", billId: 42 }],
            currentIndex: 0,
            returnToPendingActions: true,
          },
        },
      },
      { defaultTo: "/sales-bills", defaultLabel: "Back to sales bills" },
    );
    expect(target).toEqual({ to: "/pending-actions", label: "Back to Pending Actions" });
  });

  it("resolves control-tower from query", () => {
    const target = resolveERPBackTarget(
      { pathname: "/material-planning", search: "?from=control-tower", state: null },
      defaults,
    );
    expect(target).toEqual({ to: "/control-tower", label: "Back to Control Tower" });
  });

  it("resolves dashboard default", () => {
    const target = resolveERPBackTarget({ pathname: "/pending-actions", search: "", state: null }, defaults);
    expect(target).toEqual({ to: "/dashboard", label: "Back to Dashboard" });
  });

  it("resolves returnTo path as previous workspace", () => {
    const target = resolveERPBackTarget(
      { pathname: "/rm-po-grn", search: "?returnTo=%2Fprocurement-planning", state: null },
      defaults,
    );
    expect(target).toEqual({ to: "/procurement-planning", label: "Back to Previous Workspace" });
  });

  it("resolves returnTo token", () => {
    const target = resolveERPBackTarget(
      { pathname: "/production", search: "?returnTo=pending-actions", state: null },
      defaults,
    );
    expect(target).toEqual({ to: "/pending-actions", label: "Back to Pending Actions" });
  });

  it("prefers navContext parent when provided", () => {
    const navContext: ErpNavContext = {
      parentHref: "/pending-actions",
      parentLabel: "Pending Actions",
      trail: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Pending Actions", href: "/pending-actions" },
        { label: "Material Issue" },
      ],
      origin: "pending-actions",
    };
    const target = resolveERPBackTarget(
      { pathname: "/material-issue", search: "", state: null },
      { ...defaults, navContext },
    );
    expect(target).toEqual({ to: "/pending-actions", label: "Back to Pending Actions" });
  });

  it("resolves location state backTo", () => {
    const target = resolveERPBackTarget(
      {
        pathname: "/work-orders/prepare",
        search: "",
        state: { backTo: "/work-orders", backLabel: "Back to Work Orders" },
      },
      defaults,
    );
    expect(target).toEqual({ to: "/work-orders", label: "Back to Work Orders" });
  });

  it("falls back to dashboard when defaultTo equals current path", () => {
    const target = resolveERPBackTarget({ pathname: "/dashboard", search: "", state: null }, defaults);
    expect(target).toEqual({ to: "/dashboard", label: "Back to Dashboard" });
  });

  it("resolves production-workspace return with bucket and work order", () => {
    const target = resolveERPBackTarget(
      {
        pathname: "/material-issue",
        search: "?returnTo=production-workspace&productionBucket=READY&workOrderId=99",
        state: null,
      },
      defaults,
    );
    expect(target).toEqual({
      to: "/production?productionBucket=READY&workOrderId=99",
      label: "Back to Production Workspace",
    });
  });

  it("resolves dispatch from fromStep on production pages", () => {
    const target = resolveERPBackTarget(
      { pathname: "/production", search: "?fromStep=dispatch&salesOrderId=42", state: null },
      { ...defaults, kind: "production" },
    );
    expect(target).toEqual({ to: "/dispatch?salesOrderId=42", label: "Back to Dispatch Workspace" });
  });

  it("resolves work-order-workspace from query from token", () => {
    const target = resolveERPBackTarget(
      { pathname: "/production", search: "?from=work-order-workspace", state: null },
      defaults,
    );
    expect(target).toEqual({ to: "/work-orders", label: "Back to Work Order Workspace" });
  });
});
