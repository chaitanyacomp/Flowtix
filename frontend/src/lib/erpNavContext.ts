import type { Location } from "react-router-dom";
import { NO_QTY_AGREEMENTS_HREF } from "./noQtyStoreNavigation";

export type ErpNavTrailItem = {
  label: string;
  href?: string;
};

export type ErpNavContext = {
  parentHref: string;
  parentLabel: string;
  trail: ErpNavTrailItem[];
  origin?: string;
};

export type StoreExecutionNavPageKey =
  | "no-qty-execution"
  | "execution-workspace"
  | "rm-control-center"
  | "material-issue"
  | "dispatch";

const DASHBOARD_TRAIL: ErpNavTrailItem = { label: "Dashboard", href: "/dashboard" };
const PENDING_ACTIONS_TRAIL: ErpNavTrailItem = { label: "Pending Actions", href: "/pending-actions" };
const SALES_ORDERS_TRAIL: ErpNavTrailItem = { label: "Sales Orders", href: "/sales-orders" };
const WORK_ORDERS_TRAIL: ErpNavTrailItem = { label: "Work Orders", href: "/work-orders?flow=REGULAR_SO" };
const OPERATIONS_TRAIL: ErpNavTrailItem = { label: "Operations", href: "/dashboard" };
const NO_QTY_EXECUTION_TRAIL: ErpNavTrailItem = {
  label: "NO_QTY Execution",
  href: NO_QTY_AGREEMENTS_HREF,
};
const RM_CONTROL_CENTER_TRAIL: ErpNavTrailItem = {
  label: "RM Control Center",
  href: "/reports/rm-shortage",
};

export function isErpNavContext(value: unknown): value is ErpNavContext {
  if (!value || typeof value !== "object") return false;
  const v = value as ErpNavContext;
  return (
    typeof v.parentHref === "string" &&
    v.parentHref.startsWith("/") &&
    typeof v.parentLabel === "string" &&
    Array.isArray(v.trail) &&
    v.trail.length > 0 &&
    v.trail.every((t) => typeof t.label === "string")
  );
}

export function readNavContextFromLocationState(state: unknown): ErpNavContext | null {
  if (!state || typeof state !== "object") return null;
  const ctx = (state as { navContext?: unknown }).navContext;
  return isErpNavContext(ctx) ? ctx : null;
}

/** Build NavContext from a trail where the last item is the current page (no href required). */
export function makeNavContext(trail: ErpNavTrailItem[], origin?: string): ErpNavContext {
  const parentItem =
    trail.length >= 2 ? trail[trail.length - 2] : trail.length === 1 ? trail[0] : DASHBOARD_TRAIL;
  return {
    parentHref: parentItem.href ?? "/dashboard",
    parentLabel: parentItem.label,
    trail,
    origin,
  };
}

export function navContextNoQtyExecutionRegister(origin = "sidebar"): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, { label: "NO_QTY Execution" }], origin);
}

export function navContextExecutionWorkspace(origin = "sidebar"): ErpNavContext {
  if (origin === "pending-actions") {
    return makeNavContext(
      [DASHBOARD_TRAIL, PENDING_ACTIONS_TRAIL, { label: "Execution Workspace" }],
      origin,
    );
  }
  return makeNavContext(
    [DASHBOARD_TRAIL, NO_QTY_EXECUTION_TRAIL, { label: "Execution Workspace" }],
    origin,
  );
}

export function navContextRmControlCenterFromDashboard(): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, { label: "RM Control Center" }], "dashboard");
}

export function navContextRmControlCenterFromWorkspace(
  workspaceHref: string,
  origin?: string,
): ErpNavContext {
  if (origin === "pending-actions") {
    return makeNavContext(
      [
        DASHBOARD_TRAIL,
        PENDING_ACTIONS_TRAIL,
        { label: "Execution Workspace", href: workspaceHref },
        { label: "RM Control Center" },
      ],
      origin,
    );
  }
  return makeNavContext(
    [
      DASHBOARD_TRAIL,
      NO_QTY_EXECUTION_TRAIL,
      { label: "Execution Workspace", href: workspaceHref },
      { label: "RM Control Center" },
    ],
    origin,
  );
}

export function navContextMaterialIssueFromDashboard(): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, { label: "Material Issue" }], "dashboard");
}

/** Sidebar / direct Operations nav — safe default when no WO create context. */
export function navContextMaterialIssueFromOperations(): ErpNavContext {
  return makeNavContext([OPERATIONS_TRAIL, { label: "Material Issue" }], "sidebar");
}

export function navContextMaterialIssueFromPendingActions(): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, PENDING_ACTIONS_TRAIL, { label: "Material Issue" }], "pending-actions");
}

/**
 * Material Issue opened after Create WO (or from WO detail).
 * Back → WO detail ("Back to Work Order"); breadcrumb Work Orders → WO-… → Material Issue.
 */
export function navContextMaterialIssueFromWorkOrder(opts: {
  workOrderId: number;
  workOrderLabel: string;
  origin?: string;
}): ErpNavContext {
  const woId = Number(opts.workOrderId);
  const woHref = woId > 0 ? `/work-orders/${woId}` : "/work-orders?flow=REGULAR_SO";
  const label = opts.workOrderLabel.trim() || (woId > 0 ? `WO-${woId}` : "Work Order");
  return {
    parentHref: woHref,
    parentLabel: "Work Order",
    trail: [WORK_ORDERS_TRAIL, { label, href: woHref }, { label: "Material Issue" }],
    origin: opts.origin ?? "create-work-order",
  };
}

export function navContextRmControlCenterFromPendingActions(): ErpNavContext {
  return makeNavContext(
    [DASHBOARD_TRAIL, PENDING_ACTIONS_TRAIL, { label: "RM Control Center" }],
    "pending-actions",
  );
}

export function withCurrentPageHref(trail: ErpNavTrailItem[], currentHref: string): ErpNavTrailItem[] {
  const next = [...trail];
  const last = next[next.length - 1];
  if (last) {
    next[next.length - 1] = { ...last, href: currentHref };
  }
  return next;
}

export function navContextMaterialIssueFromRmcc(
  rmccContext: ErpNavContext,
  rmccHref: string,
): ErpNavContext {
  const withRmcc = withCurrentPageHref(rmccContext.trail, rmccHref);
  withRmcc.push({ label: "Material Issue" });
  return makeNavContext(withRmcc, rmccContext.origin);
}

export function navContextDispatchFromDashboard(): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, { label: "Dispatch" }], "dashboard");
}

export function navContextDispatchFromSalesOrders(): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, SALES_ORDERS_TRAIL, { label: "Dispatch" }], "sales_orders");
}

export function navContextDispatchFromNoQtyExecution(origin = "no-qty"): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, NO_QTY_EXECUTION_TRAIL, { label: "Dispatch" }], origin);
}

export function navContextDispatchFromPendingActions(): ErpNavContext {
  return makeNavContext([DASHBOARD_TRAIL, PENDING_ACTIONS_TRAIL, { label: "Dispatch" }], "pending-actions");
}

export function augmentDispatchNavContextWithSalesOrder(
  base: ErpNavContext,
  salesOrderId: number,
  salesOrderLabel: string,
): ErpNavContext {
  const withoutDispatch = base.trail.slice(0, -1);
  return makeNavContext(
    [
      ...withoutDispatch,
      { label: salesOrderLabel, href: `/sales-orders/${salesOrderId}` },
      { label: "Dispatch" },
    ],
    base.origin,
  );
}

export function navContextMaterialIssueFromExecutionWorkspace(
  workspaceHref: string,
  origin?: string,
): ErpNavContext {
  if (origin === "pending-actions") {
    return makeNavContext(
      [
        DASHBOARD_TRAIL,
        PENDING_ACTIONS_TRAIL,
        { label: "Execution Workspace", href: workspaceHref },
        { label: "Material Issue" },
      ],
      origin,
    );
  }
  return makeNavContext(
    [
      DASHBOARD_TRAIL,
      NO_QTY_EXECUTION_TRAIL,
      { label: "Execution Workspace", href: workspaceHref },
      { label: "Material Issue" },
    ],
    origin,
  );
}

export function navStateWithNavContext(navContext: ErpNavContext): { navContext: ErpNavContext } {
  return { navContext };
}

function queryOrigin(params: URLSearchParams): string | null {
  const source = params.get("source");
  const from = params.get("from");
  if (source === "dashboard" || from === "dashboard") return "dashboard";
  if (from === "pending-actions" || params.get("returnTo") === "pending-actions") return "pending-actions";
  if (from === "control-tower" || params.get("returnTo") === "control-tower") return "control-tower";
  if (from === "execution-register" || source === "no_qty_execution") return "execution-register";
  if (
    source === "create-work-order" ||
    from === "create-work-order" ||
    params.get("returnTo") === "work-order-detail"
  ) {
    return "create-work-order";
  }
  if (from === "work-order-detail" || source === "work-order-detail") return "work-order-detail";
  if (params.get("returnTo") === "dashboard") return "dashboard";
  return null;
}

function materialIssueWorkOrderLabel(params: URLSearchParams, workOrderId: number): string {
  const fromQuery = params.get("workOrderNo")?.trim();
  if (fromQuery) return fromQuery;
  if (workOrderId > 0) return `WO-${workOrderId}`;
  return "Work Order";
}

function isMaterialIssueFromCreatedWorkOrder(params: URLSearchParams): boolean {
  const source = (params.get("source") ?? "").trim().toLowerCase();
  const from = (params.get("from") ?? "").trim().toLowerCase();
  const returnTo = (params.get("returnTo") ?? "").trim().toLowerCase();
  if (source === "create-work-order" || from === "create-work-order") return true;
  if (returnTo === "work-order-detail" || from === "work-order-detail" || source === "work-order-detail") {
    return true;
  }
  // Legacy post-create links used prepare-wo; with a WO id, prefer WO detail (creation already done).
  if (
    (returnTo === "prepare-wo" || from === "prepare-wo" || source === "prepare-wo") &&
    Number(params.get("workOrderId") || 0) > 0
  ) {
    return true;
  }
  return false;
}

/** Resolve NavContext for Store Execution pilot pages (state → query → defaults). */
export function resolveStoreExecutionNavContext(
  location: Pick<Location, "state" | "search" | "pathname">,
  pageKey: StoreExecutionNavPageKey,
): ErpNavContext {
  const fromState = readNavContextFromLocationState(location.state);
  if (fromState) return fromState;

  const params = new URLSearchParams(location.search);
  const origin = queryOrigin(params) ?? "sidebar";
  const returnTo = params.get("returnTo");
  const from = params.get("from") ?? "";

  switch (pageKey) {
    case "no-qty-execution":
      return navContextNoQtyExecutionRegister(origin === "sidebar" ? "sidebar" : origin);

    case "execution-workspace":
      if (from === "pending-actions") {
        return navContextExecutionWorkspace("pending-actions");
      }
      return navContextExecutionWorkspace(origin === "execution-register" ? origin : origin);

    case "rm-control-center":
      if (returnTo === "pending-actions") {
        return navContextRmControlCenterFromPendingActions();
      }
      if (returnTo === "dashboard" || origin === "dashboard") {
        return navContextRmControlCenterFromDashboard();
      }
      if (
        from === "pending-actions" &&
        params.get("focus") === "execution" &&
        params.get("salesOrderId")
      ) {
        const soId = params.get("salesOrderId");
        const sheetId = params.get("sheetId");
        const wsParams = new URLSearchParams({ focus: "execution", from: "pending-actions" });
        if (sheetId) wsParams.set("sheetId", sheetId);
        return navContextRmControlCenterFromWorkspace(
          `/sales-orders/${soId}/requirement-sheets?${wsParams.toString()}`,
          "pending-actions",
        );
      }
      if (from === "execution-register" || params.get("source") === "no_qty_execution") {
        return navContextRmControlCenterFromWorkspace(
          `/sales-orders/${params.get("salesOrderId") ?? ""}/requirement-sheets?focus=execution`,
          origin,
        );
      }
      return navContextRmControlCenterFromDashboard();

    case "material-issue":
      if (returnTo === "pending-actions") {
        return navContextMaterialIssueFromPendingActions();
      }
      if (returnTo === "dashboard" || origin === "dashboard" || params.get("source") === "dashboard") {
        return navContextMaterialIssueFromDashboard();
      }
      if (isMaterialIssueFromCreatedWorkOrder(params)) {
        const woId = Number(params.get("workOrderId") ?? 0);
        if (woId > 0) {
          return navContextMaterialIssueFromWorkOrder({
            workOrderId: woId,
            workOrderLabel: materialIssueWorkOrderLabel(params, woId),
            origin:
              origin === "create-work-order" || origin === "work-order-detail"
                ? origin
                : "create-work-order",
          });
        }
      }
      if (returnTo === "rm-control-center") {
        const soId = params.get("salesOrderId");
        const wsFocus = params.get("focus") === "execution";
        if (soId && wsFocus && from === "pending-actions") {
          const wsParams = new URLSearchParams({ focus: "execution", from: "pending-actions" });
          const sheetId = params.get("sheetId");
          if (sheetId) wsParams.set("sheetId", sheetId);
          const rmccCtx = navContextRmControlCenterFromWorkspace(
            `/sales-orders/${soId}/requirement-sheets?${wsParams.toString()}`,
            "pending-actions",
          );
          return navContextMaterialIssueFromRmcc(rmccCtx, RM_CONTROL_CENTER_TRAIL.href!);
        }
        if (soId && (from === "execution-register" || params.get("source") === "no_qty_execution")) {
          const rmccCtx = navContextRmControlCenterFromWorkspace(
            `/sales-orders/${soId}/requirement-sheets?focus=execution`,
            origin,
          );
          return navContextMaterialIssueFromRmcc(rmccCtx, RM_CONTROL_CENTER_TRAIL.href!);
        }
        return makeNavContext(
          [DASHBOARD_TRAIL, RM_CONTROL_CENTER_TRAIL, { label: "Material Issue" }],
          "rm-control-center",
        );
      }
      // Direct nav / sidebar — Operations section safe default
      return navContextMaterialIssueFromOperations();

    case "dispatch":
      if (returnTo === "pending-actions" || from === "pending-actions") {
        return navContextDispatchFromPendingActions();
      }
      if (params.get("source") === "sales_orders" || from === "sales-orders") {
        return navContextDispatchFromSalesOrders();
      }
      if (
        params.get("source") === "no_qty_so" ||
        params.get("source") === "no_qty_execution" ||
        from === "execution-register"
      ) {
        return navContextDispatchFromNoQtyExecution(
          params.get("source") === "no_qty_so" ? "no-qty" : origin,
        );
      }
      if (
        params.get("source") === "dashboard" ||
        returnTo === "dashboard" ||
        origin === "dashboard"
      ) {
        return navContextDispatchFromDashboard();
      }
      return navContextDispatchFromDashboard();

    default:
      return navContextNoQtyExecutionRegister("sidebar");
  }
}
