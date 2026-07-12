/**
 * Runtime acceptance: Additional Plan Save preserves 16,768 and Submit stays eligible.
 */
const { prisma } = require("../src/utils/prisma");
const {
  createAdditionalPlan,
  previewAdditionalPlan,
} = require("../src/services/monthlyPlanningAdditionalPlanService");
const { updateProductionLines, getProductionLines } = require("../src/services/monthlyPlanningService");
const {
  submitPlanForPurchaseReview,
  discardMonthlyPlanDraft,
  purchaseRejectPlan,
} = require("../src/services/monthlyPlanningPlanLifecycleService");
const { getRmPlanningEstimate } = require("../src/services/monthlyPlanningRmEstimateService");

async function main() {
  const periodKey = "2026-07";

  const existingDraft = await prisma.monthlyProductionPlan.findFirst({
    where: { periodKey, status: "DRAFT", planKind: "ADDITIONAL" },
  });
  if (existingDraft) {
    await discardMonthlyPlanDraft({
      db: prisma,
      planId: existingDraft.id,
      actorRole: "STORE",
      confirmPastPeriod: true,
    });
  }

  // Clear awaiting-review Additional plans from prior probes so create can run.
  const awaitingPlans = await prisma.monthlyProductionPlan.findMany({
    where: { periodKey, status: "AWAITING_PURCHASE_REVIEW", planKind: "ADDITIONAL" },
  });
  for (const awaiting of awaitingPlans) {
    await purchaseRejectPlan({
      db: prisma,
      planId: awaiting.id,
      actorRole: "PURCHASE",
      confirmPastPeriod: true,
      reason: "acceptance cleanup",
    });
    await discardMonthlyPlanDraft({
      db: prisma,
      planId: awaiting.id,
      actorRole: "STORE",
      confirmPastPeriod: true,
    });
  }

  const preview = await previewAdditionalPlan({ db: prisma, periodKey });
  if (!preview.canCreate) {
    console.log(
      JSON.stringify({ error: "cannot create", blocking: preview.blockingCode, preview }, null, 2),
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const created = await createAdditionalPlan({
    db: prisma,
    periodKey,
    actorUserId: null,
    actorRole: "STORE",
    confirmPastPeriod: true,
  });
  const planId = created.plan.id;

  const before = await getProductionLines({ db: prisma, planId });

  async function saveOnce(label) {
    const lines = await prisma.monthlyProductionPlanLine.findMany({ where: { planId } });
    const upserts = lines.map((l) => ({
      fgItemId: l.fgItemId,
      plannedFgQty: Number(l.customerProductionQty ?? l.plannedFgQty) + Number(l.greenReplenishmentQty ?? 0),
      customerProductionQty: Number(l.customerProductionQty ?? l.plannedFgQty),
      greenReplenishmentQty: Number(l.greenReplenishmentQty ?? 0),
      plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
      source: l.source ?? "REQUIREMENT_SHEET",
    }));
    const saved = await updateProductionLines({
      db: prisma,
      planId,
      upserts,
      deletes: [],
      actorRole: "STORE",
      confirmPastPeriod: true,
    });
    return {
      label,
      lines: saved.lines.map((l) => ({
        plannedFgQty: l.plannedFgQty,
        suggestedFgQty: l.suggestedFgQty,
        customerProductionQty: l.customerProductionQty,
        plannedQtyOverridden: l.plannedQtyOverridden,
      })),
      hasSaveableLines: saved.lines.some((l) => Number(l.plannedFgQty) > 0),
    };
  }

  const save1 = await saveOnce("save1");
  const save2 = await saveOnce("save2");
  const save3 = await saveOnce("save3");
  const afterReload = await getProductionLines({ db: prisma, planId });

  let rmEstimate = null;
  try {
    rmEstimate = await getRmPlanningEstimate({ db: prisma, planId });
  } catch (e) {
    rmEstimate = { error: e.message };
  }

  const submitted = await submitPlanForPurchaseReview({
    db: prisma,
    planId,
    actorUserId: null,
    actorRole: "STORE",
    confirmPastPeriod: true,
  });

  const out = {
    previewTotals: preview.totals,
    created: {
      planId,
      status: created.plan.status,
      planKind: created.plan.planKind,
      displayLabel: created.plan.displayLabel,
      lines: created.lines,
    },
    before: before.lines.map((l) => ({
      plannedFgQty: l.plannedFgQty,
      suggestedFgQty: l.suggestedFgQty,
      customerProductionQty: l.customerProductionQty,
    })),
    save1,
    save2,
    save3,
    afterReload: {
      status: afterReload.status,
      lines: afterReload.lines.map((l) => ({
        plannedFgQty: l.plannedFgQty,
        suggestedFgQty: l.suggestedFgQty,
        customerProductionQty: l.customerProductionQty,
      })),
      hasSaveableLines: afterReload.lines.some((l) => Number(l.plannedFgQty) > 0),
    },
    rmEstimateSummary: rmEstimate?.error
      ? rmEstimate
      : {
          planId: rmEstimate?.planId,
          lineCount: Array.isArray(rmEstimate?.lines) ? rmEstimate.lines.length : null,
          totalPlannedFgQty: afterReload.lines.reduce((s, l) => s + Number(l.plannedFgQty || 0), 0),
        },
    submitted: {
      status: submitted?.plan?.status ?? submitted?.status,
      planId,
    },
  };

  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();

  const ok =
    Number(save1.lines[0]?.plannedFgQty) === 16768 &&
    Number(save3.lines[0]?.plannedFgQty) === 16768 &&
    out.afterReload.hasSaveableLines === true &&
    String(out.submitted.status || "") === "AWAITING_PURCHASE_REVIEW";
  if (!ok) {
    console.error("ACCEPTANCE_FAILED", {
      save1: save1.lines[0],
      save3: save3.lines[0],
      hasSaveableLines: out.afterReload.hasSaveableLines,
      submittedStatus: out.submitted.status,
    });
    process.exit(2);
  }
  console.error("ACCEPTANCE_OK");
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch (_) {}
  process.exit(1);
});
