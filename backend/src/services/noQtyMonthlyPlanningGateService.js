const { previewAdditionalPlan } = require("./monthlyPlanningAdditionalPlanService");
const { normalizePeriodKey } = require("./monthlyPlanningPeriodUtils");
const {
  buildPlanDisplayLabel,
  isActivePlanStatus,
} = require("./monthlyPlanningPlanLifecycleService");

const NO_QTY_MONTHLY_PLANNING_GATE = Object.freeze({
  INITIAL_PLAN_REQUIRED: "INITIAL_PLAN_REQUIRED",
  ADDITIONAL_PLAN_REQUIRED: "ADDITIONAL_PLAN_REQUIRED",
  PLAN_IN_PROGRESS: "PLAN_IN_PROGRESS",
  RELEASE_PENDING: "RELEASE_PENDING",
  READY_FOR_EXECUTION: "READY_FOR_EXECUTION",
});

function summarizePlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    docNo: plan.docNo ?? null,
    periodKey: plan.periodKey,
    planSequenceNo: plan.planSequenceNo,
    planKind: plan.planKind ?? null,
    status: plan.status,
    approvedAt: plan.approvedAt ?? null,
    releasedAt: plan.releasedAt ?? null,
    createdAt: plan.createdAt ?? null,
    updatedAt: plan.updatedAt ?? null,
    displayLabel: buildPlanDisplayLabel(plan),
  };
}

async function assessNoQtyMonthlyPlanningGate(db, periodKey) {
  const normalized = normalizePeriodKey(periodKey);
  const [preview, periodPlans] = await Promise.all([
    previewAdditionalPlan({ db, periodKey: normalized }),
    db.monthlyProductionPlan.findMany({
      where: { periodKey: normalized },
      orderBy: [{ planSequenceNo: "desc" }, { id: "desc" }],
      select: {
        id: true,
        docNo: true,
        periodKey: true,
        planSequenceNo: true,
        planKind: true,
        status: true,
        approvedAt: true,
        releasedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const activePlan = periodPlans.find((plan) => isActivePlanStatus(plan.status)) ?? null;
  if (activePlan) {
    return {
      gate: NO_QTY_MONTHLY_PLANNING_GATE.PLAN_IN_PROGRESS,
      periodKey: normalized,
      action: null,
      plan: summarizePlan(activePlan),
      preview,
    };
  }

  if (preview.canCreate) {
    const latestApprovedPlan =
      periodPlans.find((plan) => plan.status === "APPROVED") ?? null;
    return {
      gate: NO_QTY_MONTHLY_PLANNING_GATE.ADDITIONAL_PLAN_REQUIRED,
      periodKey: normalized,
      action: "Create Additional Monthly Plan",
      plan: summarizePlan(latestApprovedPlan),
      preview,
    };
  }

  const approvedUnreleasedPlan =
    periodPlans.find((plan) => plan.status === "APPROVED" && plan.releasedAt == null) ?? null;
  if (approvedUnreleasedPlan) {
    const {
      assessMonthlyPlanProcurementOutcome,
      completeProcurementHandoffIfNotRequired,
      MONTHLY_PLAN_PROCUREMENT_OUTCOME,
    } = require("./monthlyPlanningProcurementOutcomeService");

    const assessment = await assessMonthlyPlanProcurementOutcome({
      db,
      planId: approvedUnreleasedPlan.id,
      plan: approvedUnreleasedPlan,
    });

    if (assessment.outcome === MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED) {
      // Heal stuck zero-net approvals so execution boundaries (releasedAt) stay authoritative.
      await completeProcurementHandoffIfNotRequired({
        db,
        planId: approvedUnreleasedPlan.id,
      });
      return {
        gate: NO_QTY_MONTHLY_PLANNING_GATE.READY_FOR_EXECUTION,
        periodKey: normalized,
        action: null,
        plan: summarizePlan({ ...approvedUnreleasedPlan, releasedAt: assessment.releasedAt ?? new Date() }),
        preview,
        procurementOutcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED,
      };
    }

    if (assessment.outcome === MONTHLY_PLAN_PROCUREMENT_OUTCOME.RELEASE_REQUIRED) {
      return {
        gate: NO_QTY_MONTHLY_PLANNING_GATE.RELEASE_PENDING,
        periodKey: normalized,
        action: `Release ${buildPlanDisplayLabel(approvedUnreleasedPlan)}`,
        plan: summarizePlan(approvedUnreleasedPlan),
        preview,
        procurementOutcome: MONTHLY_PLAN_PROCUREMENT_OUTCOME.RELEASE_REQUIRED,
      };
    }

    // Snapshot missing / unexpected — keep release pending so Store can investigate.
    return {
      gate: NO_QTY_MONTHLY_PLANNING_GATE.RELEASE_PENDING,
      periodKey: normalized,
      action: `Release ${buildPlanDisplayLabel(approvedUnreleasedPlan)}`,
      plan: summarizePlan(approvedUnreleasedPlan),
      preview,
      procurementOutcome: assessment.outcome,
    };
  }

  const hasReleasedPlan = periodPlans.some((plan) => plan.status === "APPROVED" && plan.releasedAt != null);
  if (hasReleasedPlan) {
    return {
      gate: NO_QTY_MONTHLY_PLANNING_GATE.READY_FOR_EXECUTION,
      periodKey: normalized,
      action: null,
      plan: null,
      preview,
    };
  }

  return {
    gate: NO_QTY_MONTHLY_PLANNING_GATE.INITIAL_PLAN_REQUIRED,
    periodKey: normalized,
    action: "Prepare Monthly Planning — NO_QTY",
    plan: null,
    preview,
  };
}

function isNoQtyMonthlyPlanningGateExecutionReady(gate) {
  return gate?.gate === NO_QTY_MONTHLY_PLANNING_GATE.READY_FOR_EXECUTION;
}

module.exports = {
  NO_QTY_MONTHLY_PLANNING_GATE,
  assessNoQtyMonthlyPlanningGate,
  isNoQtyMonthlyPlanningGateExecutionReady,
};
