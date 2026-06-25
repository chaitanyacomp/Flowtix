/**
 * Phase P1 — Plan-document lifecycle foundation (no coverage / additional-plan logic).
 *
 * Replaces revision/reopen semantics for NEW workflows:
 *   DRAFT → AWAITING_PURCHASE_REVIEW → APPROVED
 *   AWAITING_PURCHASE_REVIEW → DRAFT (reject)
 *
 * Legacy LOCKED status and revision fields remain for backward compatibility.
 */

const { prisma } = require("../utils/prisma");

function rmSnapshotService() {
  return require("./monthlyPlanningRmSnapshotService");
}

function compositionService() {
  return require("./monthlyPlanningRequirementCompositionService");
}

function plannedQtyGuards() {
  return require("./monthlyPlanningProductionLinePlannedQty");
}

/** Lazy bind to avoid circular import with monthlyPlanningService. */
function planningCore() {
  return require("./monthlyPlanningService");
}

/** Statuses that count as the single "open" plan slot per period. */
const MONTHLY_PLAN_ACTIVE_STATUSES = Object.freeze(["DRAFT", "AWAITING_PURCHASE_REVIEW"]);

/** Statuses where FG lines must not be edited. */
const MONTHLY_PLAN_IMMUTABLE_STATUSES = Object.freeze(["APPROVED", "AWAITING_PURCHASE_REVIEW", "LOCKED"]);

const MONTHLY_PLAN_KIND = Object.freeze({
  INITIAL: "INITIAL",
  ADDITIONAL: "ADDITIONAL",
});

function isActivePlanStatus(status) {
  return MONTHLY_PLAN_ACTIVE_STATUSES.includes(String(status ?? ""));
}

function isPlanImmutableStatus(status) {
  return MONTHLY_PLAN_IMMUTABLE_STATUSES.includes(String(status ?? ""));
}

function isPlanEditableStatus(status) {
  return String(status ?? "") === "DRAFT";
}

function buildPlanDisplayLabel(plan) {
  const periodKey = String(plan?.periodKey ?? "").trim();
  const seq = Number(plan?.planSequenceNo) > 0 ? Number(plan.planSequenceNo) : 1;
  if (!periodKey) return `Plan ${seq}`;
  const [year, month] = periodKey.split("-");
  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthIdx = Number(month);
  const monthLabel = monthNames[monthIdx] || periodKey;
  return `${monthLabel} Plan ${seq}`;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | object} db
 * @param {string} periodKey
 * @param {number} [excludePlanId]
 */
async function findActivePlanInPeriod(db, periodKey, excludePlanId = null) {
  const rows = await db.monthlyProductionPlan.findMany({
    where: {
      periodKey,
      status: { in: [...MONTHLY_PLAN_ACTIVE_STATUSES] },
      ...(excludePlanId != null ? { id: { not: Number(excludePlanId) } } : {}),
    },
    select: {
      id: true,
      docNo: true,
      periodKey: true,
      planSequenceNo: true,
      planKind: true,
      status: true,
    },
    orderBy: { planSequenceNo: "asc" },
  });
  return rows[0] ?? null;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | object} db
 * @param {string} periodKey
 * @param {number} [excludePlanId]
 */
async function assertNoOtherActivePlanInPeriod(db, periodKey, excludePlanId = null) {
  const active = await findActivePlanInPeriod(db, periodKey, excludePlanId);
  if (!active) return;
  const { MonthlyPlanningError } = planningCore();
  throw new MonthlyPlanningError(
    "ACTIVE_PLAN_EXISTS",
    `Period ${periodKey} already has an open plan (${active.docNo ?? `Plan ${active.planSequenceNo}`}, ${active.status}). Finish approve or reject before creating another plan.`,
    409,
  );
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | object} db
 * @param {string} periodKey
 */
async function getNextPlanSequenceNo(db, periodKey) {
  const agg = await db.monthlyProductionPlan.aggregate({
    where: { periodKey },
    _max: { planSequenceNo: true },
  });
  const maxSeq = Number(agg?._max?.planSequenceNo ?? 0);
  return maxSeq + 1;
}

function resolvePlanKindForSequence(planSequenceNo) {
  return Number(planSequenceNo) <= 1 ? MONTHLY_PLAN_KIND.INITIAL : MONTHLY_PLAN_KIND.ADDITIONAL;
}

async function loadPlanHeader(db, planId) {
  const id = Number(planId);
  const { MonthlyPlanningError } = planningCore();
  if (!Number.isFinite(id) || id <= 0) {
    throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
  }
  const plan = await db.monthlyProductionPlan.findUnique({ where: { id } });
  if (!plan) {
    throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
  }
  return plan;
}

function assertPlanHasProductionLines(planLines) {
  const active = (planLines || []).filter((l) => Number(l.plannedFgQty) > 0);
  const { MonthlyPlanningError } = planningCore();
  if (active.length === 0) {
    throw new MonthlyPlanningError(
      "EMPTY_PLAN",
      "Plan must have at least one Production Plan line with planned qty > 0.",
      422,
    );
  }
}

/**
 * DRAFT → AWAITING_PURCHASE_REVIEW (submit for Purchase review).
 * Does not create RM snapshots (legacy lock path unchanged).
 */
async function submitPlanForPurchaseReview({
  db = prisma,
  planId,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  confirmPlannedBelowSuggested = false,
  now = new Date(),
  loadComposition,
} = {}) {
  const loadCompositionFn = loadComposition ?? compositionService().getRequirementComposition;
  const run = async (tx) => {
    const { MonthlyPlanningError, assertPeriodWriteAllowed } = planningCore();
    const plan = await loadPlanHeader(tx, planId);
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now,
    });
    if (!isPlanEditableStatus(plan.status)) {
      throw new MonthlyPlanningError(
        "PLAN_NOT_SUBMITTABLE",
        "Only DRAFT plans can be submitted for Purchase review.",
        409,
      );
    }

    const composition = await loadCompositionFn({ db: tx, periodKey: plan.periodKey });
    const { syncNonOverriddenPlanLinesToSuggested, findGreenShortagePlannedBelowSuggested } =
      plannedQtyGuards();
    await syncNonOverriddenPlanLinesToSuggested(tx, plan.id, composition);

    const planLines = await tx.monthlyProductionPlanLine.findMany({
      where: { planId: plan.id },
      select: { fgItemId: true, plannedFgQty: true, plannedQtyOverridden: true },
    });
    assertPlanHasProductionLines(planLines);

    const violations = findGreenShortagePlannedBelowSuggested({ lines: planLines, composition });
    const staleViolations = violations.filter((v) => !v.plannedQtyOverridden);
    if (staleViolations.length > 0) {
      throw new MonthlyPlanningError(
        "PLANNED_BELOW_SUGGESTED",
        "One or more FG lines are below suggested production including Green Shortage. Save the plan or remove manual overrides before submitting.",
        422,
      );
    }
    const overriddenViolations = violations.filter((v) => v.plannedQtyOverridden);
    if (overriddenViolations.length > 0 && !confirmPlannedBelowSuggested) {
      throw new MonthlyPlanningError(
        "PLANNED_BELOW_SUGGESTED_CONFIRM_REQUIRED",
        "Planned quantity is below suggested production for one or more FG items with Green Shortage. Confirm to submit with the lower planned qty.",
        422,
      );
    }

    await assertNoOtherActivePlanInPeriod(tx, plan.periodKey, plan.id);

    const updated = await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: "AWAITING_PURCHASE_REVIEW",
        lockedAt: now,
        lockedByUserId: actorUserId ?? null,
        purchaseRejectReason: null,
      },
    });

    return {
      planId: updated.id,
      status: updated.status,
      periodKey: updated.periodKey,
      planSequenceNo: updated.planSequenceNo,
      planKind: updated.planKind,
      displayLabel: buildPlanDisplayLabel(updated),
      lockedAt: updated.lockedAt,
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

/**
 * AWAITING_PURCHASE_REVIEW → APPROVED (permanent freeze for plan document).
 */
async function purchaseApprovePlan({
  db = prisma,
  planId,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  confirmPlannedBelowSuggested = false,
  now = new Date(),
  deps = {},
  loadComposition,
} = {}) {
  const loadCompositionFn = loadComposition ?? compositionService().getRequirementComposition;
  const run = async (tx) => {
    const { MonthlyPlanningError, assertPeriodWriteAllowed } = planningCore();
    const plan = await loadPlanHeader(tx, planId);
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now,
    });
    if (plan.status !== "AWAITING_PURCHASE_REVIEW") {
      throw new MonthlyPlanningError(
        "PLAN_NOT_APPROVABLE",
        "Only plans awaiting Purchase review can be approved.",
        409,
      );
    }

    const composition = await loadCompositionFn({ db: tx, periodKey: plan.periodKey });
    const { syncNonOverriddenPlanLinesToSuggested, findGreenShortagePlannedBelowSuggested } =
      plannedQtyGuards();
    await syncNonOverriddenPlanLinesToSuggested(tx, plan.id, composition);

    const planLines = await tx.monthlyProductionPlanLine.findMany({
      where: { planId: plan.id },
      select: { fgItemId: true, plannedFgQty: true, plannedQtyOverridden: true },
    });
    const violations = findGreenShortagePlannedBelowSuggested({ lines: planLines, composition });
    const staleViolations = violations.filter((v) => !v.plannedQtyOverridden);
    if (staleViolations.length > 0) {
      throw new MonthlyPlanningError(
        "PLANNED_BELOW_SUGGESTED",
        "One or more FG lines are below suggested production including Green Shortage after sync. Reject the plan so Store can resubmit.",
        409,
      );
    }
    if (violations.length > 0 && !confirmPlannedBelowSuggested) {
      throw new MonthlyPlanningError(
        "PLANNED_BELOW_SUGGESTED_CONFIRM_REQUIRED",
        "Planned quantity is below suggested production for FG items with Green Shortage. Confirm approval with the lower planned qty.",
        422,
      );
    }

    const updated = await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: "APPROVED",
        approvedAt: now,
        approvedByUserId: actorUserId ?? null,
        purchaseReviewedAt: now,
        purchaseReviewedByUserId: actorUserId ?? null,
        purchaseRejectReason: null,
      },
    });

    const snapshot = await rmSnapshotService().ensureApprovedPlanRmSnapshot({
      db: tx,
      planId: updated.id,
      actorUserId,
      asOf: now,
      deps,
    });

    return {
      planId: updated.id,
      status: updated.status,
      periodKey: updated.periodKey,
      planSequenceNo: updated.planSequenceNo,
      planKind: updated.planKind,
      displayLabel: buildPlanDisplayLabel(updated),
      approvedAt: updated.approvedAt,
      rmSnapshot: {
        revision: snapshot.revision,
        rmPlanId: snapshot.rmPlanId,
        created: snapshot.created,
        lineCount: snapshot.lineCount,
      },
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

/**
 * AWAITING_PURCHASE_REVIEW → DRAFT (reject with reason).
 */
async function purchaseRejectPlan({
  db = prisma,
  planId,
  reason,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  now = new Date(),
} = {}) {
  const { MonthlyPlanningError } = planningCore();
  const rejectReason = String(reason ?? "").trim();
  if (!rejectReason) {
    throw new MonthlyPlanningError("REJECT_REASON_REQUIRED", "Purchase reject reason is required.", 422);
  }

  const run = async (tx) => {
    const { MonthlyPlanningError, assertPeriodWriteAllowed } = planningCore();
    const plan = await loadPlanHeader(tx, planId);
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now,
    });
    if (plan.status !== "AWAITING_PURCHASE_REVIEW") {
      throw new MonthlyPlanningError(
        "PLAN_NOT_REJECTABLE",
        "Only plans awaiting Purchase review can be rejected.",
        409,
      );
    }

    const updated = await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: "DRAFT",
        purchaseRejectReason: rejectReason.slice(0, 2000),
        purchaseReviewedAt: now,
        purchaseReviewedByUserId: actorUserId ?? null,
        lockedAt: null,
        lockedByUserId: null,
      },
    });

    return {
      planId: updated.id,
      status: updated.status,
      periodKey: updated.periodKey,
      planSequenceNo: updated.planSequenceNo,
      planKind: updated.planKind,
      displayLabel: buildPlanDisplayLabel(updated),
      purchaseRejectReason: updated.purchaseRejectReason,
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

/**
 * Permanently remove a DRAFT plan document (Store-owned). Returns period to no-plan state.
 * Legacy reopen drafts must use cancelReopenMonthlyPlan instead.
 */
async function discardMonthlyPlanDraft({
  db = prisma,
  planId,
  actorRole = null,
  confirmPastPeriod = false,
  now = new Date(),
} = {}) {
  const run = async (tx) => {
    const { MonthlyPlanningError, assertPeriodWriteAllowed } = planningCore();
    const plan = await loadPlanHeader(tx, planId);
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now,
    });
    if (!isPlanEditableStatus(plan.status)) {
      throw new MonthlyPlanningError(
        "PLAN_NOT_DISCARDABLE",
        "Only DRAFT plans can be discarded. Submitted or approved plans cannot be deleted.",
        409,
      );
    }
    if (plan.reopenedAt != null && Number(plan.currentRevision) >= 1) {
      throw new MonthlyPlanningError(
        "USE_CANCEL_REOPEN",
        "This is a legacy reopened draft. Use Cancel Reopen to restore the locked plan instead of discarding.",
        409,
      );
    }

    const linkedMr = await tx.materialRequirement.findFirst({
      where: { monthlyProductionPlanId: plan.id },
      select: { id: true },
    });
    if (linkedMr?.id) {
      throw new MonthlyPlanningError(
        "PLAN_NOT_DISCARDABLE",
        "This draft is linked to procurement records and cannot be discarded.",
        409,
      );
    }

    await tx.monthlyProductionPlan.delete({ where: { id: plan.id } });
    return {
      discarded: true,
      planId: plan.id,
      periodKey: plan.periodKey,
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

/**
 * Pick the plan the legacy period workspace should load by default.
 * Prefers an active plan; otherwise highest planSequenceNo.
 */
function selectPrimaryPlanForPeriod(plans) {
  const list = Array.isArray(plans) ? plans : [];
  if (!list.length) return null;
  const active = list.find((p) => isActivePlanStatus(p.status));
  if (active) return active;
  return [...list].sort((a, b) => Number(b.planSequenceNo) - Number(a.planSequenceNo))[0];
}

module.exports = {
  MONTHLY_PLAN_ACTIVE_STATUSES,
  MONTHLY_PLAN_IMMUTABLE_STATUSES,
  MONTHLY_PLAN_KIND,
  isActivePlanStatus,
  isPlanImmutableStatus,
  isPlanEditableStatus,
  buildPlanDisplayLabel,
  findActivePlanInPeriod,
  assertNoOtherActivePlanInPeriod,
  getNextPlanSequenceNo,
  resolvePlanKindForSequence,
  submitPlanForPurchaseReview,
  purchaseApprovePlan,
  purchaseRejectPlan,
  discardMonthlyPlanDraft,
  selectPrimaryPlanForPeriod,
};
