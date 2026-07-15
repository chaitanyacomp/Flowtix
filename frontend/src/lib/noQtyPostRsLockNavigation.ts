/**
 * Post–Requirement Sheet lock navigation for NO_QTY (SSOT with FT-PD-022).
 *
 * Case 1 — no dispatchable FG: return to agreement summary (do not open Dispatch).
 * Case 2 — dispatchable FG: open contextual Dispatch (source=no_qty_so + SO + cycle).
 */

import { buildNoQtyGuidedHref } from "./noQtyFlowState";
import { noQtyAgreementListHref } from "./noQtyStoreNavigation";

const EPS = 1e-6;

export type NoQtyPostRsLockNavKind =
  | "SO_SUMMARY"
  | "DISPATCH_CONTEXTUAL"
  | "DASHBOARD"
  | "STAY";

export type NoQtyPostRsLockNavInput = {
  salesOrderId: number;
  cycleId?: number | null;
  requirementSheetId?: number | null;
  /** Lock API: zero-fulfillment recovery cycle that closed without production. */
  decisionOnlyRecoveryCycle?: boolean;
  /** Refreshed flow-state after lock (authoritative dispatch readiness). */
  dispatchableQty?: number | null;
  hasQcDispatchPending?: boolean | null;
  primaryAction?: string | null;
  viewerRole?: string | null;
  /** True when sheet lines have no remaining production required. */
  isZeroPlanning?: boolean;
};

export type NoQtyPostRsLockNavResult = {
  kind: NoQtyPostRsLockNavKind;
  href: string | null;
};

export function hasNoQtyDispatchableAfterLock(input: {
  dispatchableQty?: number | null;
  hasQcDispatchPending?: boolean | null;
  primaryAction?: string | null;
}): boolean {
  if (Number(input.dispatchableQty ?? 0) > EPS) return true;
  if (Boolean(input.hasQcDispatchPending)) return true;
  return String(input.primaryAction ?? "").toUpperCase() === "DISPATCH";
}

/**
 * Resolve where the operator should land after locking a NO_QTY Requirement Sheet.
 * REGULAR / non–zero-planning Store→dashboard / Admin stay behaviour preserved.
 */
export function resolveNoQtyPostRsLockNavigation(input: NoQtyPostRsLockNavInput): NoQtyPostRsLockNavResult {
  const soId = Number(input.salesOrderId);
  if (!(Number.isFinite(soId) && soId > 0)) {
    return { kind: "STAY", href: null };
  }

  const dispatchable = hasNoQtyDispatchableAfterLock(input);

  if (dispatchable) {
    return {
      kind: "DISPATCH_CONTEXTUAL",
      href: buildNoQtyGuidedHref({
        to: "/dispatch",
        salesOrderId: soId,
        cycleId: input.cycleId ?? null,
        requirementSheetId: input.requirementSheetId ?? null,
        fromStep: "requirement",
      }),
    };
  }

  // Case 1: decision-only recovery or zero-planning with nothing left to ship.
  if (input.decisionOnlyRecoveryCycle || input.isZeroPlanning) {
    return {
      kind: "SO_SUMMARY",
      href: noQtyAgreementListHref(input.viewerRole, soId),
    };
  }

  if (String(input.viewerRole ?? "").toUpperCase() === "STORE") {
    return { kind: "DASHBOARD", href: "/dashboard" };
  }

  return { kind: "STAY", href: null };
}
