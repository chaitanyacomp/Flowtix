/**
 * Upward RM issue rounding for Kg RM items only.
 * One rounded target from total planned requirement; partial issues consume that target
 * without re-rounding each time.
 *
 * Does not apply to Gm/Nos/other units, consumption, returns, wastage, adjustments, GRN.
 */

const { weightUnitKind } = require("./bomWeightPlanning");

const EPS = 1e-9;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round6(v) {
  return Math.round(n(v) * 1e6) / 1e6;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

/** Canonical unit token from Item.unitRef or legacy unit string. */
function unitTokenFromItem(item) {
  if (!item) return "";
  const ref = item.unitRef ?? item.unit;
  if (ref && typeof ref === "object") {
    return ref.unitCode || ref.unitName || item.unit || "";
  }
  return item.unit || ref || "";
}

function isKilogramUnit(unitOrItem) {
  if (unitOrItem && typeof unitOrItem === "object" && (unitOrItem.unitRef || unitOrItem.unit != null || unitOrItem.itemType)) {
    return weightUnitKind(unitTokenFromItem(unitOrItem)) === "kilogram";
  }
  return weightUnitKind(unitOrItem) === "kilogram";
}

function isRmItem(item) {
  return String(item?.itemType ?? "").toUpperCase() === "RM";
}

/**
 * Whether Kg upward rounding applies for this item.
 * Requires RM + Kg UOM + positive issueIncrement.
 */
function kgIssueRoundingApplies(item, opts = {}) {
  if (!isRmItem(item)) return false;
  if (!isKilogramUnit(item)) return false;
  const increment = n(opts.issueIncrement ?? item.issueIncrement);
  return increment > EPS;
}

/**
 * roundedTargetQty = ceil(plannedRequiredQty / issueIncrement) × issueIncrement
 */
function computeRoundedIssueTargetQty(plannedRequiredQty, issueIncrement) {
  const planned = Math.max(0, n(plannedRequiredQty));
  const increment = n(issueIncrement);
  if (increment <= EPS) return round6(planned);
  if (planned <= EPS) return 0;
  const steps = Math.ceil(planned / increment - EPS);
  return round6(steps * increment);
}

/**
 * Authoritative Kg issue plan from total planned requirement (not per-partial re-round).
 */
function computeKgIssueRoundingPlan({
  plannedRequiredQty,
  issueIncrement,
  cumulativeNetIssuedQty = 0,
  waivedQty = 0,
  availableQty = null,
}) {
  const planned = Math.max(0, n(plannedRequiredQty));
  const increment = n(issueIncrement);
  const issued = Math.max(0, n(cumulativeNetIssuedQty));
  const waived = Math.max(0, n(waivedQty));
  const roundedTargetQty = computeRoundedIssueTargetQty(planned, increment);
  const roundingExcessQty = round6(Math.max(0, roundedTargetQty - planned));
  const remainingIssueQty = round6(Math.max(0, roundedTargetQty - issued - waived));
  let suggestedIssueQty = remainingIssueQty;
  let cappedByStock = false;
  if (availableQty != null && Number.isFinite(Number(availableQty))) {
    const free = Math.max(0, n(availableQty));
    if (suggestedIssueQty > free + EPS) {
      suggestedIssueQty = round6(free);
      cappedByStock = true;
    }
  }
  return {
    applies: increment > EPS,
    issueIncrement: increment > EPS ? round6(increment) : null,
    plannedRequiredQty: round6(planned),
    roundedIssueTargetQty: roundedTargetQty,
    roundingExcessQty,
    alreadyIssuedQty: round6(issued),
    waivedQty: round6(waived),
    remainingIssueQty,
    suggestedIssueQty,
    cappedByStock,
  };
}

/**
 * Resolve plan for a PMR line using snapshots when present, else live Item fields.
 */
function resolvePmrLineIssueRounding({
  line,
  item,
  availableQty = null,
}) {
  const planned = n(line?.requiredQty);
  const issued = n(line?.issuedQty);
  const waived = n(line?.waivedQty);
  const snapshotInc = line?.issueIncrementSnapshot != null ? n(line.issueIncrementSnapshot) : null;
  const liveInc = item?.issueIncrement != null ? n(item.issueIncrement) : null;
  const increment = snapshotInc != null && snapshotInc > EPS ? snapshotInc : liveInc;
  const kgItem = item ? kgIssueRoundingApplies({ ...item, issueIncrement: increment }, { issueIncrement: increment }) : false;

  if (!kgItem || !(increment > EPS)) {
    const remaining = round6(Math.max(0, planned - issued - waived));
    let suggested = remaining;
    let cappedByStock = false;
    if (availableQty != null && Number.isFinite(Number(availableQty))) {
      const free = Math.max(0, n(availableQty));
      if (suggested > free + EPS) {
        suggested = round6(free);
        cappedByStock = true;
      }
    }
    return {
      applies: false,
      issueIncrement: null,
      plannedRequiredQty: round6(planned),
      roundedIssueTargetQty: round6(planned),
      roundingExcessQty: 0,
      alreadyIssuedQty: round6(issued),
      waivedQty: round6(waived),
      remainingIssueQty: remaining,
      suggestedIssueQty: suggested,
      cappedByStock,
      /** Cap for API — exact pending */
      issueCeilingQty: remaining,
    };
  }

  const snapshotTarget =
    line?.roundedIssueTargetQty != null && n(line.roundedIssueTargetQty) > EPS
      ? n(line.roundedIssueTargetQty)
      : null;
  const plan = computeKgIssueRoundingPlan({
    plannedRequiredQty: planned,
    issueIncrement: increment,
    cumulativeNetIssuedQty: issued,
    waivedQty: waived,
    availableQty,
  });
  if (snapshotTarget != null) {
    const remaining = round6(Math.max(0, snapshotTarget - issued - waived));
    let suggested = remaining;
    let cappedByStock = false;
    if (availableQty != null && Number.isFinite(Number(availableQty))) {
      const free = Math.max(0, n(availableQty));
      if (suggested > free + EPS) {
        suggested = round6(free);
        cappedByStock = true;
      }
    }
    return {
      ...plan,
      roundedIssueTargetQty: round6(snapshotTarget),
      roundingExcessQty: round6(Math.max(0, snapshotTarget - planned)),
      remainingIssueQty: remaining,
      suggestedIssueQty: suggested,
      cappedByStock,
      issueCeilingQty: remaining,
    };
  }
  return { ...plan, issueCeilingQty: plan.remainingIssueQty };
}

/**
 * Assert issue qty does not exceed Kg rounded target remaining (API cannot bypass).
 */
function assertIssueWithinRoundingTarget({ issueQty, plan, itemId }) {
  const qty = n(issueQty);
  if (!(qty > EPS)) return;
  if (!plan?.applies) return;
  const ceiling = n(plan.issueCeilingQty ?? plan.remainingIssueQty);
  if (qty > ceiling + EPS) {
    const err = new Error(
      `Issue qty exceeds rounded issue target remaining for item #${itemId}. Remaining target: ${round3(ceiling)}, requested: ${round3(qty)}.`,
    );
    err.statusCode = 409;
    err.code = "PMR_ROUNDED_ISSUE_TARGET_EXCEEDED";
    throw err;
  }
}

/** Normalize issueIncrement for Item Master save (RM + Kg only). */
function normalizeIssueIncrementForItemSave({ itemType, unitToken, issueIncrement }) {
  const isRm = String(itemType ?? "").toUpperCase() === "RM";
  const isKg = weightUnitKind(unitToken) === "kilogram";
  if (!isRm || !isKg) return null;
  if (issueIncrement === undefined) return undefined;
  if (issueIncrement === null || issueIncrement === "") return null;
  const v = n(issueIncrement);
  if (!(v > EPS)) {
    const err = new Error("Issue Increment (Kg) must be greater than 0.");
    err.statusCode = 400;
    throw err;
  }
  return round6(v);
}

module.exports = {
  EPS,
  n,
  round3,
  round6,
  unitTokenFromItem,
  isKilogramUnit,
  isRmItem,
  kgIssueRoundingApplies,
  computeRoundedIssueTargetQty,
  computeKgIssueRoundingPlan,
  resolvePmrLineIssueRounding,
  assertIssueWithinRoundingTarget,
  normalizeIssueIncrementForItemSave,
  weightUnitKind,
};
