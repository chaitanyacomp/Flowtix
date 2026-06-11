/**
 * Phase P2 — Read-only period requirement coverage (plan-document model).
 *
 * Additional Requirement = MAX(0, Current Requirement Composition − Already Approved)
 *
 * Current Requirement Composition uses suggestedProduction from requirement composition
 * (RS + Carry Forward + Green Shortage + future composition drivers).
 *
 * Already Approved = sum of plannedFgQty across APPROVED plans in the same period only.
 */

const { prisma } = require("../utils/prisma");
const { normalizePeriodKey } = require("./monthlyPlanningService");
const { getRequirementComposition } = require("./monthlyPlanningRequirementCompositionService");

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
 * @param {number} currentRequirementQty
 * @param {number} alreadyApprovedQty
 */
function computeAdditionalRequirementQty(currentRequirementQty, alreadyApprovedQty) {
  return round3(Math.max(0, n(currentRequirementQty) - n(alreadyApprovedQty)));
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | object} db
 * @param {string} periodKey normalized YYYY-MM
 * @returns {Promise<Map<number, number>>}
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
    },
  });

  const byItem = new Map();
  for (const line of lines) {
    const fgItemId = Number(line.fgItemId);
    if (!Number.isFinite(fgItemId) || fgItemId <= 0) continue;
    const qty = round3(n(line.plannedFgQty));
    byItem.set(fgItemId, round3(n(byItem.get(fgItemId)) + qty));
  }
  return byItem;
}

/**
 * Build one coverage row from composition + approved aggregates.
 * @param {number} fgItemId
 * @param {{
 *   itemName?: string | null;
 *   unit?: string | null;
 *   rsRequirement?: number;
 *   carryForward?: number;
 *   greenShortage?: number;
 *   suggestedProduction?: number;
 * }} compositionItem
 * @param {number} alreadyApprovedQty
 * @param {string} periodKey
 */
function mapCoverageItem(fgItemId, compositionItem, alreadyApprovedQty, periodKey) {
  const rsRequirement = round3(n(compositionItem?.rsRequirement));
  const carryForward = round3(n(compositionItem?.carryForward));
  const greenShortage = round3(n(compositionItem?.greenShortage));
  const currentRequirementQty = round3(
    n(compositionItem?.suggestedProduction) ||
      rsRequirement + carryForward + greenShortage,
  );
  const approved = round3(alreadyApprovedQty);
  const additionalRequirementQty = computeAdditionalRequirementQty(currentRequirementQty, approved);

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

  for (const row of list) {
    totalCurrentRequirementQty = round3(totalCurrentRequirementQty + n(row.currentRequirementQty));
    totalAlreadyApprovedQty = round3(totalAlreadyApprovedQty + n(row.alreadyApprovedQty));
    totalAdditionalRequirementQty = round3(totalAdditionalRequirementQty + n(row.additionalRequirementQty));
    if (row.hasAdditionalRequirement) additionalItemCount += 1;
  }

  return {
    totalCurrentRequirementQty,
    totalAlreadyApprovedQty,
    totalAdditionalRequirementQty,
    itemCount: list.length,
    additionalItemCount,
  };
}

/**
 * Read-only period coverage for additional-plan preview (P3+).
 *
 * @param {{
 *   db?: object;
 *   periodKey: string;
 *   loadRequirementComposition?: typeof getRequirementComposition;
 * }} opts
 */
async function getPeriodRequirementCoverage({
  db = prisma,
  periodKey,
  loadRequirementComposition = getRequirementComposition,
} = {}) {
  const normalized = normalizePeriodKey(periodKey);
  const dbArg = db ? { db, periodKey: normalized } : { periodKey: normalized };

  const [composition, approvedByItem] = await Promise.all([
    loadRequirementComposition(dbArg),
    sumApprovedPlannedFgByItem(db, normalized),
  ]);

  const compositionByItem = new Map((composition.items || []).map((item) => [item.itemId, item]));
  const itemIds = new Set([...compositionByItem.keys(), ...approvedByItem.keys()]);

  const items = [];
  for (const fgItemId of itemIds) {
    const compositionItem = compositionByItem.get(fgItemId) ?? {
      itemId: fgItemId,
      itemName: null,
      unit: null,
      rsRequirement: 0,
      carryForward: 0,
      greenShortage: 0,
      suggestedProduction: 0,
    };
    items.push(
      mapCoverageItem(fgItemId, compositionItem, approvedByItem.get(fgItemId) ?? 0, normalized),
    );
  }

  items.sort((a, b) => String(a.fgItemName ?? "").localeCompare(String(b.fgItemName ?? "")));

  const totals = summarizeCoverageItems(items);

  return {
    periodKey: normalized,
    anchorPeriodKey: composition.anchorPeriodKey ?? normalized,
    approvedPlanCount: await db.monthlyProductionPlan.count({
      where: { periodKey: normalized, status: "APPROVED" },
    }),
    items,
    totals,
  };
}

module.exports = {
  round3,
  computeAdditionalRequirementQty,
  sumApprovedPlannedFgByItem,
  mapCoverageItem,
  summarizeCoverageItems,
  getPeriodRequirementCoverage,
};
