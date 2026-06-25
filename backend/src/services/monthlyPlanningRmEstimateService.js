/**
 * Live (non-persistent) RM requirement estimate for draft monthly plans.
 * Uses plannedFgQty on draft lines — same BOM explosion as approval snapshot, without writing RmPlan.
 */

const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { prisma } = require("../utils/prisma");

function planningCore() {
  return require("./monthlyPlanningService");
}

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function canShowLiveRmEstimateStatus(status) {
  return status === "DRAFT" || status === "AWAITING_PURCHASE_REVIEW";
}

/**
 * @param {Map<number, number>} rmNeeded
 * @param {Map<number, object>} availabilityById
 * @param {Map<number, { id: number; itemName: string | null; unit: string | null }>} itemMetaById
 */
function mapEstimateLines(rmNeeded, availabilityById, itemMetaById) {
  const rmItemIds = [...rmNeeded.keys()];
  return rmItemIds.map((rmItemId) => {
    const gross = round3(rmNeeded.get(rmItemId) || 0);
    const avail = availabilityById.get(rmItemId) || {};
    const meta = itemMetaById.get(rmItemId) || {};
    const freeStock = round3(avail.freeStockQty ?? 0);
    const reserved = round3(avail.effectiveReservedQty ?? 0);
    const incoming = round3(avail.incomingQty ?? 0);
    const availableRmStock = round3(n(avail.physicalUsableStockQty ?? avail.freeStockQty ?? 0));
    const net = round3(Math.max(0, gross - availableRmStock));
    const warnings = Array.isArray(avail.warnings) ? avail.warnings : [];
    return {
      id: rmItemId,
      rmItemId,
      rmItemName: meta.itemName ?? null,
      unit: meta.unit ?? null,
      grossDemandQty: gross,
      freeStockSnapshot: freeStock,
      reservedSnapshot: reserved,
      incomingPoSnapshot: incoming,
      availableRmQty: availableRmStock,
      minStockTopUpQty: 0,
      netRequirementQty: net,
      belowMinStockFlag: false,
      leadTimeRiskFlag: false,
      warnings,
    };
  });
}

function summarizeEstimateLines(lines) {
  return {
    rmItemCount: lines.length,
    grossDemandTotal: round3(lines.reduce((acc, l) => acc + n(l.grossDemandQty), 0)),
    freeStockTotal: round3(lines.reduce((acc, l) => acc + n(l.freeStockSnapshot), 0)),
    reservedTotal: round3(lines.reduce((acc, l) => acc + n(l.reservedSnapshot), 0)),
    incomingPoTotal: round3(lines.reduce((acc, l) => acc + n(l.incomingPoSnapshot), 0)),
    availableRmTotal: round3(lines.reduce((acc, l) => acc + n(l.availableRmQty), 0)),
    netRequirementTotal: round3(lines.reduce((acc, l) => acc + n(l.netRequirementQty), 0)),
  };
}

/**
 * Read a live RM estimate from current draft plan FG lines (no RmPlan persistence).
 *
 * @param {{
 *   db?: object;
 *   planId?: number;
 *   asOf?: Date;
 *   deps?: object;
 * }} opts
 */
async function getRmPlanningEstimate({ db = prisma, planId, asOf = new Date(), deps = {} } = {}) {
  const { MonthlyPlanningError } = planningCore();
  const explodeFn = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const loadBomFn = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const availabilityFn = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;

  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
  }

  const plan = await db.monthlyProductionPlan.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      currentRevision: true,
      periodKey: true,
      planSequenceNo: true,
      planKind: true,
    },
  });
  if (!plan) {
    throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
  }
  if (!canShowLiveRmEstimateStatus(plan.status)) {
    throw new MonthlyPlanningError(
      "PLAN_NOT_ESTIMATABLE",
      "Live RM estimate is only available before Purchase approval. Use Plan RM Snapshot for approved plans.",
      409,
    );
  }

  const planLines = await db.monthlyProductionPlanLine.findMany({
    where: { planId: id },
    include: { fgItem: { select: { id: true, itemName: true, unit: true } } },
    orderBy: { id: "asc" },
  });
  const activeLines = planLines.filter((l) => Number(l.plannedFgQty) > 0);
  const totalFgPlannedQty = round3(activeLines.reduce((acc, l) => acc + Number(l.plannedFgQty), 0));

  const emptyEstimate = {
    mode: "LIVE_ESTIMATE",
    locked: false,
    exists: false,
    planId: plan.id,
    status: plan.status,
    currentRevision: plan.currentRevision,
    revision: null,
    rmPlan: null,
    availableRevisions: [],
    estimatedAt: asOf instanceof Date ? asOf.toISOString() : new Date().toISOString(),
    totalFgPlannedQty,
    planWarnings: { missingFgBoms: [], missingChildBoms: [] },
    totals: {
      rmItemCount: 0,
      grossDemandTotal: 0,
      freeStockTotal: 0,
      reservedTotal: 0,
      incomingPoTotal: 0,
      availableRmTotal: 0,
      netRequirementTotal: 0,
      totalFgPlannedQty,
    },
    lines: [],
  };

  if (activeLines.length === 0) {
    return emptyEstimate;
  }

  const missingFgBoms = [];
  const fgLines = [];
  for (const line of activeLines) {
    const bom = await loadBomFn(db, line.fgItemId);
    const bomMissing = !bom || !bom.lines || bom.lines.length === 0;
    if (bomMissing) {
      missingFgBoms.push({
        fgItemId: line.fgItemId,
        fgItemName: line.fgItem?.itemName ?? null,
      });
    }
    fgLines.push({
      fgItemId: line.fgItemId,
      fgQty: round3(Number(line.plannedFgQty)),
      bomMissing,
    });
  }

  const { rmNeeded, missingChildBoms } = await explodeFn(db, fgLines);
  const rmItemIds = [...rmNeeded.keys()];
  const requiredQtyByItemId = {};
  for (const [itemId, qty] of rmNeeded.entries()) requiredQtyByItemId[itemId] = qty;

  const availability =
    rmItemIds.length > 0
      ? await availabilityFn({ itemIds: rmItemIds, requiredQtyByItemId, db })
      : [];
  const availabilityById = new Map(availability.map((a) => [a.itemId, a]));

  const rmItems =
    rmItemIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: rmItemIds } },
          select: { id: true, itemName: true, unit: true },
        })
      : [];
  const itemMetaById = new Map(rmItems.map((i) => [i.id, i]));

  const lines = mapEstimateLines(rmNeeded, availabilityById, itemMetaById);
  const lineTotals = summarizeEstimateLines(lines);

  return {
    mode: "LIVE_ESTIMATE",
    locked: false,
    exists: lines.length > 0 || missingFgBoms.length > 0 || missingChildBoms.length > 0,
    planId: plan.id,
    status: plan.status,
    currentRevision: plan.currentRevision,
    revision: null,
    rmPlan: null,
    availableRevisions: [],
    estimatedAt: asOf instanceof Date ? asOf.toISOString() : new Date().toISOString(),
    totalFgPlannedQty,
    planWarnings: {
      missingFgBoms,
      missingChildBoms: (missingChildBoms || []).map((m) => ({
        sfgItemId: m.sfgItemId,
        sfgName: m.sfgName ?? null,
      })),
    },
    totals: {
      ...lineTotals,
      totalFgPlannedQty,
    },
    lines,
  };
}

module.exports = {
  canShowLiveRmEstimateStatus,
  getRmPlanningEstimate,
  mapEstimateLines,
  summarizeEstimateLines,
};
