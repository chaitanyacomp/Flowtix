import { describe, expect, it } from "vitest";
import {
  isErpNavContext,
  makeNavContext,
  navContextExecutionWorkspace,
  navContextDispatchFromDashboard,
  navContextDispatchFromNoQtyExecution,
  navContextDispatchFromSalesOrders,
  navContextMaterialIssueFromDashboard,
  navContextMaterialIssueFromRmcc,
  navContextNoQtyExecutionRegister,
  navContextRmControlCenterFromDashboard,
  navContextRmControlCenterFromWorkspace,
  navStateWithNavContext,
  readNavContextFromLocationState,
  resolveStoreExecutionNavContext,
} from "../../src/lib/erpNavContext";

describe("erpNavContext", () => {
  it("validates NavContext shape", () => {
    expect(isErpNavContext(null)).toBe(false);
    expect(
      isErpNavContext({
        parentHref: "/dashboard",
        parentLabel: "Dashboard",
        trail: [{ label: "Dashboard", href: "/dashboard" }, { label: "Test" }],
      }),
    ).toBe(true);
  });

  it("reads navContext from location state", () => {
    const ctx = navContextNoQtyExecutionRegister("dashboard");
    expect(readNavContextFromLocationState(navStateWithNavContext(ctx))).toEqual(ctx);
    expect(readNavContextFromLocationState({ from: "dashboard" })).toBeNull();
  });

  it("builds dashboard → NO_QTY Execution register trail", () => {
    const ctx = navContextNoQtyExecutionRegister("dashboard");
    expect(ctx.parentHref).toBe("/dashboard");
    expect(ctx.parentLabel).toBe("Dashboard");
    expect(ctx.trail.map((t) => t.label)).toEqual(["Dashboard", "NO_QTY Execution"]);
    expect(ctx.origin).toBe("dashboard");
  });

  it("builds execution workspace trail from register vs pending actions", () => {
    const fromRegister = navContextExecutionWorkspace("execution-register");
    expect(fromRegister.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "NO_QTY Execution",
      "Execution Workspace",
    ]);
    expect(fromRegister.parentLabel).toBe("NO_QTY Execution");

    const fromPending = navContextExecutionWorkspace("pending-actions");
    expect(fromPending.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "Pending Actions",
      "Execution Workspace",
    ]);
    expect(fromPending.parentLabel).toBe("Pending Actions");
  });

  it("extends RMCC trail from execution workspace", () => {
    const wsHref = "/sales-orders/12/requirement-sheets?focus=execution";
    const ctx = navContextRmControlCenterFromWorkspace(wsHref, "execution-register");
    expect(ctx.parentLabel).toBe("Execution Workspace");
    expect(ctx.parentHref).toBe(wsHref);
    expect(ctx.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "NO_QTY Execution",
      "Execution Workspace",
      "RM Control Center",
    ]);
  });

  it("chains material issue from RMCC context", () => {
    const rmcc = navContextRmControlCenterFromDashboard();
    const issue = navContextMaterialIssueFromRmcc(rmcc, "/reports/rm-shortage?returnTo=dashboard");
    expect(issue.parentLabel).toBe("RM Control Center");
    expect(issue.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "RM Control Center",
      "Material Issue",
    ]);
  });

  it("prefers location.state over query defaults", () => {
    const ctx = makeNavContext(
      [{ label: "Dashboard", href: "/dashboard" }, { label: "Custom Page" }],
      "test",
    );
    const resolved = resolveStoreExecutionNavContext(
      {
        pathname: "/no-qty-agreements/reements",
        search: "",
        state: navStateWithNavContext(ctx),
      },
      "no-qty-execution",
    );
    expect(resolved).toEqual(ctx);
  });

  it("resolves sidebar defaults when no state is passed", () => {
    const ctx = resolveStoreExecutionNavContext(
      { pathname: "/no-qty-agreements", search: "", state: null },
      "no-qty-execution",
    );
    expect(ctx.parentLabel).toBe("Dashboard");
    expect(ctx.trail.map((t) => t.label)).toEqual(["Dashboard", "NO_QTY Execution"]);
  });

  it("resolves dashboard shortcuts (scenarios 2 & 3)", () => {
    const rmcc = resolveStoreExecutionNavContext(
      { pathname: "/reports/rm-shortage", search: "?returnTo=dashboard", state: null },
      "rm-control-center",
    );
    expect(rmcc.trail.map((t) => t.label)).toEqual(["Dashboard", "RM Control Center"]);
    expect(rmcc.parentLabel).toBe("Dashboard");

    const issue = resolveStoreExecutionNavContext(
      { pathname: "/material-issue", search: "?source=dashboard", state: null },
      "material-issue",
    );
    expect(issue.trail.map((t) => t.label)).toEqual(["Dashboard", "Material Issue"]);
  });

  it("resolves pending-actions → workspace trail (scenario 4)", () => {
    const ws = resolveStoreExecutionNavContext(
      {
        pathname: "/sales-orders/12/requirement-sheets",
        search: "?focus=execution&from=pending-actions",
        state: null,
      },
      "execution-workspace",
    );
    expect(ws.parentLabel).toBe("Pending Actions");
    expect(ws.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "Pending Actions",
      "Execution Workspace",
    ]);
  });

  it("builds dispatch trails for store pilot entry paths", () => {
    const fromDashboard = navContextDispatchFromDashboard();
    expect(fromDashboard.parentLabel).toBe("Dashboard");
    expect(fromDashboard.trail.map((t) => t.label)).toEqual(["Dashboard", "Dispatch"]);
    expect(fromDashboard.trail.every((t) => t.label !== "-")).toBe(true);

    const fromNoQty = navContextDispatchFromNoQtyExecution();
    expect(fromNoQty.parentLabel).toBe("NO_QTY Execution");
    expect(fromNoQty.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "NO_QTY Execution",
      "Dispatch",
    ]);

    const fromSalesOrders = navContextDispatchFromSalesOrders();
    expect(fromSalesOrders.parentLabel).toBe("Sales Orders");
    expect(fromSalesOrders.trail.map((t) => t.label)).toEqual([
      "Dashboard",
      "Sales Orders",
      "Dispatch",
    ]);
  });

  it("resolves dispatch fallback from query params", () => {
    const dashboard = resolveStoreExecutionNavContext(
      { pathname: "/dispatch", search: "?source=dashboard", state: null },
      "dispatch",
    );
    expect(dashboard.trail.map((t) => t.label)).toEqual(["Dashboard", "Dispatch"]);

    const noQty = resolveStoreExecutionNavContext(
      { pathname: "/dispatch", search: "?source=no_qty_so&salesOrderId=12", state: null },
      "dispatch",
    );
    expect(noQty.parentLabel).toBe("NO_QTY Execution");

    const sidebar = resolveStoreExecutionNavContext(
      { pathname: "/dispatch", search: "", state: null },
      "dispatch",
    );
    expect(sidebar.trail.map((t) => t.label)).toEqual(["Dashboard", "Dispatch"]);
    expect(sidebar.trail.some((t) => t.label === "-")).toBe(false);
  });
});
