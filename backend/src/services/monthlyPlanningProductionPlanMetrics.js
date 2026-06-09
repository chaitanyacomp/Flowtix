/**
 * Phase 8A — Production Plan variance & green-gap visibility (display only).
 * Does not alter lock, release, procurement, green level, or stock calculations.
 */

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * @param {number} plannedQty
 * @param {number} suggestedQty
 */
function computeVarianceQty(plannedQty, suggestedQty) {
  return round3(n(plannedQty) - n(suggestedQty));
}

/**
 * @param {number} varianceQty
 * @param {number} suggestedQty
 */
function computeVariancePct(varianceQty, suggestedQty) {
  const suggested = n(suggestedQty);
  if (!(suggested > 0)) return 0;
  return round3((n(varianceQty) / suggested) * 100);
}

/**
 * @param {number} greenTarget
 * @param {number} freeFgStock
 * @param {number} plannedQty
 */
function computeRemainingGreenGap(greenTarget, freeFgStock, plannedQty) {
  const projected = round3(n(freeFgStock) + n(plannedQty));
  return round3(Math.max(0, n(greenTarget) - projected));
}

/**
 * @param {Array<{ plannedFgQty?: number; suggestedFgQty?: number; varianceQty?: number }>} lines
 */
function computeLockSummary(lines) {
  const safe = Array.isArray(lines) ? lines : [];
  let totalSuggestedQty = 0;
  let totalPlannedQty = 0;
  let fgItemsWithVariance = 0;

  for (const line of safe) {
    const suggested = round3(n(line.suggestedFgQty));
    const planned = round3(n(line.plannedFgQty));
    const variance =
      line.varianceQty != null ? round3(n(line.varianceQty)) : computeVarianceQty(planned, suggested);
    totalSuggestedQty = round3(totalSuggestedQty + suggested);
    totalPlannedQty = round3(totalPlannedQty + planned);
    if (Math.abs(variance) > 1e-9) fgItemsWithVariance += 1;
  }

  return {
    fgItemsWithVariance,
    totalSuggestedQty,
    totalPlannedQty,
    totalVarianceQty: round3(totalPlannedQty - totalSuggestedQty),
  };
}

/**
 * @param {{
 *   plannedFgQty: number;
 *   suggestedFgQty: number;
 *   greenTarget?: number;
 *   freeFgStock?: number;
 * }} input
 */
function enrichProductionLineMetrics(input) {
  const suggestedFgQty = round3(n(input.suggestedFgQty));
  const plannedFgQty = round3(n(input.plannedFgQty));
  const varianceQty = computeVarianceQty(plannedFgQty, suggestedFgQty);
  const variancePct = computeVariancePct(varianceQty, suggestedFgQty);
  const greenTarget = round3(n(input.greenTarget ?? 0));
  const freeFgStock = round3(n(input.freeFgStock ?? 0));
  const remainingGreenGap = computeRemainingGreenGap(greenTarget, freeFgStock, plannedFgQty);
  const projectedStockAfterPlan = round3(freeFgStock + plannedFgQty);

  return {
    suggestedFgQty,
    plannedFgQty,
    varianceQty,
    variancePct,
    greenTarget,
    freeFgStock,
    projectedStockAfterPlan,
    remainingGreenGap,
  };
}

/**
 * Build maps from Phase 5 composition and green levels for line enrichment.
 * @param {{ items?: Array<{ itemId: number; suggestedProduction?: number }> }} composition
 * @param {{ items?: Array<{ itemId: number; greenQty?: number; freeFgStock?: number }> }} greenLevels
 */
function buildPlanningContextMaps(composition, greenLevels) {
  const suggestedByFgItemId = new Map();
  for (const item of composition?.items || []) {
    suggestedByFgItemId.set(item.itemId, round3(n(item.suggestedProduction)));
  }

  const greenByFgItemId = new Map();
  for (const item of greenLevels?.items || []) {
    greenByFgItemId.set(item.itemId, {
      greenTarget: round3(n(item.greenQty)),
      freeFgStock: round3(n(item.freeFgStock)),
    });
  }

  return { suggestedByFgItemId, greenByFgItemId };
}

module.exports = {
  computeVarianceQty,
  computeVariancePct,
  computeRemainingGreenGap,
  computeLockSummary,
  enrichProductionLineMetrics,
  buildPlanningContextMaps,
  round3,
};
