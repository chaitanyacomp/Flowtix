/**
 * Pure helpers for Production deep-link / auto-open navigation stability.
 * One click → one navigate; query params must settle without a replace loop.
 */

export type ProductionIdentityUnresolvedInput = {
  fromNoQtySo: boolean;
  explicitNoQtyUrlNavigate: boolean;
  /** Parsed `flow` query — when REGULAR_SO / GREEN_LEVEL, do not wait on SO master for identity. */
  flowParam: string | null;
  focusSoIdValid: boolean;
  focusSoId: number;
  soOrderTypeKnown: boolean;
  woIdFromUrlValid: boolean;
  initialRefreshDone: boolean;
  woSalesOrderId: number | null;
  woSoOrderTypeKnown: boolean;
  woIsGreenLevel: boolean;
  regularFlowToken: string;
  greenLevelFlowToken: string;
};

/**
 * Whether ProductionPage should hold the "Resolving production context…" gate.
 * Definitive REGULAR_SO / GREEN_LEVEL flow params bypass SO-master wait (fixes Enter Production flicker).
 */
export function shouldHoldProductionIdentityUnresolved(input: ProductionIdentityUnresolvedInput): boolean {
  if (input.fromNoQtySo) return false;
  if (input.explicitNoQtyUrlNavigate) return false;

  const definitiveRegularOrGl =
    input.flowParam === input.regularFlowToken || input.flowParam === input.greenLevelFlowToken;

  if (definitiveRegularOrGl) {
    // Still wait for pending WO list when URL pins a WO — but never block on SO type fetch.
    if (input.woIdFromUrlValid && !input.initialRefreshDone) return true;
    return false;
  }

  if (input.focusSoIdValid && !input.soOrderTypeKnown) {
    return true;
  }

  if (input.woIdFromUrlValid) {
    if (!input.initialRefreshDone) return true;
    if (input.woIsGreenLevel) return false;
    if (input.woSalesOrderId != null && input.woSalesOrderId > 0 && !input.woSoOrderTypeKnown) {
      return true;
    }
  }

  return false;
}

export type ProductionScopedUrlTarget = {
  workOrderId: number;
  workOrderLineId: number;
  flow: string;
};

/** True when the current URL already carries the same WO/line/flow — skip redundant navigate(replace). */
export function productionScopedUrlAlreadyMatches(
  search: string | URLSearchParams,
  target: ProductionScopedUrlTarget,
): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
  const wo = Number(params.get("workOrderId") ?? params.get("woId") ?? 0);
  const wol = Number(params.get("workOrderLineId") ?? 0);
  const flow = String(params.get("flow") ?? "").trim();
  return (
    wo === target.workOrderId &&
    wol === target.workOrderLineId &&
    flow === target.flow
  );
}

/** Build REGULAR production search string without cloning unrelated volatile params. */
export function buildRegularExecutableProductionSearch(target: {
  workOrderId: number;
  workOrderLineId: number;
  flow: string;
  salesOrderId?: number;
  from?: string | null;
  returnTo?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("workOrderId", String(target.workOrderId));
  params.set("workOrderLineId", String(target.workOrderLineId));
  params.set("flow", target.flow);
  if (target.salesOrderId != null && target.salesOrderId > 0) {
    params.set("salesOrderId", String(target.salesOrderId));
  }
  if (target.from) params.set("from", target.from);
  if (target.returnTo) params.set("returnTo", target.returnTo);
  return params.toString();
}

/**
 * Extra RM capacity beyond the WO plan (display). Lifetime RM-supported max minus planned qty.
 * Does not change Target Remaining (plan − produced).
 */
export function resolveExtraRmCapacityQty(
  rmSupportedFgMaximum: number | null | undefined,
  plannedQty: number | null | undefined,
): number {
  const rmMax = Number(rmSupportedFgMaximum ?? 0);
  const planned = Number(plannedQty ?? 0);
  if (!(rmMax > 0) || !(planned >= 0)) return 0;
  return Math.max(0, rmMax - planned);
}

/** Fill target for "Use Remaining Qty" — WO plan balance only, never the full RM surplus. */
export function resolveUseRemainingQtyFill(
  targetRemainingQty: number | null | undefined,
  rmEntryQtyCap: number | null | undefined,
): number {
  const rem = Math.max(0, Number(targetRemainingQty ?? 0));
  if (rmEntryQtyCap != null && Number.isFinite(Number(rmEntryQtyCap))) {
    return Math.min(rem, Math.max(0, Number(rmEntryQtyCap)));
  }
  return rem;
}
