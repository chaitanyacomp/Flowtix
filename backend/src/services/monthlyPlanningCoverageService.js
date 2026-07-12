/**
 * Period requirement coverage for Additional Plan preview/create.
 *
 * Authoritative formula (source identity):
 *   Additional Plan Qty = Sum of eligible requirement components not covered
 *   by any previous APPROVED plan document.
 *
 * Components are identified by RS line ID + component type (base demand,
 * production shortfall, finalized QC rejection). Period+FG quantity subtraction
 * alone is not used — Plan 1 covering RS-1 must never offset RS-2 demand.
 */

const { prisma } = require("../utils/prisma");
const { normalizePeriodKey } = require("./monthlyPlanningPeriodUtils");
const {
  getUncoveredRequirementComponents,
  aggregateUncoveredByFgItem,
  emptyComponentBreakdown,
  round3: sourceRound3,
} = require("./monthlyPlanningSourceCoverageService");

function round3(value) {
  return sourceRound3(value);
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * @param {number} currentRequirementQty
 * @param {number} alreadyApprovedQty
 * @deprecated Prefer source-identity uncovered qty. Kept for pure arithmetic helpers/tests.
 */
function computeAdditionalRequirementQty(currentRequirementQty, alreadyApprovedQty) {
  return round3(Math.max(0, n(currentRequirementQty) - n(alreadyApprovedQty)));
}

/**
 * @deprecated Period+FG approved sum — retained for legacy tests only.
 * New coverage uses MonthlyPlanRequirementCoverage source links.
 */
async function sumApprovedPlannedFgByItem(db, periodKey) {
  const lines = await db.monthlyProductionPlanLine.findMany({
    where: {
      plan: {
        periodKey,
        status: "APPROVED",
      },
    },
    select: {
      fgItemId: true,
      plannedFgQty: true,
      customerProductionQty: true,
    },
  });

  const byItem = new Map();
  for (const line of lines) {
    const fgItemId = Number(line.fgItemId);
    if (!Number.isFinite(fgItemId) || fgItemId <= 0) continue;
    const customerQty = round3(n(line.customerProductionQty));
    const qty = customerQty > 0 ? customerQty : round3(n(line.plannedFgQty));
    byItem.set(fgItemId, round3(n(byItem.get(fgItemId)) + qty));
  }
  return byItem;
}

/**
 * @deprecated Composition−approved mapping. Prefer mapSourceCoverageItem.
 */
function mapCoverageItem(fgItemId, compositionItem, alreadyApprovedQty, periodKey) {
  const rsRequirement = round3(n(compositionItem?.rsRequirement));
  const carryForward = round3(n(compositionItem?.carryForward));
  const greenShortage = round3(n(compositionItem?.greenShortage));
  const currentRequirementQty = round3(
    n(compositionItem?.suggestedProduction) ||
      n(compositionItem?.productionRequirementQty) ||
      rsRequirement + carryForward,
  );
  const approved = round3(alreadyApprovedQty);
  const additionalRequirementQty = computeAdditionalRequirementQty(currentRequirementQty, approved);
  const breakdown = emptyComponentBreakdown();
  breakdown.newUncoveredRsDemand = additionalRequirementQty;

  return {
    fgItemId,
    fgItemCode: null,
    fgItemName: compositionItem?.itemName ?? null,
    unit: compositionItem?.unit ?? null,
    currentRequirementQty,
    alreadyApprovedQty: approved,
    additionalRequirementQty,
    sourceBreakdown: {
      rsRequirement,
      carryForward,
      greenShortage,
    },
    componentBreakdown: breakdown,
    uncoveredComponents: [],
    hasAdditionalRequirement: additionalRequirementQty > 0,
    periodKey,
  };
}

function mapSourceCoverageItem(agg, periodKey) {
  const additionalRequirementQty = round3(n(agg.additionalRequirementQty));
  const alreadyApprovedQty = round3(n(agg.alreadyApprovedQty));
  const currentRequirementQty = round3(n(agg.totalComponentQty));
  const breakdown = agg.componentBreakdown || emptyComponentBreakdown();

  return {
    fgItemId: agg.fgItemId,
    fgItemCode: null,
    fgItemName: agg.fgItemName ?? null,
    unit: agg.unit ?? null,
    currentRequirementQty,
    alreadyApprovedQty,
    additionalRequirementQty,
    sourceBreakdown: agg.sourceBreakdown || {
      rsRequirement: 0,
      carryForward: 0,
      greenShortage: 0,
    },
    componentBreakdown: {
      newUncoveredRsDemand: round3(n(breakdown.newUncoveredRsDemand)),
      productionShortfallCarryForward: round3(n(breakdown.productionShortfallCarryForward)),
      qcRejectionCarryForward: round3(n(breakdown.qcRejectionCarryForward)),
      greenLevelQty: round3(n(breakdown.greenLevelQty)),
    },
    uncoveredComponents: agg.uncoveredComponents || [],
    hasAdditionalRequirement: additionalRequirementQty > 0,
    periodKey,
  };
}

function summarizeCoverageItems(items) {
  const list = Array.isArray(items) ? items : [];
  let totalCurrentRequirementQty = 0;
  let totalAlreadyApprovedQty = 0;
  let totalAdditionalRequirementQty = 0;
  let additionalItemCount = 0;
  const totalsBreakdown = emptyComponentBreakdown();

  for (const row of list) {
    totalCurrentRequirementQty = round3(totalCurrentRequirementQty + n(row.currentRequirementQty));
    totalAlreadyApprovedQty = round3(totalAlreadyApprovedQty + n(row.alreadyApprovedQty));
    totalAdditionalRequirementQty = round3(
      totalAdditionalRequirementQty + n(row.additionalRequirementQty),
    );
    if (row.hasAdditionalRequirement) additionalItemCount += 1;
    const b = row.componentBreakdown || emptyComponentBreakdown();
    totalsBreakdown.newUncoveredRsDemand = round3(
      totalsBreakdown.newUncoveredRsDemand + n(b.newUncoveredRsDemand),
    );
    totalsBreakdown.productionShortfallCarryForward = round3(
      totalsBreakdown.productionShortfallCarryForward + n(b.productionShortfallCarryForward),
    );
    totalsBreakdown.qcRejectionCarryForward = round3(
      totalsBreakdown.qcRejectionCarryForward + n(b.qcRejectionCarryForward),
    );
    totalsBreakdown.greenLevelQty = round3(totalsBreakdown.greenLevelQty + n(b.greenLevelQty));
  }

  return {
    totalCurrentRequirementQty,
    totalAlreadyApprovedQty,
    totalAdditionalRequirementQty,
    itemCount: list.length,
    additionalItemCount,
    componentBreakdown: totalsBreakdown,
  };
}

/**
 * Read-only period coverage for additional-plan preview (source-identity model).
 *
 * @param {{
 *   db?: object;
 *   periodKey: string;
 *   loadRequirementComposition?: Function;
 * }} opts
 */
async function getPeriodRequirementCoverage({
  db = prisma,
  periodKey,
  loadRequirementComposition,
} = {}) {
  const normalized = normalizePeriodKey(periodKey);

  // loadRequirementComposition retained for API compatibility; source coverage is authoritative.
  void loadRequirementComposition;

  const uncovered = await getUncoveredRequirementComponents({ db, periodKey: normalized });
  const aggregated = aggregateUncoveredByFgItem(uncovered.components);

  const items = aggregated
    .map((agg) => mapSourceCoverageItem(agg, normalized))
    .sort((a, b) => String(a.fgItemName ?? "").localeCompare(String(b.fgItemName ?? "")));

  const totals = summarizeCoverageItems(items);

  return {
    periodKey: normalized,
    anchorPeriodKey: normalized,
    approvedPlanCount: uncovered.approvedPlanCount,
    coverageModel: "SOURCE_IDENTITY",
    items,
    totals,
  };
}

module.exports = {
  round3,
  computeAdditionalRequirementQty,
  sumApprovedPlannedFgByItem,
  mapCoverageItem,
  mapSourceCoverageItem,
  summarizeCoverageItems,
  getPeriodRequirementCoverage,
};
