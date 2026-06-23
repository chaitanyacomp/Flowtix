/**
 * P11 — Planned FG qty defaults from requirement composition (RS + green shortage).
 * RM snapshot remains BOM(Green Shortage) — independent of planned FG qty.
 */

const { buildPlanningContextMaps, round3 } = require("./monthlyPlanningProductionPlanMetrics");

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

/**
 * @param {number} clientPlannedFgQty
 * @param {boolean} plannedQtyOverridden
 * @param {number} suggestedFgQty
 */
function resolvePlannedFgQtyForSave({ clientPlannedFgQty, plannedQtyOverridden, suggestedFgQty }) {
  if (plannedQtyOverridden === true) {
    return round3(n(clientPlannedFgQty));
  }
  return round3(n(suggestedFgQty));
}

/**
 * Lines where green shortage exists but planned FG is below live suggested production.
 * @param {{ lines: Array<{ fgItemId: number; plannedFgQty: unknown; plannedQtyOverridden?: boolean }>; composition: { items?: Array<object> } }} args
 */
function findGreenShortagePlannedBelowSuggested({ lines, composition }) {
  const compById = new Map((composition?.items || []).map((item) => [item.itemId, item]));
  const violations = [];
  for (const line of lines || []) {
    const fgItemId = Number(line.fgItemId);
    const comp = compById.get(fgItemId);
    if (!comp) continue;
    const greenShortage = round3(n(comp.greenShortage));
    if (!(greenShortage > 0)) continue;
    const suggestedProduction = round3(n(comp.suggestedProduction));
    const plannedFgQty = round3(n(line.plannedFgQty));
    if (plannedFgQty + 1e-9 < suggestedProduction) {
      violations.push({
        fgItemId,
        plannedFgQty,
        suggestedProduction,
        greenShortage,
        plannedQtyOverridden: Boolean(line.plannedQtyOverridden),
      });
    }
  }
  return violations;
}

/**
 * Refresh non-overridden draft lines to current suggested production before submit.
 * @param {object} tx
 * @param {number} planId
 * @param {{ items?: Array<{ itemId: number; suggestedProduction?: number }> }} composition
 */
async function syncNonOverriddenPlanLinesToSuggested(tx, planId, composition) {
  const { suggestedByFgItemId } = buildPlanningContextMaps(composition, { items: [] });
  const lines = await tx.monthlyProductionPlanLine.findMany({
    where: { planId },
    select: { id: true, fgItemId: true, plannedQtyOverridden: true },
  });
  const updates = [];
  for (const line of lines) {
    if (line.plannedQtyOverridden) continue;
    const suggested = suggestedByFgItemId.get(line.fgItemId) ?? 0;
    await tx.monthlyProductionPlanLine.update({
      where: { id: line.id },
      data: {
        plannedFgQty: suggested,
        suggestedFgQty: suggested,
      },
    });
    updates.push({ lineId: line.id, fgItemId: line.fgItemId, plannedFgQty: suggested });
  }
  return updates;
}

/**
 * Backfill persisted planned qty for non-overridden lines on frozen plans (APPROVED / AWAITING).
 * Does not alter RM snapshot lines — only MonthlyProductionPlanLine planned/suggested columns.
 *
 * @param {{
 *   db?: object;
 *   planId?: number;
 *   docNo?: string;
 *   dryRun?: boolean;
 *   loadComposition?: typeof import('./monthlyPlanningRequirementCompositionService').getRequirementComposition;
 * }} opts
 */
async function backfillNonOverriddenPlannedQtyForPlan({
  db,
  planId = null,
  docNo = null,
  dryRun = true,
  loadComposition,
} = {}) {
  const { prisma } = require("../utils/prisma");
  const client = db ?? prisma;
  const { getRequirementComposition } = require("./monthlyPlanningRequirementCompositionService");
  const loadCompositionFn = loadComposition ?? getRequirementComposition;

  const id = planId != null ? Number(planId) : null;
  const doc = docNo != null ? String(docNo).trim() : null;
  if ((!Number.isFinite(id) || id <= 0) && !doc) {
    throw new Error("backfillNonOverriddenPlannedQtyForPlan requires planId or docNo.");
  }

  const plan = await client.monthlyProductionPlan.findFirst({
    where: id ? { id } : { docNo: doc },
    select: { id: true, docNo: true, periodKey: true, status: true },
  });
  if (!plan) {
    throw new Error(`Monthly plan not found (${id ? `id=${id}` : `docNo=${doc}`}).`);
  }

  const allowed = new Set(["APPROVED", "AWAITING_PURCHASE_REVIEW", "DRAFT"]);
  if (!allowed.has(plan.status)) {
    throw new Error(`Plan ${plan.docNo} status ${plan.status} is not eligible for planned-qty backfill.`);
  }

  const composition = await loadCompositionFn({ db: client, periodKey: plan.periodKey });
  const { suggestedByFgItemId } = buildPlanningContextMaps(composition, { items: [] });
  const lines = await client.monthlyProductionPlanLine.findMany({
    where: { planId: plan.id },
    select: {
      id: true,
      fgItemId: true,
      plannedFgQty: true,
      suggestedFgQty: true,
      plannedQtyOverridden: true,
      fgItem: { select: { itemName: true } },
    },
  });

  const pending = [];
  for (const line of lines) {
    if (line.plannedQtyOverridden) continue;
    const suggested = suggestedByFgItemId.get(line.fgItemId) ?? 0;
    const planned = round3(n(line.plannedFgQty));
    if (Math.abs(planned - suggested) <= 1e-9) continue;
    pending.push({
      lineId: line.id,
      fgItemId: line.fgItemId,
      fgItemName: line.fgItem?.itemName ?? null,
      fromPlannedFgQty: planned,
      toPlannedFgQty: suggested,
      fromSuggestedFgQty: round3(n(line.suggestedFgQty)),
      toSuggestedFgQty: suggested,
    });
  }

  if (dryRun || pending.length === 0) {
    return { plan, dryRun, updatedCount: 0, pending, applied: [] };
  }

  const run = async (tx) => {
    const applied = await syncNonOverriddenPlanLinesToSuggested(tx, plan.id, composition);
    return applied;
  };
  const applied =
    typeof client.$transaction === "function" ? await client.$transaction(run) : await run(client);

  return { plan, dryRun: false, updatedCount: applied.length, pending, applied };
}

module.exports = {
  resolvePlannedFgQtyForSave,
  findGreenShortagePlannedBelowSuggested,
  syncNonOverriddenPlanLinesToSuggested,
  backfillNonOverriddenPlannedQtyForPlan,
};
