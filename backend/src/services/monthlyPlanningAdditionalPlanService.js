/**
 * Phase P3 — Additional plan preview & creation (delta-only plan documents).
 *
 * Additional Monthly Plan is a procurement activity. Uncovered FG demand alone is
 * not enough — create/PA only when BOM(RM) for that delta has net shortage after
 * free stock and inbound procurement coverage.
 */

const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { getPeriodRequirementCoverage } = require("./monthlyPlanningCoverageService");
const {
  buildPlanDisplayLabel,
  findActivePlanInPeriod,
  assertNoOtherActivePlanInPeriod,
  getNextPlanSequenceNo,
  MONTHLY_PLAN_KIND,
} = require("./monthlyPlanningPlanLifecycleService");
const { aggregateRmDemandForFgLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");

const ADDITIONAL_EPS = 1e-6;

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

/**
 * Net RM shortage for Additional Plan FG delta after free stock and inbound PO/cover.
 * @returns {Promise<{ procurementRequired: boolean; netRmShortageQty: number | null; rmRequiredQty: number | null; lines: object[]; missingChildBoms?: object[]; blockingCode?: string }>}
 */
async function assessAdditionalPlanRmProcurementNeed({
  db = prisma,
  coverageItems = [],
  aggregateRmDemand = aggregateRmDemandForFgLines,
  loadAvailability = getMaterialAvailabilityByItems,
} = {}) {
  const fgLines = [];
  for (const row of coverageItems || []) {
    const fgItemId = Number(row.fgItemId);
    const fgQty = round3(n(row.additionalRequirementQty));
    if (!(Number.isFinite(fgItemId) && fgItemId > 0 && fgQty > ADDITIONAL_EPS)) continue;
    fgLines.push({ fgItemId, fgQty, bomMissing: false });
  }

  if (!fgLines.length) {
    return { procurementRequired: false, netRmShortageQty: 0, rmRequiredQty: 0, lines: [] };
  }

  const demand = await aggregateRmDemand(db, fgLines);
  if ((demand?.missingChildBoms || []).length > 0) {
    // Cannot prove stock coverage without BOM — treat as procurement-planning needed.
    return {
      procurementRequired: true,
      netRmShortageQty: null,
      rmRequiredQty: null,
      lines: [],
      missingChildBoms: demand.missingChildBoms,
      blockingCode: "MISSING_BOM",
    };
  }

  const rmNeeded = demand?.rmNeeded instanceof Map ? demand.rmNeeded : new Map();
  if (!rmNeeded.size) {
    return { procurementRequired: false, netRmShortageQty: 0, rmRequiredQty: 0, lines: [] };
  }

  const availabilityRows = await loadAvailability({
    db,
    itemIds: [...rmNeeded.keys()],
    requiredQtyByItemId: rmNeeded,
    includeIncoming: true,
    includeIssued: false,
  });

  const lines = [];
  let rmRequiredQty = 0;
  let netRmShortageQty = 0;
  for (const [rmItemId, requiredRaw] of rmNeeded.entries()) {
    const requiredQty = round3(n(requiredRaw));
    if (!(requiredQty > ADDITIONAL_EPS)) continue;
    const row = (availabilityRows || []).find((r) => Number(r.itemId) === Number(rmItemId));
    const availableQty = round3(n(row?.freeStockQty ?? row?.physicalUsableStockQty ?? 0));
    const incomingQty = round3(n(row?.incomingQty ?? 0));
    const shortageAfterStock = round3(Math.max(0, requiredQty - availableQty));
    const shortageAfterIncoming = round3(Math.max(0, shortageAfterStock - incomingQty));
    rmRequiredQty = round3(rmRequiredQty + requiredQty);
    netRmShortageQty = round3(netRmShortageQty + shortageAfterIncoming);
    lines.push({
      rmItemId: Number(rmItemId),
      requiredQty,
      availableQty,
      incomingQty,
      shortageAfterStock,
      netRmShortageQty: shortageAfterIncoming,
    });
  }

  return {
    procurementRequired: netRmShortageQty > ADDITIONAL_EPS,
    netRmShortageQty,
    rmRequiredQty,
    lines,
  };
}

/**
 * @param {{
 *   approvedPlanCount: number;
 *   activePlan: object | null;
 *   totalAdditionalRequirementQty: number;
 *   netRmShortageQty?: number | null;
 *   procurementRequired?: boolean | null;
 * }} input
 */
function evaluateAdditionalPlanCreateEligibility({
  approvedPlanCount,
  activePlan,
  totalAdditionalRequirementQty,
  netRmShortageQty = null,
  procurementRequired = null,
}) {
  if (!(Number(approvedPlanCount) > 0)) {
    return {
      canCreate: false,
      blockingCode: "NO_APPROVED_PLAN",
      blockingReason: "At least one APPROVED plan is required before creating an additional plan.",
    };
  }
  if (activePlan) {
    return {
      canCreate: false,
      blockingCode: "ACTIVE_PLAN_EXISTS",
      blockingReason: `Period already has an open plan (${activePlan.docNo ?? `Plan ${activePlan.planSequenceNo}`}, ${activePlan.status}). Resolve approve or reject before creating another plan.`,
    };
  }
  if (!(Number(totalAdditionalRequirementQty) > ADDITIONAL_EPS)) {
    return {
      canCreate: false,
      blockingCode: "NO_ADDITIONAL_REQUIREMENT",
      blockingReason: "No additional requirement remains for this period.",
    };
  }
  // Procurement gate: Additional Monthly Plan is only for net RM shortage.
  // Uncovered FG with full RM stock/inbound coverage must not force a new plan.
  if (procurementRequired === false || (netRmShortageQty != null && !(Number(netRmShortageQty) > ADDITIONAL_EPS))) {
    return {
      canCreate: false,
      blockingCode: "NO_PROCUREMENT_NEED",
      blockingReason:
        "RM stock (and inbound procurement) already covers the uncovered Requirement Sheet demand. Proceed to Work Order creation — Additional Monthly Plan is not required.",
    };
  }
  return {
    canCreate: true,
    blockingCode: null,
    blockingReason: null,
  };
}

/**
 * Read-only preview for additional plan creation.
 */
async function previewAdditionalPlan({
  db = prisma,
  periodKey,
  loadRequirementComposition,
  aggregateRmDemand,
  loadAvailability,
} = {}) {
  const { normalizePeriodKey } = planningCore();
  const normalized = normalizePeriodKey(periodKey);

  const [coverage, activePlan, nextPlanSequenceNo] = await Promise.all([
    getPeriodRequirementCoverage({ db, periodKey: normalized, loadRequirementComposition }),
    findActivePlanInPeriod(db, normalized),
    getNextPlanSequenceNo(db, normalized),
  ]);

  const rmNeed = await assessAdditionalPlanRmProcurementNeed({
    db,
    coverageItems: coverage.items,
    aggregateRmDemand,
    loadAvailability,
  });

  const eligibility = evaluateAdditionalPlanCreateEligibility({
    approvedPlanCount: coverage.approvedPlanCount,
    activePlan,
    totalAdditionalRequirementQty: coverage.totals.totalAdditionalRequirementQty,
    netRmShortageQty: rmNeed.netRmShortageQty,
    procurementRequired: rmNeed.procurementRequired,
  });

  const nextPlanLabel = buildPlanDisplayLabel({
    periodKey: normalized,
    planSequenceNo: nextPlanSequenceNo,
  });

  return {
    periodKey: normalized,
    nextPlanSequenceNo,
    nextPlanLabel,
    nextPlanKind: MONTHLY_PLAN_KIND.ADDITIONAL,
    canCreate: eligibility.canCreate,
    blockingCode: eligibility.blockingCode,
    blockingReason: eligibility.blockingReason,
    approvedPlanCount: coverage.approvedPlanCount,
    activePlan: activePlan
      ? {
          id: activePlan.id,
          docNo: activePlan.docNo ?? null,
          planSequenceNo: activePlan.planSequenceNo,
          status: activePlan.status,
          displayLabel: buildPlanDisplayLabel(activePlan),
        }
      : null,
    items: coverage.items,
    totals: {
      ...coverage.totals,
      netRmShortageQty: rmNeed.netRmShortageQty,
      rmRequiredQty: rmNeed.rmRequiredQty,
      procurementRequired: rmNeed.procurementRequired,
    },
    rmProcurementNeed: rmNeed,
    anchorPeriodKey: coverage.anchorPeriodKey,
  };
}

function assertCanCreateAdditionalPlan(eligibility) {
  const { MonthlyPlanningError } = planningCore();
  if (eligibility.canCreate) return;
  throw new MonthlyPlanningError(
    eligibility.blockingCode ?? "ADDITIONAL_PLAN_BLOCKED",
    eligibility.blockingReason ?? "Additional plan cannot be created for this period.",
    409,
  );
}

/**
 * Create a new ADDITIONAL DRAFT plan with delta FG lines only.
 */
async function createAdditionalPlan({
  db = prisma,
  periodKey,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  remarks = null,
  now = new Date(),
  loadRequirementComposition,
  aggregateRmDemand,
  loadAvailability,
} = {}) {
  const { MonthlyPlanningError, assertPeriodWriteAllowed } = planningCore();
  const normalized = assertPeriodWriteAllowed({
    periodKey,
    actorRole,
    confirmPastPeriod,
    now,
  });

  const run = async (tx) => {
    const coverage = await getPeriodRequirementCoverage({
      db: tx,
      periodKey: normalized,
      loadRequirementComposition,
    });
    const activePlan = await findActivePlanInPeriod(tx, normalized);
    const rmNeed = await assessAdditionalPlanRmProcurementNeed({
      db: tx,
      coverageItems: coverage.items,
      aggregateRmDemand,
      loadAvailability,
    });
    const eligibility = evaluateAdditionalPlanCreateEligibility({
      approvedPlanCount: coverage.approvedPlanCount,
      activePlan,
      totalAdditionalRequirementQty: coverage.totals.totalAdditionalRequirementQty,
      netRmShortageQty: rmNeed.netRmShortageQty,
      procurementRequired: rmNeed.procurementRequired,
    });
    assertCanCreateAdditionalPlan(eligibility);
    await assertNoOtherActivePlanInPeriod(tx, normalized);

    const deltaItems = coverage.items.filter((row) => Number(row.additionalRequirementQty) > ADDITIONAL_EPS);
    if (!deltaItems.length) {
      throw new MonthlyPlanningError(
        "NO_ADDITIONAL_REQUIREMENT",
        "No additional requirement remains for this period.",
        409,
      );
    }

    const fgIds = deltaItems.map((row) => row.fgItemId);
    const itemRows = await tx.item.findMany({
      where: { id: { in: fgIds } },
      select: { id: true, itemType: true },
    });
    const itemTypeById = new Map(itemRows.map((row) => [row.id, row.itemType]));
    for (const row of deltaItems) {
      const itemType = itemTypeById.get(row.fgItemId);
      if (!itemType) {
        throw new MonthlyPlanningError("FG_ITEM_NOT_FOUND", `Item ${row.fgItemId} not found.`, 422);
      }
      if (itemType !== "FG") {
        throw new MonthlyPlanningError("NOT_FG_ITEM", `Item ${row.fgItemId} is not an FG item.`, 422);
      }
    }

    const planSequenceNo = await getNextPlanSequenceNo(tx, normalized);
    const docNo = await allocateDocNo(tx, { docType: DocType.MONTHLY_PRODUCTION_PLAN });
    const plan = await tx.monthlyProductionPlan.create({
      data: {
        docNo,
        periodKey: normalized,
        planSequenceNo,
        planKind: MONTHLY_PLAN_KIND.ADDITIONAL,
        status: "DRAFT",
        currentRevision: 0,
        remarks: remarks ?? null,
        createdByUserId: actorUserId ?? null,
      },
    });

    const lineRemark = "Additional requirement from source-identity coverage";
    const createdLines = [];
    for (const row of deltaItems) {
      const line = await tx.monthlyProductionPlanLine.create({
        data: {
          planId: plan.id,
          fgItemId: row.fgItemId,
          plannedFgQty: row.additionalRequirementQty,
          suggestedFgQty: row.additionalRequirementQty,
          customerProductionQty: row.additionalRequirementQty,
          greenReplenishmentQty: 0,
          plannedQtyOverridden: false,
          source: "REQUIREMENT_SHEET",
          remarks: lineRemark,
        },
      });
      createdLines.push(line);
    }

    return {
      plan: {
        id: plan.id,
        docNo: plan.docNo,
        periodKey: plan.periodKey,
        planSequenceNo: plan.planSequenceNo,
        planKind: plan.planKind,
        displayLabel: buildPlanDisplayLabel(plan),
        status: plan.status,
        remarks: plan.remarks ?? null,
        createdByUserId: plan.createdByUserId ?? null,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      },
      lines: createdLines.map((line) => ({
        id: line.id,
        fgItemId: line.fgItemId,
        suggestedFgQty: line.suggestedFgQty,
        plannedFgQty: line.plannedFgQty,
        customerProductionQty: line.customerProductionQty,
        plannedQtyOverridden: Boolean(line.plannedQtyOverridden),
        source: line.source,
        remarks: line.remarks ?? null,
      })),
      totals: {
        ...coverage.totals,
        netRmShortageQty: rmNeed.netRmShortageQty,
        procurementRequired: rmNeed.procurementRequired,
      },
      items: coverage.items.filter((row) => Number(row.additionalRequirementQty) > ADDITIONAL_EPS),
      lineCount: createdLines.length,
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

module.exports = {
  ADDITIONAL_EPS,
  evaluateAdditionalPlanCreateEligibility,
  assessAdditionalPlanRmProcurementNeed,
  previewAdditionalPlan,
  createAdditionalPlan,
};
