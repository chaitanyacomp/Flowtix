/**
 * P0 — Pipeline firewall: NO_QTY procurement demand must originate from MPRS / MONTHLY_PLAN only.
 * WO, RS, and SO must not create operational procurement demand for NO_QTY orders.
 */

const NO_QTY_PROCUREMENT_DEMAND_CODE = "NO_QTY_PROCUREMENT_DEMAND_BLOCKED";

function isNoQtyOrderType(orderType) {
  return String(orderType ?? "").trim() === "NO_QTY";
}

function assertNoQtyWoProcurementDemandBlocked(orderType) {
  if (!isNoQtyOrderType(orderType)) return;
  const err = new Error(
    "NO_QTY sales orders cannot create procurement demand from Work Orders. Release demand from Monthly Planning (MPRS) only.",
  );
  err.statusCode = 403;
  err.code = NO_QTY_PROCUREMENT_DEMAND_CODE;
  throw err;
}

async function assertWorkOrderProcurementDemandAllowed(db, workOrderId) {
  const id = Number(workOrderId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error("workOrderId is required.");
    err.statusCode = 400;
    throw err;
  }
  const wo = await db.workOrder.findUnique({
    where: { id },
    select: {
      id: true,
      salesOrderId: true,
      salesOrder: { select: { id: true, orderType: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  assertNoQtyWoProcurementDemandBlocked(wo.salesOrder?.orderType);
  return wo;
}

module.exports = {
  NO_QTY_PROCUREMENT_DEMAND_CODE,
  isNoQtyOrderType,
  assertNoQtyWoProcurementDemandBlocked,
  assertWorkOrderProcurementDemandAllowed,
};
