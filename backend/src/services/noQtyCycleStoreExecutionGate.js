/**
 * P15-C2 — Store pending-action read model only.
 * Suppresses "Create next cycle RS" while the current NO_QTY cycle still has open execution work.
 */

const {
  buildStoreIssuePendingDashboardRows,
  buildStoreProductionHandoffDashboardRows,
} = require("./materialAvailabilityWorkspaceService");
const { assessNoQtyPlacementStageForCycle } = require("./requirementSheetExecutionService");

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ salesOrderId: number; cycleId: number }} input
 */
async function isNoQtyCycleStoreExecutionIncomplete(db, input) {
  const salesOrderId = Number(input?.salesOrderId);
  const cycleId = Number(input?.cycleId);
  if (!(salesOrderId > 0 && cycleId > 0)) return false;

  const cycleWos = await db.workOrder.findMany({
    where: {
      salesOrderId,
      cycleId,
      status: { notIn: ["REJECTED", "COMPLETED"] },
    },
    select: { id: true },
  });
  const woIds = [...new Set(cycleWos.map((wo) => Number(wo.id)).filter((id) => id > 0))];
  if (!woIds.length) return false;

  const woIdSet = new Set(woIds);
  const rowOnCycle = (row) => woIdSet.has(Number(row?.workOrderId ?? 0));

  const [issueRows, handoffRows, placement] = await Promise.all([
    buildStoreIssuePendingDashboardRows(db),
    buildStoreProductionHandoffDashboardRows(db),
    assessNoQtyPlacementStageForCycle(db, { salesOrderId, cycleId }).catch(() => ({ readyToPlaceWo: false })),
  ]);

  if (issueRows.some(rowOnCycle)) return true;
  if (handoffRows.some(rowOnCycle)) return true;
  if (Boolean(placement?.readyToPlaceWo)) return true;

  const waitingIssuePmr = await db.productionMaterialRequest.findFirst({
    where: {
      workOrderId: { in: woIds },
      status: { in: ["REQUESTED", "PARTIALLY_ISSUED"] },
    },
    select: { id: true },
  });
  if (waitingIssuePmr) return true;

  const productionDraft = await db.productionEntry.findFirst({
    where: {
      workOrderLine: { workOrderId: { in: woIds } },
      workflowStatus: "DRAFT",
    },
    select: { id: true },
  });
  if (productionDraft) return true;

  const openExecution = await db.workOrderProductionExecution.findFirst({
    where: {
      workOrderId: { in: woIds },
      status: { notIn: ["COMPLETED"] },
    },
    select: { id: true },
  });
  if (openExecution) return true;

  const approvedWithoutQc = await db.productionEntry.findFirst({
    where: {
      workOrderLine: { workOrderId: { in: woIds } },
      workflowStatus: "APPROVED",
      qcEntries: { none: { reversedAt: null } },
    },
    select: { id: true },
  });
  if (approvedWithoutQc) return true;

  const qcOnCycle = await db.qcEntry.findFirst({
    where: {
      reversedAt: null,
      production: { workOrderLine: { workOrder: { salesOrderId, cycleId } } },
    },
    select: { id: true },
  });
  if (qcOnCycle) {
    const dispatchFinalized = await db.dispatch.findFirst({
      where: {
        soId: salesOrderId,
        cycleId,
        workflowStatus: "LOCKED",
        reversalOfId: null,
      },
      select: { id: true },
    });
    if (!dispatchFinalized) return true;
  }

  return false;
}

module.exports = {
  isNoQtyCycleStoreExecutionIncomplete,
};
