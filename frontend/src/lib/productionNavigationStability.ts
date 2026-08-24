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

/**
 * Production Workspace list must never auto-open a WO.
 * Auto-pick + overview clear caused: list → applyLine → overview clears → auto-pick → loop.
 */
export function shouldAutoOpenExecutableFromProductionWorkspaceList(): boolean {
  return false;
}

/** Canonical list vs scoped WO production-entry states. */
export type ProductionWorkspaceNavState = "workspace_list" | "scoped_wo_entry";

export function resolveProductionWorkspaceNavState(input: {
  workOrderIdInUrl: number;
  workOrderLineIdInUrl: number;
  selectedWorkOrderId: number;
  selectedWorkOrderLineId: number;
}): ProductionWorkspaceNavState {
  const urlScoped =
    (Number.isFinite(input.workOrderIdInUrl) && input.workOrderIdInUrl > 0) ||
    (Number.isFinite(input.workOrderLineIdInUrl) && input.workOrderLineIdInUrl > 0);
  const stateScoped =
    (Number.isFinite(input.selectedWorkOrderId) && input.selectedWorkOrderId > 0) ||
    (Number.isFinite(input.selectedWorkOrderLineId) && input.selectedWorkOrderLineId > 0);
  return urlScoped || stateScoped ? "scoped_wo_entry" : "workspace_list";
}

export type ProductionScopedBackArgs = {
  fromParam: string;
  sourceParam: string;
  fromStepParam?: string;
  returnToParam?: string;
  salesOrderId: number;
  workOrderId?: number;
  productionBucket?: string | null;
  hasActiveDraft?: boolean;
};

/**
 * Back from a scoped WO production screen.
 * Pending-actions origin returns to the workspace list (not Pending Actions) so Back
 * never reopens the WO via PA deep-link, and never jumps past the list.
 */
export function resolveProductionRegularBack(args: ProductionScopedBackArgs): {
  label: string;
  to: string;
} {
  const from = args.fromParam.trim().toLowerCase();
  const src = args.sourceParam.trim().toLowerCase();
  const returnTo = String(args.returnToParam ?? "").trim().toLowerCase();
  const fromStep = (args.fromStepParam ?? "").trim().toLowerCase();
  const sid = args.salesOrderId;
  const woId = Number(args.workOrderId ?? 0);
  const soQs = sid > 0 ? `?salesOrderId=${encodeURIComponent(String(sid))}` : "";
  if (from === "dashboard" || src === "dashboard") return { label: "Dashboard", to: "/dashboard" };

  if (from === "production-workspace" || src === "production-workspace") {
    return {
      label: "Back to Production Workspace",
      to: buildProductionWorkspaceListBackHref({
        productionBucket: args.productionBucket,
        hasActiveDraft: args.hasActiveDraft,
        // Highlight only — never pin workOrderId / reopen process.
        pwFocus: woId > 0 ? woId : null,
        from: "production-workspace",
      }),
    };
  }

  if (from === "dispatch" || src === "dispatch" || fromStep === "dispatch") {
    return {
      label: "Back to Dispatch",
      to: sid > 0 ? `/dispatch?salesOrderId=${encodeURIComponent(String(sid))}` : "/dispatch",
    };
  }

  // Explicit Back from WO entry while PA-origin: land on workspace list, keep PA return crumb.
  if (from === "pending-actions" || src === "pending-actions" || returnTo === "pending-actions") {
    if (woId > 0) {
      return {
        label: "Back to Production Workspace",
        to: buildProductionWorkspaceListBackHref({
          productionBucket: args.productionBucket ?? "readyToStart",
          hasActiveDraft: args.hasActiveDraft,
          pwFocus: woId,
          from: "pending-actions",
          returnTo: "pending-actions",
        }),
      };
    }
    return { label: "Back to Pending Actions", to: "/pending-actions" };
  }

  if (from === "work-order-workspace" || from === "work-orders" || from === "wo-list") {
    const qs = new URLSearchParams();
    if (woId > 0) qs.set("workOrderId", String(woId));
    const q = qs.toString();
    return { label: "Back to Work Orders", to: q ? `/work-orders?${q}` : "/work-orders" };
  }
  if (from === "sales-orders" || from === "sales-order")
    return { label: "Sales Orders", to: sid > 0 ? `/sales-orders${soQs}` : "/sales-orders" };
  if (from === "rm-check" || from === "prepare-wo")
    return {
      label: "Prepare Work Order",
      to: sid > 0 ? `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(sid))}` : "/work-orders/prepare",
    };

  return {
    label: "Back to Production Workspace",
    to: buildProductionWorkspaceListBackHref({ productionBucket: args.productionBucket }),
  };
}

/** Clean workspace list href — strips WO/line/SO deep-link pins. */
export function buildProductionWorkspaceListBackHref(opts?: {
  productionBucket?: string | null;
  hasActiveDraft?: boolean;
  pwFocus?: number | null;
  from?: string | null;
  returnTo?: string | null;
}): string {
  const qs = new URLSearchParams();
  if (opts?.hasActiveDraft) {
    qs.set("pwSection", "draftPending");
  } else if (opts?.productionBucket === "readyToStart" || opts?.productionBucket === "inProgress") {
    qs.set("productionBucket", opts.productionBucket);
    qs.set("pwSection", opts.productionBucket === "readyToStart" ? "ready" : "active");
  }
  const focus = Number(opts?.pwFocus ?? 0);
  if (Number.isFinite(focus) && focus > 0) qs.set("pwFocus", String(focus));
  const from = String(opts?.from ?? "").trim();
  const returnTo = String(opts?.returnTo ?? "").trim();
  if (from) qs.set("from", from);
  if (returnTo) qs.set("returnTo", returnTo);
  else if (from === "pending-actions") qs.set("returnTo", "pending-actions");
  const q = qs.toString();
  return q ? `/production?${q}` : "/production";
}

/**
 * Detect A↔B replace oscillation (route-level protection).
 * Returns true when the next candidate would bounce back to the previous path.
 */
export function detectProductionNavOscillation(
  history: string[],
  nextHref: string,
  maxPairs = 2,
): boolean {
  const next = normalizeProductionNavHref(nextHref);
  if (history.length < 2) return false;
  const a = normalizeProductionNavHref(history[history.length - 2]!);
  const b = normalizeProductionNavHref(history[history.length - 1]!);
  if (a === b) return false;
  // … A, B, and next===A → first bounce; after maxPairs of A,B,A,B stop.
  if (next !== a) return false;
  let pairs = 0;
  for (let i = history.length - 1; i >= 1; i -= 2) {
    const cur = normalizeProductionNavHref(history[i]!);
    const prev = normalizeProductionNavHref(history[i - 1]!);
    if (cur === b && prev === a) pairs += 1;
    else break;
  }
  return pairs >= maxPairs && next === a;
}

export function normalizeProductionNavHref(href: string): string {
  try {
    const url = new URL(href, "http://erp.local");
    const qs = new URLSearchParams(url.search);
    // Ignore highlight-only / notice noise for oscillation compare.
    qs.delete("pwFocus");
    qs.delete("pwNotice");
    const keys = [...qs.keys()].sort();
    const stable = new URLSearchParams();
    for (const k of keys) {
      const v = qs.get(k);
      if (v != null) stable.set(k, v);
    }
    const q = stable.toString();
    return `${url.pathname}${q ? `?${q}` : ""}`;
  } catch {
    return href;
  }
}

export function appendProductionNavHistory(history: string[], href: string, limit = 6): string[] {
  const next = [...history, normalizeProductionNavHref(href)];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** UI gate: machine-run planning WOs block entry until a confirmed run is selected. */
export function isProductionEntryBlockedByRunStartGate(input: {
  mode: "LEGACY" | "MACHINE_RUN_PLANNING" | null | undefined;
  confirmedRunCount: number;
  loading?: boolean;
  selectedRunAllocationId?: number | null;
}): boolean {
  if (input.loading) return true;
  if (input.mode !== "MACHINE_RUN_PLANNING") return false;
  if (!(Number(input.confirmedRunCount) > 0)) return true;
  const selected = Number(input.selectedRunAllocationId ?? 0);
  if (input.selectedRunAllocationId !== undefined) {
    return !(Number.isFinite(selected) && selected > 0);
  }
  return false;
}

/** Concise lock copy shown above the production entry form before run start confirmation. */
export const PRODUCTION_ENTRY_AWAIT_RUN_CONFIRM_MESSAGE =
  "Confirm a machine run before recording production.";

/**
 * Suppress redundant “record / continue production” primary strips when the operator
 * is already on the scoped WO entry screen (Confirm start is the only primary action).
 */
export function shouldSuppressRecordProductionPrimaryStrip(input: {
  alreadyInScopedEntry: boolean;
  runStartEntryBlocked?: boolean;
}): boolean {
  if (input.runStartEntryBlocked) return true;
  return Boolean(input.alreadyInScopedEntry);
}

/** Hide redundant Enter Production CTA when already on the WO entry screen. */
export function shouldHideEnterProductionCtaInEntryWorkspace(input: {
  alreadyInScopedEntry: boolean;
  runStartEntryBlocked?: boolean;
}): boolean {
  return shouldSuppressRecordProductionPrimaryStrip(input);
}

/** Ignore stale async payloads after the user left a WO (generation mismatch). */
export function isStaleProductionNavigationGeneration(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration !== currentGeneration;
}
