/**
 * M1.2 — Manufacturing workspace navigation continuity (presentation only).
 * Consolidates returnTo / from / workspace-origin patterns across Store → Dispatch.
 */

import { rmControlCenterHref } from "./materialWorkflowLinks";
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

export type { MaterialIssueBucket } from "./materialIssueDeepLink";
export {
  buildMaterialIssueDeepLink as buildMaterialIssueDeepLinkCanonical,
  parseMaterialIssueDeepLink,
  materialIssueBucketForPendingAction,
} from "./materialIssueDeepLink";

import {
  buildMaterialIssueDeepLink as buildMiDeepLink,
  type MaterialIssueBucket,
} from "./materialIssueDeepLink";

export type MaterialIssueDeepLinkInput = {
  workOrderId?: number;
  pmrId?: number | null;
  returnTo?: string;
  requirementSheetId?: number | null;
  salesOrderId?: number | null;
  source?: string;
  /** Canonical MI side-queue bucket (`readyToIssue`, `partiallyIssued`, …). */
  bucket?: MaterialIssueBucket | null;
  listOnly?: boolean;
};

/** Canonical Material Issue deep link — uses `bucket=` + optional WO/PMR. */
export function buildMaterialIssueDeepLink(input: MaterialIssueDeepLinkInput): string {
  return buildMiDeepLink({
    bucket: input.bucket ?? null,
    workOrderId: input.workOrderId,
    pmrId: input.pmrId,
    returnTo: input.returnTo,
    from: input.source === "pending-actions" ? "pending-actions" : input.source ?? null,
    requirementSheetId: input.requirementSheetId,
    salesOrderId: input.salesOrderId,
    listOnly: input.listOnly,
  });
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
