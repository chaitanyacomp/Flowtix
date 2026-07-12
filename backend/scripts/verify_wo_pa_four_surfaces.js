const { prisma } = require("../src/utils/prisma");
const { getRequirementSheetExecutionSummary } = require("../src/services/requirementSheetExecutionService");
const { fetchStoreNoQtyPlaceWoPendingActions } = require("../src/services/pendingActionsService");
const { getNoQtyPlanningInbox } = require("../src/services/noQtyPlanningInboxService");

async function main() {
  const summary = await getRequirementSheetExecutionSummary(prisma, 335);
  const summaryActive = await getRequirementSheetExecutionSummary(prisma, 336);
  const wo = await fetchStoreNoQtyPlaceWoPendingActions(prisma);
  const soWo = wo.filter((a) => Number(a.metadata?.salesOrderId) === 224);
  const inbox = await getNoQtyPlanningInbox(prisma);
  const rows = Array.isArray(inbox) ? inbox : inbox?.rows || [];
  const row = rows.find(
    (r) => Number(r.salesOrderId) === 224 || r.placementRequirementSheetNo === "RS-26-0002",
  );

  const ok =
    Number(summary?.totals?.rsBalanceQty) === 11069 &&
    Number(summary?.placement?.summary?.totalExecutableQty) === 11069 &&
    soWo.length === 1 &&
    Number(soWo[0]?.metadata?.suggestedExecutableQty) === 11069 &&
    Number(row?.rsBalanceQty) === 11069 &&
    row?.actionNeededLabel === "Create Suggested WO";

  console.log(
    JSON.stringify(
      {
        ok,
        rsExecution_RS26_0002: {
          rsBalance: summary?.totals?.rsBalanceQty,
          suggested: summary?.placement?.summary?.totalExecutableQty,
          readiness: summary?.readiness?.status,
          placement: summary?.placement?.status,
        },
        rsExecution_RS26_0003_activeCycle_explainsUiZero: {
          rsBalance: summaryActive?.totals?.rsBalanceQty,
          suggested: summaryActive?.placement?.summary?.totalExecutableQty,
          readiness: summaryActive?.readiness?.status,
          placement: summaryActive?.placement?.status,
        },
        storePaWo: soWo.map((a) => ({
          action: a.action,
          documentNo: a.documentNo,
          qty: a.metadata?.suggestedExecutableQty,
          rs: a.metadata?.requirementSheetDocNo,
          href: a.href,
        })),
        register: row
          ? {
              rs: row.placementRequirementSheetNo,
              bal: row.rsBalanceQty,
              sug: row.suggestedWoQty,
              rm: row.rmCoverageStatus,
              action: row.actionNeededLabel,
              listCycleNo: row.currentCycleNo ?? row.cycleNo,
              href: row.executionWorkspaceHref,
            }
          : null,
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
