/**
 * Source-identity Monthly Plan ↔ Requirement coverage.
 *
 * Additional Plan qty = sum of eligible requirement components not covered by any
 * previous APPROVED plan. Coverage is bound to RS line / component identity —
 * never period+FG quantity subtraction alone.
 *
 * Components (from locked RS lines):
 *   RS_BASE_DEMAND, PRODUCTION_SHORTFALL, QC_REJECTION_RECOVERY
 *
 * Pending QC must not invent QC_REJECTION_RECOVERY — only finalized qty on the RS line.
 * Production shortfall already embedded on a later RS is counted once on that RS line.
 */

const { prisma } = require("../utils/prisma");
const { normalizePeriodKey } = require("./monthlyPlanningPeriodUtils");
const { pickLatestLockedSheets } = require("./monthlyPlanningRsSuggestionsService");

const COMPONENT_TYPE = Object.freeze({
  RS_BASE_DEMAND: "RS_BASE_DEMAND",
  PRODUCTION_SHORTFALL: "PRODUCTION_SHORTFALL",
  QC_REJECTION_RECOVERY: "QC_REJECTION_RECOVERY",
  GREEN_LEVEL: "GREEN_LEVEL",
});

const COMPONENT_ALLOCATION_ORDER = [
  COMPONENT_TYPE.RS_BASE_DEMAND,
  COMPONENT_TYPE.PRODUCTION_SHORTFALL,
  COMPONENT_TYPE.QC_REJECTION_RECOVERY,
];

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function rsLineSourceKey(requirementSheetLineId, componentType) {
  return `RS_LINE:${Number(requirementSheetLineId)}:${componentType}`;
}

function componentTypeRank(componentType) {
  const idx = COMPONENT_ALLOCATION_ORDER.indexOf(componentType);
  return idx >= 0 ? idx : 99;
}

function resolveBaseDemandQty(ln) {
  const base = round3(n(ln.baseDemandQty));
  if (base > 0) return base;
  return round3(n(ln.requirementQty));
}

function resolveProductionShortfallQty(ln) {
  const explicit = round3(n(ln.productionShortfallQty));
  if (explicit > 0) return explicit;
  return round3(ln.shortfallQtySnapshot != null ? n(ln.shortfallQtySnapshot) : 0);
}

function resolveQcRejectionQty(ln) {
  return round3(n(ln.qcRejectionRecoveryQty));
}

/**
 * Build immutable requirement components for one locked RS line.
 * Shortfall / QC already on the line are separate components (no external double-add).
 */
function buildComponentsForRsLine(sheet, ln) {
  const fgItemId = Number(ln.itemId);
  const lineId = Number(ln.id);
  const cycleNo = sheet.cycle?.cycleNo != null ? Number(sheet.cycle.cycleNo) : null;
  const base = {
    fgItemId,
    requirementSheetId: sheet.id,
    requirementSheetDocNo: sheet.docNo ?? null,
    requirementSheetLineId: lineId,
    salesOrderId: sheet.salesOrderId,
    salesOrderDocNo: sheet.salesOrder?.docNo ?? null,
    cycleId: sheet.cycleId ?? null,
    cycleNo,
    itemName: ln.item?.itemName ?? null,
    unit: ln.item?.unit ?? null,
  };

  const components = [];
  const baseQty = resolveBaseDemandQty(ln);
  if (baseQty > 0) {
    components.push({
      ...base,
      componentType: COMPONENT_TYPE.RS_BASE_DEMAND,
      sourceKey: rsLineSourceKey(lineId, COMPONENT_TYPE.RS_BASE_DEMAND),
      componentQty: baseQty,
    });
  }
  const shortfallQty = resolveProductionShortfallQty(ln);
  if (shortfallQty > 0) {
    components.push({
      ...base,
      componentType: COMPONENT_TYPE.PRODUCTION_SHORTFALL,
      sourceKey: rsLineSourceKey(lineId, COMPONENT_TYPE.PRODUCTION_SHORTFALL),
      componentQty: shortfallQty,
    });
  }
  const qcQty = resolveQcRejectionQty(ln);
  if (qcQty > 0) {
    components.push({
      ...base,
      componentType: COMPONENT_TYPE.QC_REJECTION_RECOVERY,
      sourceKey: rsLineSourceKey(lineId, COMPONENT_TYPE.QC_REJECTION_RECOVERY),
      componentQty: qcQty,
    });
  }
  return components;
}

function sortComponentsForAllocation(components) {
  return [...components].sort((a, b) => {
    const cycleA = n(a.cycleNo) || n(a.cycleId);
    const cycleB = n(b.cycleNo) || n(b.cycleId);
    if (cycleA !== cycleB) return cycleA - cycleB;
    const typeDiff = componentTypeRank(a.componentType) - componentTypeRank(b.componentType);
    if (typeDiff !== 0) return typeDiff;
    return n(a.requirementSheetLineId) - n(b.requirementSheetLineId);
  });
}

/**
 * Load locked RS requirement components for a period (latest version per SO+cycle).
 */
async function loadPeriodRequirementComponents(db, periodKey) {
  const normalized = normalizePeriodKey(periodKey);
  const rawSheets = await db.requirementSheet.findMany({
    where: {
      status: "LOCKED",
      periodKey: normalized,
      salesOrder: { orderType: "NO_QTY" },
    },
    include: {
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
      cycle: { select: { id: true, cycleNo: true } },
      lines: {
        include: {
          item: { select: { id: true, itemName: true, itemType: true, unit: true } },
        },
      },
    },
    orderBy: [{ salesOrderId: "asc" }, { version: "desc" }],
  });

  const sheets = pickLatestLockedSheets(rawSheets);
  const components = [];
  for (const sheet of sheets) {
    for (const ln of sheet.lines || []) {
      if (ln.item?.itemType && ln.item.itemType !== "FG") continue;
      components.push(...buildComponentsForRsLine(sheet, ln));
    }
  }
  return components;
}

function planCustomerCoverQty(line) {
  const customerQty = round3(n(line.customerProductionQty));
  if (customerQty > 0) return customerQty;
  return round3(n(line.plannedFgQty));
}

/**
 * Allocate a plan's FG customer qty onto uncovered components (cycle ASC, type order).
 * @returns {Array<object>} coverage row payloads (not yet persisted)
 */
function allocatePlanQtyToComponents({
  plan,
  planLine,
  coverQty,
  components,
  coveredBySourceKey,
}) {
  const fgItemId = Number(planLine.fgItemId);
  let remaining = round3(coverQty);
  if (!(remaining > 0)) return [];

  const eligible = sortComponentsForAllocation(
    components.filter((c) => Number(c.fgItemId) === fgItemId),
  );

  const rows = [];
  for (const component of eligible) {
    if (!(remaining > 0)) break;
    const already = round3(n(coveredBySourceKey.get(component.sourceKey)));
    const uncovered = round3(Math.max(0, n(component.componentQty) - already));
    if (!(uncovered > 0)) continue;
    const take = round3(Math.min(remaining, uncovered));
    if (!(take > 0)) continue;
    rows.push({
      planId: plan.id,
      planLineId: planLine.id ?? null,
      periodKey: plan.periodKey,
      fgItemId,
      requirementSheetId: component.requirementSheetId,
      requirementSheetLineId: component.requirementSheetLineId,
      salesOrderId: component.salesOrderId,
      cycleId: component.cycleId,
      cycleNo: component.cycleNo,
      componentType: component.componentType,
      sourceKey: component.sourceKey,
      componentQty: component.componentQty,
      coveredQty: take,
    });
    coveredBySourceKey.set(component.sourceKey, round3(already + take));
    remaining = round3(remaining - take);
  }
  return rows;
}

async function loadCoveredQtyBySourceKey(db, periodKey) {
  const rows = await db.monthlyPlanRequirementCoverage.findMany({
    where: {
      periodKey,
      plan: { status: "APPROVED" },
    },
    select: { sourceKey: true, coveredQty: true },
  });
  const map = new Map();
  for (const row of rows) {
    map.set(row.sourceKey, round3(n(map.get(row.sourceKey)) + n(row.coveredQty)));
  }
  return map;
}

/**
 * Persist coverage rows for one approved plan (idempotent per planId).
 */
async function writeCoverageForApprovedPlan(db, planId) {
  const plan = await db.monthlyProductionPlan.findUnique({
    where: { id: planId },
    include: {
      lines: true,
      requirementCoverages: { select: { id: true } },
    },
  });
  if (!plan || plan.status !== "APPROVED") return { written: 0, skipped: true };
  if ((plan.requirementCoverages || []).length > 0) {
    return { written: 0, skipped: true, reason: "ALREADY_COVERED" };
  }

  const components = await loadPeriodRequirementComponents(db, plan.periodKey);
  const coveredBySourceKey = await loadCoveredQtyBySourceKey(db, plan.periodKey);

  const toCreate = [];
  for (const planLine of plan.lines || []) {
    const coverQty = planCustomerCoverQty(planLine);
    toCreate.push(
      ...allocatePlanQtyToComponents({
        plan,
        planLine,
        coverQty,
        components,
        coveredBySourceKey,
      }),
    );
  }

  if (!toCreate.length) return { written: 0, skipped: false };

  if (typeof db.monthlyPlanRequirementCoverage.createMany === "function") {
    await db.monthlyPlanRequirementCoverage.createMany({ data: toCreate });
  } else {
    for (const row of toCreate) {
      await db.monthlyPlanRequirementCoverage.create({ data: row });
    }
  }
  return { written: toCreate.length, skipped: false, rows: toCreate };
}

/**
 * Ensure every APPROVED plan in the period has coverage rows (backfill in planSequenceNo order).
 * Does not mutate plan/RS snapshots — only inserts missing coverage links.
 */
async function ensurePeriodPlanRequirementCoverage(db, periodKey) {
  const normalized = normalizePeriodKey(periodKey);
  const plans = await db.monthlyProductionPlan.findMany({
    where: { periodKey: normalized, status: "APPROVED" },
    select: { id: true, planSequenceNo: true },
    orderBy: { planSequenceNo: "asc" },
  });

  const results = [];
  for (const plan of plans) {
    results.push(await writeCoverageForApprovedPlan(db, plan.id));
  }
  return { periodKey: normalized, plansProcessed: plans.length, results };
}

function emptyComponentBreakdown() {
  return {
    newUncoveredRsDemand: 0,
    productionShortfallCarryForward: 0,
    qcRejectionCarryForward: 0,
    greenLevelQty: 0,
  };
}

function addToBreakdown(breakdown, componentType, qty) {
  const q = round3(qty);
  if (!(q > 0)) return;
  if (componentType === COMPONENT_TYPE.RS_BASE_DEMAND) {
    breakdown.newUncoveredRsDemand = round3(breakdown.newUncoveredRsDemand + q);
  } else if (componentType === COMPONENT_TYPE.PRODUCTION_SHORTFALL) {
    breakdown.productionShortfallCarryForward = round3(
      breakdown.productionShortfallCarryForward + q,
    );
  } else if (componentType === COMPONENT_TYPE.QC_REJECTION_RECOVERY) {
    breakdown.qcRejectionCarryForward = round3(breakdown.qcRejectionCarryForward + q);
  } else if (componentType === COMPONENT_TYPE.GREEN_LEVEL) {
    breakdown.greenLevelQty = round3(breakdown.greenLevelQty + q);
  }
}

/**
 * Compute uncovered requirement components after ensuring coverage backfill.
 */
async function getUncoveredRequirementComponents({ db = prisma, periodKey } = {}) {
  const normalized = normalizePeriodKey(periodKey);
  await ensurePeriodPlanRequirementCoverage(db, normalized);

  const [components, coveredBySourceKey, approvedPlanCount] = await Promise.all([
    loadPeriodRequirementComponents(db, normalized),
    loadCoveredQtyBySourceKey(db, normalized),
    db.monthlyProductionPlan.count({
      where: { periodKey: normalized, status: "APPROVED" },
    }),
  ]);

  const uncovered = [];
  for (const component of components) {
    const covered = round3(n(coveredBySourceKey.get(component.sourceKey)));
    const uncoveredQty = round3(Math.max(0, n(component.componentQty) - covered));
    uncovered.push({
      ...component,
      coveredQty: covered,
      uncoveredQty,
      isCovered: uncoveredQty <= 0 && covered > 0,
      isUnplanned: uncoveredQty > 0,
    });
  }

  return {
    periodKey: normalized,
    approvedPlanCount,
    components: uncovered,
    coveredBySourceKey,
  };
}

/**
 * Aggregate uncovered components into per-FG coverage rows for Additional Plan.
 */
function aggregateUncoveredByFgItem(components) {
  /** @type {Map<number, object>} */
  const byFg = new Map();

  for (const c of components || []) {
    const fgItemId = Number(c.fgItemId);
    if (!byFg.has(fgItemId)) {
      byFg.set(fgItemId, {
        fgItemId,
        fgItemName: c.itemName ?? null,
        unit: c.unit ?? null,
        totalComponentQty: 0,
        alreadyApprovedQty: 0,
        additionalRequirementQty: 0,
        componentBreakdown: emptyComponentBreakdown(),
        uncoveredComponents: [],
        sourceBreakdown: {
          rsRequirement: 0,
          carryForward: 0,
          greenShortage: 0,
        },
      });
    }
    const row = byFg.get(fgItemId);
    row.totalComponentQty = round3(row.totalComponentQty + n(c.componentQty));
    row.alreadyApprovedQty = round3(row.alreadyApprovedQty + n(c.coveredQty));
    row.additionalRequirementQty = round3(row.additionalRequirementQty + n(c.uncoveredQty));
    if (c.componentType === COMPONENT_TYPE.RS_BASE_DEMAND) {
      row.sourceBreakdown.rsRequirement = round3(
        row.sourceBreakdown.rsRequirement + n(c.componentQty),
      );
    }
    if (c.componentType === COMPONENT_TYPE.PRODUCTION_SHORTFALL) {
      row.sourceBreakdown.carryForward = round3(
        row.sourceBreakdown.carryForward + n(c.componentQty),
      );
    }
    if (n(c.uncoveredQty) > 0) {
      addToBreakdown(row.componentBreakdown, c.componentType, c.uncoveredQty);
      row.uncoveredComponents.push({
        sourceKey: c.sourceKey,
        componentType: c.componentType,
        requirementSheetId: c.requirementSheetId,
        requirementSheetDocNo: c.requirementSheetDocNo,
        requirementSheetLineId: c.requirementSheetLineId,
        salesOrderId: c.salesOrderId,
        cycleId: c.cycleId,
        cycleNo: c.cycleNo,
        componentQty: c.componentQty,
        coveredQty: c.coveredQty,
        uncoveredQty: c.uncoveredQty,
      });
    }
  }

  return [...byFg.values()];
}

module.exports = {
  COMPONENT_TYPE,
  COMPONENT_ALLOCATION_ORDER,
  round3,
  rsLineSourceKey,
  buildComponentsForRsLine,
  sortComponentsForAllocation,
  allocatePlanQtyToComponents,
  planCustomerCoverQty,
  loadPeriodRequirementComponents,
  writeCoverageForApprovedPlan,
  ensurePeriodPlanRequirementCoverage,
  getUncoveredRequirementComponents,
  aggregateUncoveredByFgItem,
  emptyComponentBreakdown,
};
