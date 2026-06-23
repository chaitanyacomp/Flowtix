/**
 * Phase 5 — Read-only MPRS Requirement Composition.
 *
 * Display:
 *   RS Requirement = SUM(scheduleQty) across locked RS
 *   Carry Forward  = SUM(carryForwardQty) across locked RS (audit visibility only)
 *
 * Suggested Production = Effective RS production demand + Green Level Shortage
 *   Effective RS demand = latest locked RS production target per sales order, summed across SOs
 *   (NO_QTY carry-forward is already embedded in later cycles — not added again)
 *
 * Composes existing Phase 2 + Phase 4B services only. Never writes operational data.
 */

const { getRsSuggestionsForPeriod } = require("./monthlyPlanningRsSuggestionsService");
const { getGreenLevels } = require("./monthlyPlanningGreenLevelService");
const { normalizePeriodKey, MonthlyPlanningError } = require("./monthlyPlanningPeriodUtils");

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
 * @param {number} effectiveRsDemand Latest-cycle production need per SO, summed (see Phase 2 bridge)
 * @param {number} greenShortage
 */
function computeSuggestedProduction(effectiveRsDemand, greenShortage) {
  return round3(n(effectiveRsDemand) + n(greenShortage));
}

function resolveEffectiveRsDemand(rsItem) {
  if (rsItem?.effectiveProductionDemandQty != null) {
    return round3(n(rsItem.effectiveProductionDemandQty));
  }
  return round3(n(rsItem?.scheduleQty ?? 0) + n(rsItem?.carryForwardQty ?? 0));
}

/**
 * @param {{
 *   db?: object;
 *   periodKey: string;
 *   loadRsSuggestions?: typeof getRsSuggestionsForPeriod;
 *   loadGreenLevels?: typeof getGreenLevels;
 * }} opts
 */
async function getRequirementComposition({
  db,
  periodKey,
  loadRsSuggestions = getRsSuggestionsForPeriod,
  loadGreenLevels = getGreenLevels,
} = {}) {
  const normalized = normalizePeriodKey(periodKey);
  const dbArg = db ? { db, periodKey: normalized } : { periodKey: normalized };

  const [rs, green] = await Promise.all([loadRsSuggestions(dbArg), loadGreenLevels(dbArg)]);

  const rsByItem = new Map((rs.items || []).map((item) => [item.itemId, item]));
  const greenByItem = new Map((green.items || []).map((item) => [item.itemId, item]));
  const itemIds = new Set([...rsByItem.keys(), ...greenByItem.keys()]);

  const items = [];
  for (const itemId of itemIds) {
    const rsItem = rsByItem.get(itemId);
    const greenItem = greenByItem.get(itemId);
    const rsRequirement = round3(n(rsItem?.scheduleQty ?? 0));
    const carryForward = round3(n(rsItem?.carryForwardQty ?? 0));
    const greenShortage = round3(n(greenItem?.shortageForGreenTarget ?? 0));
    const effectiveRsDemand = resolveEffectiveRsDemand(rsItem);
    const suggestedProduction = computeSuggestedProduction(effectiveRsDemand, greenShortage);

    if (!(rsRequirement > 0 || carryForward > 0 || greenShortage > 0)) continue;

    items.push({
      itemId,
      itemName: rsItem?.itemName ?? greenItem?.itemName ?? null,
      unit: rsItem?.unit ?? greenItem?.unit ?? null,
      rsRequirement,
      carryForward,
      greenShortage,
      suggestedProduction,
      productionRequirementQty: effectiveRsDemand,
      greenTarget: round3(n(greenItem?.greenQty ?? 0)),
      freeFgStock: round3(n(greenItem?.freeFgStock ?? 0)),
      status: greenItem?.status ?? null,
    });
  }

  items.sort((a, b) => String(a.itemName ?? "").localeCompare(String(b.itemName ?? "")));

  return {
    periodKey: normalized,
    anchorPeriodKey: green.anchorPeriodKey ?? normalized,
    sheetCount: rs.sheetCount ?? 0,
    itemCount: items.length,
    items,
  };
}

module.exports = {
  computeSuggestedProduction,
  resolveEffectiveRsDemand,
  getRequirementComposition,
  MonthlyPlanningError,
};
