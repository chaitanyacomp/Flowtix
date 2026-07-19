/**

 * Deterministic Production Workspace route contract (navigation only).

 *

 * - general / left-menu → unscoped overview

 * - Pending Actions multi-WO bucket → overview + pwSection + productionBucket + from=pending-actions

 * - Ready/Continue focus → pwFocus (card highlight) without scoping into a WO process

 * - Continue single WO → scoped WO deep-link (executable remaining-balance screen)

 * - completed history → scoped WO (read-only handled by ProductionPage)

 */



import { buildProductionWorkspaceListHref } from "./manufacturingNavigationContinuity";

import { pwSectionForProductionBucket } from "./productionWorkbenchState";



export const PRODUCTION_FROM_PENDING_ACTIONS = "pending-actions";



export type ProductionWorkspaceBucketToken = "readyToStart" | "inProgress";



export type ProductionWorkspaceOverviewOpts = {

  productionBucket?: ProductionWorkspaceBucketToken | string | null;

  pwSection?:
    | "ready"
    | "active"
    | "paused"
    | "reportPending"
    | "pendingQa"
    | "awaitingStore"
    | "recent"
    | string
    | null;

  /** Card highlight only — must not pin scoped WO process (use instead of workOrderId). */

  pwFocus?: number | string | null;

  from?: string | null;

  returnTo?: string | null;

  /** Optional notice when a stale deep-link was redirected to the WO’s current state. */

  pwNotice?: string | null;

};



/** Left-menu / clean overview — no SO/cycle/WO pinning. */

export function buildProductionWorkspaceOverviewHref(opts?: ProductionWorkspaceOverviewOpts): string {

  const qs = new URLSearchParams();

  const bucket = String(opts?.productionBucket ?? "").trim();

  if (bucket) qs.set("productionBucket", bucket);



  let section = String(opts?.pwSection ?? "").trim();

  if (!section && bucket) {

    const mapped = pwSectionForProductionBucket(bucket);

    if (mapped) section = mapped;

  }

  // Default Continue tab omits pwSection for a short URL; Ready/Paused/etc. always set it.

  if (section && section !== "active") qs.set("pwSection", section);

  else if (section === "active" && bucket === "inProgress") qs.set("pwSection", "active");



  const focus = opts?.pwFocus != null ? String(opts.pwFocus).trim() : "";

  if (focus && Number(focus) > 0) qs.set("pwFocus", focus);



  const from = String(opts?.from ?? "").trim();

  const returnTo = String(opts?.returnTo ?? "").trim();

  if (from) qs.set("from", from);

  if (returnTo) qs.set("returnTo", returnTo);

  else if (from === PRODUCTION_FROM_PENDING_ACTIONS) qs.set("returnTo", PRODUCTION_FROM_PENDING_ACTIONS);



  const notice = String(opts?.pwNotice ?? "").trim();

  if (notice) qs.set("pwNotice", notice);



  const q = qs.toString();

  return q ? `/production?${q}` : "/production";

}



/**

 * Multi-WO Pending Actions bucket → Workbench tab matching the action

 * (Ready → Ready to Start; Continue → Continue Production). Never pins salesOrderId/cycleId/workOrderId.

 */

export function buildPendingActionsProductionOverviewHref(

  productionBucket: ProductionWorkspaceBucketToken | string | null | undefined,

  opts?: { pwFocus?: number | string | null },

): string {

  const bucket = productionBucket ?? null;

  const section = pwSectionForProductionBucket(bucket) ?? (bucket === "readyToStart" ? "ready" : "active");

  return buildProductionWorkspaceOverviewHref({

    productionBucket: bucket,

    pwSection: section,

    pwFocus: opts?.pwFocus ?? null,

    from: PRODUCTION_FROM_PENDING_ACTIONS,

    returnTo: PRODUCTION_FROM_PENDING_ACTIONS,

  });

}



/** True when URL is an unscoped Production Workspace overview (menu or PA bucket list). */

export function isProductionWorkspaceOverviewSearch(search: string | URLSearchParams): boolean {

  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;

  const wo = Number(params.get("workOrderId") ?? params.get("woId") ?? 0);

  const wol = Number(params.get("workOrderLineId") ?? 0);

  const so = Number(params.get("salesOrderId") ?? 0);

  const source = String(params.get("source") ?? "").trim().toLowerCase();

  const flow = String(params.get("flow") ?? "").trim().toUpperCase();

  if (Number.isFinite(wo) && wo > 0) return false;

  if (Number.isFinite(wol) && wol > 0) return false;

  if (Number.isFinite(so) && so > 0) return false;

  if (source === "no_qty_so") return false;

  if (flow === "NO_QTY" || flow === "GREEN_LEVEL" || flow === "REGULAR_SO") return false;

  if (params.get("fromDashboard") === "1") return false;

  return true;

}



/** Strip SO/cycle/flow/WO pins from a production href, keeping bucket/section + pending-actions return. */

export function toProductionWorkspaceOverviewFromHref(href: string): string {

  try {

    const url = new URL(href, "http://erp.local");

    if (!url.pathname.endsWith("/production")) return href;

    const bucket = url.searchParams.get("productionBucket");

    const section = url.searchParams.get("pwSection");

    const focus = url.searchParams.get("pwFocus");

    const from =

      url.searchParams.get("from") ||

      url.searchParams.get("returnTo") ||

      PRODUCTION_FROM_PENDING_ACTIONS;

    return buildProductionWorkspaceOverviewHref({

      productionBucket: bucket,

      pwSection: section,

      pwFocus: focus,

      from,

      returnTo: PRODUCTION_FROM_PENDING_ACTIONS,

    });

  } catch {

    return buildProductionWorkspaceListHref({ from: PRODUCTION_FROM_PENDING_ACTIONS });

  }

}



/** Parse card-focus WO id (highlight only; does not open scoped process). */

export function parseProductionWorkspaceFocusWo(raw: string | null | undefined): number {

  const id = Number(raw ?? 0);

  return Number.isFinite(id) && id > 0 ? id : 0;

}
