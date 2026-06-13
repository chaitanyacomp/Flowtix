import { buildProductionScopedHref, productionWorkspaceHref } from "./productionNavigation";

export { buildProductionScopedHref, productionWorkspaceHref };
export type { ProductionScopedNavInput } from "./productionNavigation";

/** Deep links for Production → PMR → Material Issue operational flow (UX only). */

export function materialRequestsQueueHref(opts: {
  workOrderId?: number;
  workOrderLineId?: number;
  pmrId?: number | null;
  returnTo?: string;
  tab?: "create";
}): string {
  const q = new URLSearchParams();
  if (opts.workOrderId && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.workOrderLineId && opts.workOrderLineId > 0) q.set("workOrderLineId", String(opts.workOrderLineId));
  if (opts.pmrId && opts.pmrId > 0) q.set("pmrId", String(opts.pmrId));
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  if (opts.tab) q.set("tab", opts.tab);
  const s = q.toString();
  return s ? `/production/material-requests?${s}` : "/production/material-requests";
}

export function materialIssueWorkspaceHref(opts: {
  pmrId: number;
  workOrderId?: number;
  returnTo?: string;
}): string {
  const q = new URLSearchParams({ pmrId: String(opts.pmrId) });
  if (opts.workOrderId && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  return `/material-issue?${q.toString()}`;
}

/** RM Control Center — read-only diagnosis for Production; Store executes from here. */
export function rmControlCenterHref(opts: {
  workOrderId?: number;
  rmItemId?: number;
  salesOrderId?: number;
  materialRequirementId?: number;
  onlyBlocked?: boolean;
  returnTo?: string;
}): string {
  const q = new URLSearchParams();
  if (opts.workOrderId && opts.workOrderId > 0) q.set("workOrderId", String(opts.workOrderId));
  if (opts.rmItemId && opts.rmItemId > 0) q.set("rmItemId", String(opts.rmItemId));
  if (opts.salesOrderId && opts.salesOrderId > 0) q.set("salesOrderId", String(opts.salesOrderId));
  if (opts.materialRequirementId && opts.materialRequirementId > 0) {
    q.set("materialRequirementId", String(opts.materialRequirementId));
  }
  if (opts.onlyBlocked) q.set("onlyBlocked", "true");
  if (opts.returnTo) q.set("returnTo", opts.returnTo);
  const s = q.toString();
  return s ? `/reports/rm-shortage?${s}` : "/reports/rm-shortage";
}

/** Dashboard / workspace deep link when Production is blocked on material (no Store issue route). */
export function productionMaterialBlockedHref(opts: {
  workOrderId?: number;
  workOrderLineId?: number;
  gate?: "WAITING_STORE_ISSUE" | "NO_PMR" | "PMR_DRAFT_ONLY" | null;
  returnTo?: string;
}): string {
  const woId = opts.workOrderId && opts.workOrderId > 0 ? opts.workOrderId : 0;
  if (opts.gate === "NO_PMR" || opts.gate === "PMR_DRAFT_ONLY") {
    return materialRequestsQueueHref({
      workOrderId: woId || undefined,
      workOrderLineId: opts.workOrderLineId,
      returnTo: opts.returnTo,
      tab: "create",
    });
  }
  if (woId > 0) {
    return productionWorkspaceHref(woId, opts.workOrderLineId);
  }
  return rmControlCenterHref({ onlyBlocked: true, returnTo: opts.returnTo });
}

export function materialWorkflowBackHref(returnTo: string | null, workOrderId?: number): string {
  if (returnTo === "dashboard") return "/dashboard";
  if (returnTo === "production-workspace" && workOrderId && workOrderId > 0) {
    return productionWorkspaceHref(workOrderId);
  }
  if (returnTo === "material-requests") return materialRequestsQueueHref({});
  return "/production/material-requests";
}
