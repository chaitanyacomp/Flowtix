/**
 * Acceptance: Plan 3 (16,768) vs WO readiness (11,069) identity map + deep-link stability.
 */
const { prisma } = require("../src/utils/prisma");
const { fetchStoreNoQtyPlaceWoPendingActions } = require("../src/services/pendingActionsService");
const { getNoQtyPlanningInbox } = require("../src/services/noQtyPlanningInboxService");
const { getRequirementSheetExecutionSummary } = require("../src/services/requirementSheetExecutionService");

function preserveRequirementSheetHref(href) {
  const url = new URL(href, "http://erp.local");
  const params = new URLSearchParams();
  for (const key of [
    "returnTo",
    "from",
    "source",
    "focus",
    "sheetId",
    "requirementSheetId",
    "cycleId",
    "salesOrderId",
  ]) {
    const v = url.searchParams.get(key);
    if (v != null && v !== "") params.set(key, v);
  }
  return `${url.pathname}?${params.toString()}`;
}

async function main() {
  const pa = (await fetchStoreNoQtyPlaceWoPendingActions(prisma)).find(
    (a) => Number(a.metadata?.salesOrderId) === 224,
  );
  const inbox = await getNoQtyPlanningInbox(prisma);
  const rows = Array.isArray(inbox) ? inbox : inbox?.rows || [];
  const reg = rows.find((r) => Number(r.salesOrderId) === 224);
  const exec = await getRequirementSheetExecutionSummary(prisma, 335);
  const execWrong = await getRequirementSheetExecutionSummary(prisma, 336);
  const coverage = await prisma.monthlyPlanRequirementCoverage.findMany({ where: { planId: 86 } });
  const plan = await prisma.monthlyProductionPlan.findUnique({
    where: { id: 86 },
    include: { lines: true },
  });

  const openHref = pa?.href ?? "";
  const afterBucketStrip = preserveRequirementSheetHref(openHref);
  const sheetId = new URL(openHref, "http://erp.local").searchParams.get("sheetId");
  const cycleId = new URL(openHref, "http://erp.local").searchParams.get("cycleId");

  const planQty = Number(plan?.lines?.[0]?.plannedFgQty ?? 0);
  const coverageSum = coverage.reduce((s, c) => s + Number(c.coveredQty || 0), 0);
  const rs2Balance = Number(exec?.totals?.rsBalanceQty ?? 0);
  const suggested = Number(exec?.placement?.summary?.totalExecutableQty ?? 0);

  const ok =
    planQty === 16768 &&
    Math.abs(coverageSum - 16768) < 0.01 &&
    rs2Balance === 11069 &&
    suggested === 11069 &&
    sheetId === "335" &&
    cycleId === "382" &&
    afterBucketStrip.includes("sheetId=335") &&
    afterBucketStrip.includes("cycleId=382") &&
    Number(reg?.rsBalanceQty) === 11069 &&
    Number(pa?.metadata?.suggestedExecutableQty) === 11069 &&
    Number(execWrong?.totals?.rsBalanceQty) === 0;

  console.log(
    JSON.stringify(
      {
        ok,
        plan3: { plannedFgQty: planQty, coverageSum, components: coverage.map((c) => ({
          type: c.componentType,
          coveredQty: Number(c.coveredQty),
          rsId: c.requirementSheetId,
          cycleNo: c.cycleNo,
        })) },
        formula_11069: {
          rs: "RS-26-0002",
          requirementQty: 60000,
          woPlaced: 48931,
          rsBalance: "60000 - 48931 = 11069",
          note: "Plan 3 16,768 is procurement coverage across RS-2/RS-3 components; not RS balance",
        },
        pendingAction: {
          action: pa?.action,
          metadata: pa?.metadata,
          href: openHref,
          afterListHrefPreserve: afterBucketStrip,
        },
        register: {
          rs: reg?.placementRequirementSheetNo,
          bal: reg?.rsBalanceQty,
          sug: reg?.suggestedWoQty,
          href: reg?.executionWorkspaceHref,
        },
        rsExecution_335: { bal: rs2Balance, sug: suggested },
        rsExecution_336_active: {
          bal: execWrong?.totals?.rsBalanceQty,
          sug: execWrong?.placement?.summary?.totalExecutableQty,
        },
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 2;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
