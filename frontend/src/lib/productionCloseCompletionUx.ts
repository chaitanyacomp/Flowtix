import type { ProductionExecutionClosedOutcome } from "./productionCompletionUx";
import {
  buildPendingActionsProductionOverviewHref,
  buildProductionWorkspaceOverviewHref,
} from "./productionWorkspaceRouteContract";

export const PRODUCTION_WORKSPACE_DASHBOARD_HREF = "/production";
export const PRODUCTION_CLOSE_RETURN_DELAY_MS = 2000;

/** Primary operator-facing success copy after Confirm Report & Close WO. */
export const PRODUCTION_REPORT_CLOSE_SUCCESS_TOAST = "Production report confirmed and WO closed.";

export function buildProductionCloseSuccessToast(outcome: ProductionExecutionClosedOutcome): string {
  if (outcome === "CARRY_FORWARD") {
    return `${PRODUCTION_REPORT_CLOSE_SUCCESS_TOAST}\nRemaining quantity carried forward for recovery.`;
  }
  return PRODUCTION_REPORT_CLOSE_SUCCESS_TOAST;
}

export function resolveProductionCloseNavigationOrigin(input: {
  from?: string | null;
  source?: string | null;
  returnTo?: string | null;
}): "pending-actions" | "no-qty-execution" | "default" {
  const from = String(input.from ?? "").trim();
  const source = String(input.source ?? "").trim();
  const returnTo = String(input.returnTo ?? "").trim();
  if (from === "pending-actions" || returnTo === "pending-actions" || source === "pending-actions") {
    return "pending-actions";
  }
  if (
    from === "execution-register" ||
    source === "no_qty_execution" ||
    from === "inbox" ||
    source === "no_qty_planning" ||
    source === "no_qty_rs" ||
    from === "rs-page"
  ) {
    return "no-qty-execution";
  }
  return "default";
}

/**
 * Canonical post–Confirm Report & Close WO landing:
 * Production Workspace → Ready to Start (card workbench).
 * Never returns a NO_QTY guided / Select-WO URL.
 */
export function buildPostProductionReportCloseHref(input?: {
  from?: string | null;
  returnTo?: string | null;
  source?: string | null;
}): string {
  const origin = resolveProductionCloseNavigationOrigin(input ?? {});
  if (origin === "pending-actions") {
    return buildPendingActionsProductionOverviewHref("readyToStart");
  }
  return buildProductionWorkspaceOverviewHref({
    productionBucket: "readyToStart",
    pwSection: "ready",
  });
}

/**
 * Orphan NO_QTY query (source/flow without SO/WO) renders the obsolete Select-WO screen.
 * Redirect those URLs to the card workspace Ready to Start.
 */
export function shouldRedirectLegacyOrphanNoQtyProductionSearch(
  search: string | URLSearchParams,
): boolean {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const source = String(params.get("source") ?? "")
    .trim()
    .toLowerCase();
  const flow = String(params.get("flow") ?? "")
    .trim()
    .toUpperCase();
  const fromNoQty = source === "no_qty_so" || flow === "NO_QTY";
  if (!fromNoQty) return false;
  const wo = Number(params.get("workOrderId") ?? params.get("woId") ?? 0);
  const wol = Number(params.get("workOrderLineId") ?? 0);
  const so = Number(params.get("salesOrderId") ?? 0);
  if (Number.isFinite(wo) && wo > 0) return false;
  if (Number.isFinite(wol) && wol > 0) return false;
  if (Number.isFinite(so) && so > 0) return false;
  return true;
}
