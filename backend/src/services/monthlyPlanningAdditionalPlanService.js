/**
 * Phase P3 — Additional plan preview & creation (delta-only plan documents).
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

const ADDITIONAL_EPS = 1e-6;

function planningCore() {
  return require("./monthlyPlanningService");
}

/**
 * @param {{
 *   approvedPlanCount: number;
 *   activePlan: object | null;
 *   totalAdditionalRequirementQty: number;
 * }} input
 */
function evaluateAdditionalPlanCreateEligibility({
  approvedPlanCount,
  activePlan,
  totalAdditionalRequirementQty,
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
} = {}) {
  const { normalizePeriodKey } = planningCore();
  const normalized = normalizePeriodKey(periodKey);

  const [coverage, activePlan, nextPlanSequenceNo] = await Promise.all([
    getPeriodRequirementCoverage({ db, periodKey: normalized, loadRequirementComposition }),
    findActivePlanInPeriod(db, normalized),
    getNextPlanSequenceNo(db, normalized),
  ]);

  const eligibility = evaluateAdditionalPlanCreateEligibility({
    approvedPlanCount: coverage.approvedPlanCount,
    activePlan,
    totalAdditionalRequirementQty: coverage.totals.totalAdditionalRequirementQty,
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
    totals: coverage.totals,
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
    const eligibility = evaluateAdditionalPlanCreateEligibility({
      approvedPlanCount: coverage.approvedPlanCount,
      activePlan,
      totalAdditionalRequirementQty: coverage.totals.totalAdditionalRequirementQty,
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

    const lineRemark = "Additional requirement from coverage calculation";
    const createdLines = [];
    for (const row of deltaItems) {
      const line = await tx.monthlyProductionPlanLine.create({
        data: {
          planId: plan.id,
          fgItemId: row.fgItemId,
          plannedFgQty: row.additionalRequirementQty,
          suggestedFgQty: row.currentRequirementQty,
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
        plannedQtyOverridden: Boolean(line.plannedQtyOverridden),
        source: line.source,
        remarks: line.remarks ?? null,
      })),
      totals: coverage.totals,
      lineCount: createdLines.length,
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

module.exports = {
  ADDITIONAL_EPS,
  evaluateAdditionalPlanCreateEligibility,
  previewAdditionalPlan,
  createAdditionalPlan,
};
