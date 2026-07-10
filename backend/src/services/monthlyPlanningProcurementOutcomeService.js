/**
 * Authoritative Monthly Plan procurement handoff outcome.
 *
 * After Purchase Approval, branching is driven by the frozen RM snapshot:
 *   - netRequirementTotal > 0  → RELEASE_REQUIRED (Store releases MR to MPRS pool)
 *   - netRequirementTotal = 0  → PROCUREMENT_NOT_REQUIRED (no MR; execution-ready)
 *
 * Execution firewall continues to use `releasedAt` (set on release OR when
 * procurement is not required). No parallel workflow.
 */

const {
  canReleasePlanStatus,
  resolveRmSnapshotRevision,
} = require("./monthlyPlanningRmSnapshotService");

const RELEASE_EPS = 1e-6;

const MONTHLY_PLAN_PROCUREMENT_OUTCOME = Object.freeze({
  NOT_APPROVED: "NOT_APPROVED",
  SNAPSHOT_MISSING: "SNAPSHOT_MISSING",
  RELEASE_REQUIRED: "RELEASE_REQUIRED",
  PROCUREMENT_NOT_REQUIRED: "PROCUREMENT_NOT_REQUIRED",
  ALREADY_RELEASED: "ALREADY_RELEASED",
});

function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function sumNetRequirementTotal(lines) {
  let total = 0;
  for (const line of lines || []) {
    total = round3(total + Math.max(0, Number(line.netRequirementQty) || 0));
  }
  return total;
}

/**
 * @param {object} params
 * @param {import('@prisma/client').Prisma.TransactionClient | object} params.db
 * @param {number} params.planId
 * @param {object} [params.plan] preloaded plan header
 */
async function assessMonthlyPlanProcurementOutcome({ db, planId, plan: planInput = null } = {}) {
  const id = Number(planId);
  const plan =
    planInput ??
    (await db.monthlyProductionPlan.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        currentRevision: true,
        periodKey: true,
        planSequenceNo: true,
        planKind: true,
        releasedAt: true,
        releasedRevision: true,
        approvedAt: true,
      },
    }));

  if (!plan) {
    return {
      outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.NOT_APPROVED,
      planId: id,
      netRequirementTotal: 0,
      snapshotRevision: null,
      releasedAt: null,
      releaseRequired: false,
      procurementRequired: false,
      executionReady: false,
    };
  }

  if (!canReleasePlanStatus(plan.status)) {
    return {
      outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.NOT_APPROVED,
      planId: plan.id,
      netRequirementTotal: 0,
      snapshotRevision: null,
      releasedAt: plan.releasedAt ?? null,
      releaseRequired: false,
      procurementRequired: false,
      executionReady: Boolean(plan.releasedAt),
    };
  }

  const existingRmPlan = await db.rmPlan.findFirst({
    where: { planId: plan.id },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true },
  });
  const snapshotRevision = resolveRmSnapshotRevision(plan, existingRmPlan);
  if (snapshotRevision == null || snapshotRevision <= 0) {
    return {
      outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.SNAPSHOT_MISSING,
      planId: plan.id,
      netRequirementTotal: 0,
      snapshotRevision: null,
      releasedAt: plan.releasedAt ?? null,
      releaseRequired: false,
      procurementRequired: false,
      executionReady: Boolean(plan.releasedAt),
    };
  }

  const rmPlan = await db.rmPlan.findUnique({
    where: { planId_revision: { planId: plan.id, revision: snapshotRevision } },
    include: { lines: { select: { netRequirementQty: true } } },
  });
  if (!rmPlan) {
    return {
      outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.SNAPSHOT_MISSING,
      planId: plan.id,
      netRequirementTotal: 0,
      snapshotRevision,
      releasedAt: plan.releasedAt ?? null,
      releaseRequired: false,
      procurementRequired: false,
      executionReady: Boolean(plan.releasedAt),
    };
  }

  const netRequirementTotal = sumNetRequirementTotal(rmPlan.lines);
  const procurementRequired = netRequirementTotal > RELEASE_EPS;
  const releasedAt = plan.releasedAt ?? null;

  if (releasedAt) {
    return {
      outcome: procurementRequired
        ? MONTHLY_PLAN_PROCUREMENT_OUTCOME.ALREADY_RELEASED
        : MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED,
      planId: plan.id,
      netRequirementTotal,
      snapshotRevision,
      releasedAt,
      releaseRequired: false,
      procurementRequired,
      executionReady: true,
    };
  }

  if (procurementRequired) {
    return {
      outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.RELEASE_REQUIRED,
      planId: plan.id,
      netRequirementTotal,
      snapshotRevision,
      releasedAt: null,
      releaseRequired: true,
      procurementRequired: true,
      executionReady: false,
    };
  }

  return {
    outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED,
    planId: plan.id,
    netRequirementTotal,
    snapshotRevision,
    releasedAt: null,
    releaseRequired: false,
    procurementRequired: false,
    executionReady: true,
  };
}

/**
 * Completes the procurement handoff without creating an MR when net RM = 0.
 * Sets `releasedAt` so existing NO_QTY execution boundaries remain authoritative.
 */
async function markPlanProcurementNotRequired({
  db,
  planId,
  actorUserId = null,
  now = new Date(),
  revision = null,
} = {}) {
  const assessment = await assessMonthlyPlanProcurementOutcome({ db, planId });
  if (assessment.outcome === MONTHLY_PLAN_PROCUREMENT_OUTCOME.ALREADY_RELEASED) {
    return {
      ...assessment,
      materialRequirementId: null,
      marked: false,
    };
  }
  if (
    assessment.outcome === MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED &&
    assessment.releasedAt
  ) {
    return {
      ...assessment,
      materialRequirementId: null,
      marked: false,
    };
  }
  if (assessment.outcome !== MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED) {
    return {
      ...assessment,
      materialRequirementId: null,
      marked: false,
    };
  }

  const rev = revision ?? assessment.snapshotRevision;
  const updated = await db.monthlyProductionPlan.update({
    where: { id: Number(planId) },
    data: {
      releasedAt: now,
      releasedByUserId: actorUserId ?? null,
      ...(rev != null ? { releasedRevision: rev } : {}),
    },
  });

  return {
    outcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED,
    planId: updated.id,
    netRequirementTotal: assessment.netRequirementTotal,
    snapshotRevision: rev,
    releasedAt: updated.releasedAt,
    releaseRequired: false,
    procurementRequired: false,
    executionReady: true,
    materialRequirementId: null,
    marked: true,
  };
}

/**
 * If the approved plan has zero net RM, mark procurement not required (sets releasedAt).
 * Safe to call repeatedly; no-op when release is still required or already complete.
 */
async function completeProcurementHandoffIfNotRequired({
  db,
  planId,
  actorUserId = null,
  now = new Date(),
} = {}) {
  const assessment = await assessMonthlyPlanProcurementOutcome({ db, planId });
  if (
    assessment.outcome === MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED &&
    !assessment.releasedAt
  ) {
    return markPlanProcurementNotRequired({
      db,
      planId,
      actorUserId,
      now,
      revision: assessment.snapshotRevision,
    });
  }
  return {
    ...assessment,
    materialRequirementId: null,
    marked: false,
  };
}

module.exports = {
  RELEASE_EPS,
  MONTHLY_PLAN_PROCUREMENT_OUTCOME,
  sumNetRequirementTotal,
  assessMonthlyPlanProcurementOutcome,
  markPlanProcurementNotRequired,
  completeProcurementHandoffIfNotRequired,
};
