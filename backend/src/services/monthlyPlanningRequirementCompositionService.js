/**
 * Phase 5 — Read-only MPRS Requirement Composition.
 *
 * Suggested Production = RS Requirement (scheduleQty)
 *                      + Carry Forward (carryForwardQty)
 *                      + Green Level Shortage (shortageForGreenTarget)
 *
 * Composes existing Phase 2 + Phase 4B services only. Never writes operational data.
 */

const { getRsSuggestionsForPeriod } = require("./monthlyPlanningRsSuggestionsService");
const { getGreenLevels } = require("./monthlyPlanningGreenLevelService");
const { normalizePeriodKey, MonthlyPlanningError } = require("./monthlyPlanningService");

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
 * @param {number} rsRequirement
 * @param {number} carryForward
 * @param {number} greenShortage
 */
function computeSuggestedProduction(rsRequirement, carryForward, greenShortage) {
  return round3(n(rsRequirement) + n(carryForward) + n(greenShortage));
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
    const suggestedProduction = computeSuggestedProduction(rsRequirement, carryForward, greenShortage);

    if (!(rsRequirement > 0 || carryForward > 0 || greenShortage > 0)) continue;

    items.push({
      itemId,
      itemName: rsItem?.itemName ?? greenItem?.itemName ?? null,
      unit: rsItem?.unit ?? greenItem?.unit ?? null,
      rsRequirement,
      carryForward,
      greenShortage,
      suggestedProduction,
      productionRequirementQty: round3(n(rsItem?.productionRequirementQty ?? 0)),
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
  getRequirementComposition,
  MonthlyPlanningError,
};
