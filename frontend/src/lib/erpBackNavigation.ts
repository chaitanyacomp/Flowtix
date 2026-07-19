import type { Location } from "react-router-dom";
import { isReportsReturnContext } from "./drillDownRoutes";
import { readWorkQueueFromLocationState } from "./workQueueContext";
import type { ErpNavContext } from "./erpNavContext";
import { materialWorkflowBackHref } from "./materialWorkflowLinks";
import { NO_QTY_TERMS } from "./flowTerminology";
import { isStoreLikePlanningRole, noQtyAgreementListHref } from "./noQtyStoreNavigation";

export type ERPBackNavigationTarget = {
  to: string;
  label: string;
};

export type ERPBackNavigationKind = "reports" | "dashboard" | "production" | "generic";

export type ERPBackSmartSource =
  | "dashboard"
  | "reports"
  | "stock_summary"
  | "production_flow"
  | "production_screen"
  | "no_qty_so"
  | "quotations"
  | "enquiries"
  | "planning"
  | "pending-actions"
  | "control-tower";

export const ERP_BACK_SMART_MAP: Record<ERPBackSmartSource, ERPBackNavigationTarget> = {
  dashboard: { to: "/dashboard", label: "Back to Dashboard" },
  reports: { to: "/reports", label: "Back to Reports" },
  stock_summary: { to: "/stock", label: "Back to Stock Summary" },
  production_flow: { to: "/dashboard", label: "Back to Dashboard" },
  production_screen: { to: "/production", label: "Back to Production" },
  no_qty_so: { to: "/sales-orders?soType=NO_QTY", label: "Back to No Qty Sales Orders" },
  quotations: { to: "/quotations", label: "Back to Quotations" },
  enquiries: { to: "/enquiries", label: "Back to Enquiries" },
  planning: { to: "/planning-dashboard", label: NO_QTY_TERMS.BACK_TO_REQUIREMENT_CYCLE_PLANNING },
  "pending-actions": { to: "/pending-actions", label: "Back to Pending Actions" },
  "control-tower": { to: "/control-tower", label: "Back to Control Tower" },
};

export const ERP_RETURN_TO_TOKEN_MAP: Record<string, ERPBackNavigationTarget> = {
  dashboard: ERP_BACK_SMART_MAP.dashboard,
  reports: ERP_BACK_SMART_MAP.reports,
  "pending-actions": ERP_BACK_SMART_MAP["pending-actions"],
  "control-tower": ERP_BACK_SMART_MAP["control-tower"],
  "material-issue": { to: "/material-issue", label: "Back to Material Issue" },
  "work-order-workspace": { to: "/work-orders", label: "Back to Work Order Workspace" },
  "production-workspace": { to: "/production", label: "Back to Production Workspace" },
  "rm-control-center": { to: "/reports/rm-shortage", label: "Back to RM Control Center" },
  production: { to: "/production", label: "Back to Production Workspace" },
  "work-orders": { to: "/work-orders", label: "Back to Work Orders" },
  "rm-purchase": { to: "/rm-po-grn", label: "Back to RM Purchase" },
  dispatch: { to: "/dispatch", label: "Back to Dispatch Workspace" },
  "material-requests": { to: "/production/material-requests", label: "Back to Material Requests" },
  "requirement-sheet": { to: "/sales-orders", label: "Back to Sales Orders" },
  "requirement-sheet-execution": { to: "/sales-orders", label: "Back to Sales Orders" },
};

export const ERP_COMMERCIAL_ORIGIN_SESSION_KEY = "erp:commercialOrigin";

function asSmartSourceKey(v: string | null | undefined): ERPBackSmartSource | null {
  const x = String(v ?? "").trim().toLowerCase();
  if (x in ERP_BACK_SMART_MAP) return x as ERPBackSmartSource;
  if (x === "production" || x === "production-flow") return "production_flow";
  return null;
}

export function noQtySoBackTarget(
  role: string | undefined | null,
  salesOrderId?: number | null,
): ERPBackNavigationTarget {
  const storeLike = isStoreLikePlanningRole(role);
  const to = noQtyAgreementListHref(role, salesOrderId ?? undefined);
  if (storeLike) return { to, label: "Back to NO_QTY Execution" };
  if (salesOrderId != null && salesOrderId > 0) {
    return { to, label: "Back to No Qty Sales Order" };
  }
  return { to, label: "Back to No Qty Sales Orders" };
}

function readSessionWorkflowBack(): ERPBackNavigationTarget | null {
  try {
    const raw = sessionStorage.getItem(ERP_COMMERCIAL_ORIGIN_SESSION_KEY);
    const k = asSmartSourceKey(raw);
    if (k === "quotations" || k === "enquiries") return ERP_BACK_SMART_MAP[k];
  } catch {
    /* ignore */
  }
  return null;
}

function resolveReturnToTarget(
  returnToRaw: string,
  searchParams: URLSearchParams,
  workOrderId?: number,
): ERPBackNavigationTarget | null {
  const trimmed = returnToRaw.trim();
  if (!trimmed) return null;
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith("/")) {
      const source = searchParams.get("source") ?? "";
      if (source === "rm-shortage") {
        return { to: decoded, label: "Back to RM Shortage Workspace" };
      }
      return { to: decoded, label: "Back to Previous Workspace" };
    }
  } catch {
    /* ignore */
  }
  const token = trimmed.toLowerCase();
  const mapped = ERP_RETURN_TO_TOKEN_MAP[token];
  if (mapped) {
    if (token === "production-workspace") {
      const bucket = searchParams.get("productionBucket");
      const qs = new URLSearchParams();
      if (bucket?.trim()) qs.set("productionBucket", bucket.trim());
      const section = searchParams.get("pwSection");
      if (section?.trim()) qs.set("pwSection", section.trim());
      else if (bucket === "readyToStart") qs.set("pwSection", "ready");
      else if (bucket === "inProgress") qs.set("pwSection", "active");
      for (const key of ["pwq", "pwFlow", "pwSort", "pwSize", "pwPage", "pwFocus"]) {
        const v = searchParams.get(key);
        if (v?.trim()) qs.set(key, v.trim());
      }
      const q = qs.toString();
      return { to: q ? `/production?${q}` : "/production", label: "Back to Production Workspace" };
    }
    if (token === "dispatch") {
      const soId = Number(searchParams.get("salesOrderId") || 0);
      return {
        to: soId > 0 ? `/dispatch?salesOrderId=${soId}` : "/dispatch",
        label: "Back to Dispatch Workspace",
      };
    }
    return mapped;
  }
  if (token === "production-workspace" && workOrderId && workOrderId > 0) {
    return {
      to: materialWorkflowBackHref(token, workOrderId, {
        productionBucket: searchParams.get("productionBucket"),
      }),
      label: "Back to Production Workspace",
    };
  }
  const href = materialWorkflowBackHref(trimmed, workOrderId);
  if (href) {
    return { to: href, label: "Back to Previous Workspace" };
  }
  return null;
}

export function resolveERPBackTarget(
  location: Pick<Location, "pathname" | "search" | "state">,
  options: {
    defaultTo: string;
    defaultLabel: string;
    navContext?: ErpNavContext | null;
    kind?: ERPBackNavigationKind;
    workflowSessionFallback?: boolean;
    role?: string | null;
    workOrderId?: number;
    reportBack?: ERPBackNavigationTarget;
  },
): ERPBackNavigationTarget {
  const {
    defaultTo,
    defaultLabel,
    navContext = null,
    kind = "generic",
    workflowSessionFallback = false,
    role,
    workOrderId,
    reportBack,
  } = options;

  if (navContext?.parentHref) {
    return {
      to: navContext.parentHref,
      label: navContext.parentLabel.startsWith("Back to")
        ? navContext.parentLabel
        : `Back to ${navContext.parentLabel}`,
    };
  }

  const workQueue = readWorkQueueFromLocationState(location.state);
  if (workQueue?.returnToPendingActions) {
    return ERP_BACK_SMART_MAP["pending-actions"];
  }

  if (kind === "reports" || isReportsReturnContext(location.search)) {
    return reportBack ?? ERP_BACK_SMART_MAP.reports;
  }

  const searchParams = new URLSearchParams(location.search);
  const state = (location.state ?? {}) as {
    backTo?: unknown;
    backLabel?: unknown;
    from?: unknown;
  };

  const stateBackTo = typeof state.backTo === "string" ? state.backTo : null;
  const stateBackLabel = typeof state.backLabel === "string" ? state.backLabel : null;
  const stateFromTo = typeof state.from === "string" ? state.from : null;
  const stateFromKey = stateFromTo && !stateFromTo.startsWith("/") ? asSmartSourceKey(stateFromTo) : null;
  const fromKey = asSmartSourceKey(searchParams.get("from"));
  const sourceKey = asSmartSourceKey(searchParams.get("source"));
  const querySourceKey =
    (fromKey && fromKey !== "reports" ? fromKey : null) ??
    (sourceKey && sourceKey !== "reports" ? sourceKey : null);

  const returnToRaw = searchParams.get("returnTo");
  if (returnToRaw) {
    const returnTarget = resolveReturnToTarget(returnToRaw, searchParams, workOrderId);
    if (returnTarget) return returnTarget;
  }

  const fromTokenRaw = searchParams.get("from")?.trim().toLowerCase();
  if (fromTokenRaw && ERP_RETURN_TO_TOKEN_MAP[fromTokenRaw]) {
    const fromTarget = resolveReturnToTarget(fromTokenRaw, searchParams, workOrderId);
    if (fromTarget) return fromTarget;
  }

  const fromStepRaw = searchParams.get("fromStep")?.trim().toLowerCase();
  if (fromStepRaw === "dispatch") {
    const soId = Number(searchParams.get("salesOrderId") || 0);
    return {
      to: soId > 0 ? `/dispatch?salesOrderId=${soId}` : "/dispatch",
      label: "Back to Dispatch Workspace",
    };
  }

  if (stateBackTo) {
    return {
      to: stateBackTo,
      label: stateBackLabel?.trim() || "Back to Previous Workspace",
    };
  }

  if (stateFromKey) {
    if (stateFromKey === "no_qty_so") return noQtySoBackTarget(role, Number(searchParams.get("salesOrderId")) || undefined);
    return ERP_BACK_SMART_MAP[stateFromKey];
  }

  if (querySourceKey) {
    if (querySourceKey === "no_qty_so") {
      const soId = Number(searchParams.get("salesOrderId") ?? 0);
      return noQtySoBackTarget(role, Number.isFinite(soId) && soId > 0 ? soId : undefined);
    }
    return ERP_BACK_SMART_MAP[querySourceKey];
  }

  if (workflowSessionFallback) {
    const sessionBack = readSessionWorkflowBack();
    if (sessionBack) return sessionBack;
  }

  if (kind === "dashboard") return ERP_BACK_SMART_MAP.dashboard;

  if (kind === "production") {
    const source = (searchParams.get("source") || searchParams.get("from") || "").toLowerCase();
    if (source === "no_qty_so") {
      const soId = Number(searchParams.get("salesOrderId") ?? 0);
      return noQtySoBackTarget(role, Number.isFinite(soId) && soId > 0 ? soId : undefined);
    }
    if (source === "production-workspace") {
      const bucket = searchParams.get("productionBucket");
      const qs = new URLSearchParams();
      if (bucket?.trim()) qs.set("productionBucket", bucket.trim());
      const section = searchParams.get("pwSection");
      if (section?.trim()) qs.set("pwSection", section.trim());
      else if (bucket === "readyToStart") qs.set("pwSection", "ready");
      else if (bucket === "inProgress") qs.set("pwSection", "active");
      for (const key of ["pwq", "pwFlow", "pwSort", "pwSize", "pwPage", "pwFocus"]) {
        const v = searchParams.get(key);
        if (v?.trim()) qs.set(key, v.trim());
      }
      const q = qs.toString();
      return { to: q ? `/production?${q}` : "/production", label: "Back to Production Workspace" };
    }
    const fromStep = (searchParams.get("fromStep") || "").toLowerCase();
    if (fromStep === "dispatch" || source === "dispatch") {
      const soId = Number(searchParams.get("salesOrderId") ?? 0);
      return {
        to: soId > 0 ? `/dispatch?salesOrderId=${soId}` : "/dispatch",
        label: "Back to Dispatch Workspace",
      };
    }
    return ERP_BACK_SMART_MAP.dashboard;
  }

  if (stateFromTo && stateFromTo.startsWith("/")) {
    return { to: stateFromTo, label: stateBackLabel?.trim() || "Back to Previous Workspace" };
  }

  let target: ERPBackNavigationTarget = { to: defaultTo, label: defaultLabel };

  if (target.to === location.pathname) {
    target = ERP_BACK_SMART_MAP.dashboard;
  }

  return target;
}
