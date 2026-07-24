const { QUEUE_EPS } = require("./rmPurchaseHelpers");
const { regularSoProcurementSourceTypes } = require("./regularSoProcurementSource");

const TERMINAL_WO_STATUSES = new Set([
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "CLOSED",
  "CLOSED_WITH_SHORTFALL",
]);
const RECONCILABLE_MR_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_PURCHASE"];
const AUDIT_REASON =
  "Automatically satisfied: Regular SO customer quantity is covered by valid QC-approved production; no active customer production demand remains.";

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateRegularSoProcurementDemandState(so) {
  if (!so || so.orderType === "NO_QTY" || (so.orderType && so.orderType !== "NORMAL")) {
    return { applies: false, hasGenuineDemand: true, lines: [] };
  }

  const acceptedByItemId = new Map();
  for (const wo of so.workOrders || []) {
    for (const line of wo.lines || []) {
      for (const production of line.productions || []) {
        if (production.workflowStatus !== "APPROVED") continue;
        for (const qc of production.qcEntries || []) {
          if (qc.reversedAt) continue;
          acceptedByItemId.set(
            line.fgItemId,
            (acceptedByItemId.get(line.fgItemId) || 0) + Math.max(0, n(qc.acceptedQty)),
          );
        }
      }
    }
  }

  const dispatchedByItemId = new Map();
  for (const row of so.dispatch || []) {
    if (row.workflowStatus !== "LOCKED") continue;
    dispatchedByItemId.set(
      row.itemId,
      (dispatchedByItemId.get(row.itemId) || 0) + n(row.dispatchedQty),
    );
  }

  const lines = (so.lines || [])
    .filter((line) => !line.item || line.item.itemType === "FG")
    .map((line) => {
      const orderedQty = Math.max(0, n(line.customerPoQty ?? line.qty));
      const qcAcceptedQty = Math.max(0, acceptedByItemId.get(line.itemId) || 0);
      const dispatchedQty = Math.max(0, dispatchedByItemId.get(line.itemId) || 0);
      const fulfilledQty = Math.max(qcAcceptedQty, dispatchedQty);
      const outstandingCustomerQty = Math.max(0, orderedQty - fulfilledQty);
      const activeWoPlannedQty = (so.workOrders || [])
        .filter((wo) => !TERMINAL_WO_STATUSES.has(String(wo.status || "")))
        .flatMap((wo) => wo.lines || [])
        .filter((woLine) => Number(woLine.fgItemId) === Number(line.itemId))
        .reduce((sum, woLine) => sum + Math.max(0, n(woLine.qty)), 0);
      return {
        salesOrderLineId: line.id,
        itemId: line.itemId,
        orderedQty,
        dispatchedQty,
        qcAcceptedQty,
        outstandingCustomerQty,
        activeWoPlannedQty,
        genuineProductionDemandQty: Math.min(outstandingCustomerQty, Math.max(outstandingCustomerQty, activeWoPlannedQty)),
      };
    });

  return {
    applies: true,
    hasGenuineDemand: lines.some((line) => line.genuineProductionDemandQty > QUEUE_EPS),
    lines,
  };
}

async function loadRegularSoProcurementDemandState(db, salesOrderId) {
  const so = await db.salesOrder.findUnique({
    where: { id: Number(salesOrderId) },
    include: {
      lines: { include: { item: { select: { itemType: true } } } },
      dispatch: true,
      workOrders: {
        include: {
          lines: {
            include: {
              productions: {
                where: { workflowStatus: "APPROVED" },
                include: { qcEntries: true },
              },
            },
          },
        },
      },
    },
  });
  return calculateRegularSoProcurementDemandState(so);
}

async function reconcileRegularSoResidualMaterialRequirements(db, salesOrderId) {
  const demand = await loadRegularSoProcurementDemandState(db, salesOrderId);
  if (!demand.applies || demand.hasGenuineDemand) {
    return { demand, closedMaterialRequirementIds: [], reviewRequiredMaterialRequirementIds: [] };
  }

  const materialRequirements = await db.materialRequirement.findMany({
    where: {
      salesOrderId: Number(salesOrderId),
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: RECONCILABLE_MR_STATUSES },
    },
    include: {
      lines: {
        include: {
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: { select: { status: true } },
                  poLinks: { select: { id: true } },
                },
              },
            },
          },
          procurementLinks: { select: { id: true } },
        },
      },
    },
  });

  const closedMaterialRequirementIds = [];
  const reviewRequiredMaterialRequirementIds = [];
  for (const mr of materialRequirements) {
    const hasExternalProcurement = (mr.lines || []).some((line) =>
      (line.procurementLinks || []).length > 0 ||
      (line.purchaseRequestSourceLinks || []).some(
        (link) =>
          link.purchaseRequestLine?.purchaseRequest?.status !== "CANCELLED" ||
          (link.purchaseRequestLine?.poLinks || []).length > 0,
      ),
    );
    if (hasExternalProcurement) {
      reviewRequiredMaterialRequirementIds.push(mr.id);
      continue;
    }
    await db.materialRequirement.update({
      where: { id: mr.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        approvalRemarks: AUDIT_REASON,
      },
    });
    closedMaterialRequirementIds.push(mr.id);
  }

  return { demand, closedMaterialRequirementIds, reviewRequiredMaterialRequirementIds };
}

module.exports = {
  AUDIT_REASON,
  calculateRegularSoProcurementDemandState,
  loadRegularSoProcurementDemandState,
  reconcileRegularSoResidualMaterialRequirements,
};
