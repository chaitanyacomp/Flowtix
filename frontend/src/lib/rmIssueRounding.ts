/**
 * Kg RM upward issue rounding (display math). Backend remains authoritative.
 * Formula: ceil(plannedRequiredQty / issueIncrement) × issueIncrement
 */

const EPS = 1e-9;

export function weightUnitKind(unit: unknown): "gram" | "kilogram" | "other" {
  const s = String(
    (unit as { unitCode?: string; unitName?: string } | null)?.unitCode ??
      (unit as { unitName?: string } | null)?.unitName ??
      unit ??
      "",
  )
    .trim()
    .toLowerCase();
  if (s === "g" || s === "gm" || s === "gram" || s === "grams") return "gram";
  if (s === "kg" || s === "kilogram" || s === "kilograms") return "kilogram";
  return "other";
}

export function isKilogramUnitToken(unit: unknown): boolean {
  return weightUnitKind(unit) === "kilogram";
}

export function computeRoundedIssueTargetQty(
  plannedRequiredQty: number,
  issueIncrement: number,
): number {
  const planned = Math.max(0, Number(plannedRequiredQty) || 0);
  const increment = Number(issueIncrement) || 0;
  if (!(increment > EPS)) return Math.round(planned * 1e6) / 1e6;
  if (planned <= EPS) return 0;
  const steps = Math.ceil(planned / increment - EPS);
  return Math.round(steps * increment * 1e6) / 1e6;
}

export function computeKgIssueRoundingPlan(input: {
  plannedRequiredQty: number;
  issueIncrement: number;
  cumulativeNetIssuedQty?: number;
  waivedQty?: number;
  availableQty?: number | null;
}) {
  const planned = Math.max(0, Number(input.plannedRequiredQty) || 0);
  const increment = Number(input.issueIncrement) || 0;
  const issued = Math.max(0, Number(input.cumulativeNetIssuedQty) || 0);
  const waived = Math.max(0, Number(input.waivedQty) || 0);
  const roundedIssueTargetQty = computeRoundedIssueTargetQty(planned, increment);
  const roundingExcessQty = Math.max(0, roundedIssueTargetQty - planned);
  const remainingIssueQty = Math.max(0, roundedIssueTargetQty - issued - waived);
  let suggestedIssueQty = remainingIssueQty;
  let cappedByStock = false;
  if (input.availableQty != null && Number.isFinite(Number(input.availableQty))) {
    const free = Math.max(0, Number(input.availableQty));
    if (suggestedIssueQty > free + EPS) {
      suggestedIssueQty = free;
      cappedByStock = true;
    }
  }
  return {
    applies: increment > EPS,
    issueIncrement: increment > EPS ? increment : null,
    plannedRequiredQty: planned,
    roundedIssueTargetQty,
    roundingExcessQty,
    alreadyIssuedQty: issued,
    remainingIssueQty,
    suggestedIssueQty,
    cappedByStock,
  };
}

export function showIssueIncrementOnItemMaster(opts: {
  itemType: string;
  unitCode?: string | null;
  unitName?: string | null;
  unit?: string | null;
}): boolean {
  if (String(opts.itemType).toUpperCase() !== "RM") return false;
  return isKilogramUnitToken(opts.unitCode || opts.unitName || opts.unit || "");
}

/** Operator-facing Kg rounding rule (issueIncrement stays technical/internal). */
export const KG_ROUNDING_RULE_TOOLTIP =
  "Calculated RM requirement is always rounded upward to the next whole Kg.";

export function formatKgRoundingRuleLabel(issueIncrement: number | null | undefined): string {
  const inc = Number(issueIncrement);
  if (!Number.isFinite(inc) || !(inc > EPS)) return "—";
  if (Math.abs(inc - 1) <= EPS) return "Next whole Kg";
  return `Next ${inc} Kg`;
}
