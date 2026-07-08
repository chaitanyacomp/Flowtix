/**
 * M1.2 — Manufacturing workspace navigation continuity (presentation only).
 * Consolidates returnTo / from / workspace-origin patterns across Store → Dispatch.
 */

import {
  materialIssueWorkspaceHref,
  postWoMaterialIssueHref,
  rmControlCenterHref,
} from "./materialWorkflowLinks";
import {
  appendNavFrom,
  FROM_WORK_ORDER_WORKSPACE,
  productionHrefFromDashboardRow,
  type ProductionQueueRowLink,
} from "./operationalWorkspaceLinks";
import { buildProductionScopedHref } from "./productionNavigation";

/** Query `from` token when opening scoped production from the production workspace list. */
export const FROM_PRODUCTION_WORKSPACE = "production-workspace";

export type ManufacturingNavPreserveInput = {
  returnTo?: string | null;
  from?: string | null;
  salesOrderId?: number | null;
  requirementSheetId?: number | null;
  workOrderId?: number | null;
  productionBucket?: string | null;
};

export function appendManufacturingNavPreserve(
  qs: URLSearchParams,
  input: ManufacturingNavPreserveInput,
): void {
  if (input.returnTo?.trim()) qs.set("returnTo", input.returnTo.trim());
  if (input.from?.trim()) qs.set("from", input.from.trim());
  if (input.salesOrderId != null && Number(input.salesOrderId) > 0) {
    qs.set("salesOrderId", String(input.salesOrderId));
  }
  if (input.requirementSheetId != null && Number(input.requirementSheetId) > 0) {
    qs.set("requirementSheetId", String(input.requirementSheetId));
  }
  if (input.workOrderId != null && Number(input.workOrderId) > 0) {
    qs.set("workOrderId", String(input.workOrderId));
  }
  if (input.productionBucket?.trim()) qs.set("productionBucket", input.productionBucket.trim());
}

/** Production workspace list URL — preserves optional bucket filter. */
export function buildProductionWorkspaceListHref(opts?: {
  productionBucket?: string | null;
  from?: string | null;
}): string {
  const qs = new URLSearchParams();
  if (opts?.productionBucket?.trim()) qs.set("productionBucket", opts.productionBucket.trim());
  if (opts?.from?.trim()) qs.set("from", opts.from.trim());
  const q = qs.toString();
  return q ? `/production?${q}` : "/production";
}

/** Scoped production deep-link from production workspace list — preserves back to `/production`. */
export function productionHrefFromProductionWorkspace(row: ProductionQueueRowLink): string {
  return appendNavFrom(
    productionHrefFromDashboardRow(row),
    FROM_PRODUCTION_WORKSPACE,
  );
}

export type MaterialIssueDeepLinkInput = {
  workOrderId?: number;
  pmrId?: number | null;
  returnTo?: string;
  requirementSheetId?: number | null;
  salesOrderId?: number | null;
  source?: string;
};

/** Canonical Material Issue deep link — replaces scattered `/material-issue?...` builders. */
export function buildMaterialIssueDeepLink(input: MaterialIssueDeepLinkInput): string {
  const pmrId = input.pmrId != null ? Number(input.pmrId) : 0;
  const woId = Number(input.workOrderId ?? 0);
  if (pmrId > 0 && woId <= 0) {
    return materialIssueWorkspaceHref({
      pmrId,
      returnTo: input.returnTo,
    });
  }
  if (woId > 0) {
    return postWoMaterialIssueHref({
      workOrderId: woId,
      pmrId: pmrId > 0 ? pmrId : null,
      returnTo: input.returnTo,
      requirementSheetId: input.requirementSheetId,
      salesOrderId: input.salesOrderId,
    });
  }
  const qs = new URLSearchParams();
  if (input.returnTo) qs.set("returnTo", input.returnTo);
  if (input.source) qs.set("source", input.source);
  const q = qs.toString();
  return q ? `/material-issue?${q}` : "/material-issue";
}

/** RM Control Center deep link — single builder (replaces duplicate woProcurement variant). */
export function buildRmControlCenterDeepLink(opts: {
  workOrderId?: number;
  rmItemId?: number | null;
  salesOrderId?: number | null;
  materialRequirementId?: number | null;
  returnTo?: string | null;
  onlyBlocked?: boolean;
}): string {
  return rmControlCenterHref({
    workOrderId: opts.workOrderId,
    rmItemId: opts.rmItemId ?? undefined,
    salesOrderId: opts.salesOrderId ?? undefined,
    materialRequirementId: opts.materialRequirementId ?? undefined,
    returnTo: opts.returnTo ?? undefined,
    onlyBlocked: opts.onlyBlocked,
  });
}

/** Post-issue / post-action URL search params for Material Issue session continuity. */
export function buildMaterialIssuePostActionSearchParams(
  input: ManufacturingNavPreserveInput,
): Record<string, string> {
  const next: Record<string, string> = {};
  if (input.returnTo?.trim()) next.returnTo = input.returnTo.trim();
  if (input.returnTo === "production-workspace") {
    if (input.workOrderId != null && input.workOrderId > 0) {
      next.workOrderId = String(input.workOrderId);
    }
    if (input.productionBucket?.trim()) next.productionBucket = input.productionBucket.trim();
  }
  if (input.salesOrderId != null && input.salesOrderId > 0) {
    next.salesOrderId = String(input.salesOrderId);
  }
  if (input.requirementSheetId != null && input.requirementSheetId > 0) {
    next.requirementSheetId = String(input.requirementSheetId);
  }
  return next;
}

/** REGULAR dispatch footer / cross-workspace links — preserves return context like NO_QTY guided href. */
export function buildRegularDispatchGuidedHref(opts: {
  to: string;
  salesOrderId: number;
  fromStep?: string;
}): string {
  const hashIdx = opts.to.indexOf("#");
  const hash = hashIdx >= 0 ? opts.to.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? opts.to.slice(0, hashIdx) : opts.to;
  const qIdx = base.indexOf("?");
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const qs = new URLSearchParams(qIdx >= 0 ? base.slice(qIdx + 1) : "");
  if (opts.salesOrderId > 0) qs.set("salesOrderId", String(opts.salesOrderId));
  qs.set("fromStep", opts.fromStep ?? "dispatch");
  qs.set("from", "dispatch");
  qs.set("returnTo", "dispatch");
  const q = qs.toString();
  return `${path}${q ? `?${q}` : ""}${hash}`;
}

export { FROM_WORK_ORDER_WORKSPACE, buildProductionScopedHref };
