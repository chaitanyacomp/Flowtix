/**
 * Production entry capacity phase from authoritative RM readiness quantities.
 * Distinguishes "Waiting RM" (more production needed/allowed but no issued capacity)
 * from "quantity completed" (target remaining and extra RM capacity are both exhausted).
 * Does not change production math or NO_QTY recovery rules.
 */

const EPS = 1e-6;

export type ProductionEntryCapacityPhase =
  | "WAITING_RM"
  | "ENTRY_ALLOWED"
  | "QUANTITY_COMPLETED";

export type ProductionEntryCapacityInput = {
  gate?: string | null;
  bomMissing?: boolean | null;
  productionAllowedNowQty?: number | null;
  maxAdditionalQty?: number | null;
  woQty?: number | null;
  woRemainingQty?: number | null;
  approvedProducedQty?: number | null;
  rmSupportedCumulativeCapacityQty?: number | null;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

export function resolveProductionTargetRemainingQty(input: ProductionEntryCapacityInput): number {
  if (input.woRemainingQty != null && Number.isFinite(Number(input.woRemainingQty))) {
    return n(input.woRemainingQty);
  }
  return Math.max(0, n(input.woQty) - n(input.approvedProducedQty));
}

export function resolveProductionExtraRmCapacityQty(input: ProductionEntryCapacityInput): number {
  const planned = n(input.woQty);
  const allowedNow = n(input.productionAllowedNowQty);
  const produced = n(input.approvedProducedQty);
  const cumulative =
    input.rmSupportedCumulativeCapacityQty != null &&
    Number.isFinite(Number(input.rmSupportedCumulativeCapacityQty))
      ? n(input.rmSupportedCumulativeCapacityQty)
      : produced + allowedNow;
  return Math.max(0, cumulative - planned);
}

/**
 * Current entry capacity available for a new batch (prefer maxAdditionalQty when present).
 */
export function resolveProductionEntryCapacityNowQty(input: ProductionEntryCapacityInput): number {
  if (input.maxAdditionalQty != null && Number.isFinite(Number(input.maxAdditionalQty))) {
    return n(input.maxAdditionalQty);
  }
  return n(input.productionAllowedNowQty);
}

export function resolveProductionEntryCapacityPhase(
  input: ProductionEntryCapacityInput | null | undefined,
): ProductionEntryCapacityPhase {
  if (!input) return "WAITING_RM";
  if (input.bomMissing) return "WAITING_RM";

  const gate = String(input.gate ?? "");
  if (
    gate === "NO_PMR" ||
    gate === "PMR_DRAFT_ONLY" ||
    gate === "WAITING_STORE_ISSUE" ||
    gate === "WAITING_RELEASE_TO_PRODUCTION"
  ) {
    return "WAITING_RM";
  }

  const entryCapacityNow = resolveProductionEntryCapacityNowQty(input);
  if (entryCapacityNow > EPS) return "ENTRY_ALLOWED";

  const targetRemaining = resolveProductionTargetRemainingQty(input);
  const extraRmCapacity = resolveProductionExtraRmCapacityQty(input);
  const planned = n(input.woQty);
  const produced = n(input.approvedProducedQty);

  // Target and extra RM capacity exhausted — not a Waiting-RM condition.
  if (targetRemaining <= EPS && extraRmCapacity <= EPS && (planned > EPS || produced > EPS)) {
    return "QUANTITY_COMPLETED";
  }

  // More production is still required/allowed vs plan, but issued RM cannot support it.
  if (targetRemaining > EPS || extraRmCapacity > EPS) {
    return "WAITING_RM";
  }

  // No authoritative plan/produced quantities yet — defer to open gate (blocked gates already returned).
  return "ENTRY_ALLOWED";
}

export const PRODUCTION_QUANTITY_COMPLETED_MESSAGE =
  "Production quantity completed — no further production entry allowed.";
