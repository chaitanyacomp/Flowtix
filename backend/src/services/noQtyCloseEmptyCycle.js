/**
 * NO_QTY: close an active cycle that has no requirement / WO / production / QC / dispatch / sales bill rows.
 * Closes the sales order and points currentCycleId at the previous closed cycle (or null).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ salesOrderId: number }} input
 * @returns {Promise<{ priorCycleId: number | null; closedCycleId: number; closedCycleNo: number }>}
 */
async function closeEmptyNoQtyActiveCycle(tx, { salesOrderId }) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid sales order id.");
    err.statusCode = 400;
    throw err;
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType !== "NO_QTY") {
    const err = new Error("Close cycle is allowed only for No Qty sales orders.");
    err.statusCode = 409;
    throw err;
  }
  if (so.internalStatus === "CLOSED") {
    const err = new Error("Sales order is already closed.");
    err.statusCode = 409;
    throw err;
  }

  const emptyCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : 0;
  if (!emptyCycleId || !Number.isFinite(emptyCycleId)) {
    const err = new Error("No active cycle is set on this sales order.");
    err.statusCode = 409;
    throw err;
  }

  const emptyCycle = await tx.salesOrderCycle.findFirst({
    where: { id: emptyCycleId, salesOrderId: soId },
    select: { id: true, cycleNo: true, status: true },
  });
  if (!emptyCycle) {
    const err = new Error("Current cycle not found.");
    err.statusCode = 409;
    throw err;
  }
  if (emptyCycle.status !== "ACTIVE") {
    const err = new Error("Only an active cycle can be closed this way.");
    err.statusCode = 409;
    throw err;
  }

  const block = await assertNoQtyCycleHasNoDownstream(tx, { salesOrderId: soId, cycleId: emptyCycleId });
  if (!block.ok) {
    const err = new Error(block.message);
    err.statusCode = 409;
    throw err;
  }

  const prior = await tx.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, cycleNo: emptyCycle.cycleNo - 1 },
    select: { id: true },
  });
  const priorCycleId = prior?.id ?? null;

  await tx.salesOrderCycle.update({
    where: { id: emptyCycleId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  await tx.salesOrder.update({
    where: { id: soId },
    data: {
      internalStatus: "CLOSED",
      // Do not point at a prior CLOSED cycle — Reopen / next cycle will create a fresh ACTIVE cycle.
      currentCycleId: null,
    },
  });

  return {
    priorCycleId,
    closedCycleId: emptyCycleId,
    closedCycleNo: emptyCycle.cycleNo,
  };
}

/**
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function assertNoQtyCycleHasNoDownstream(tx, { salesOrderId, cycleId }) {
  const soId = Number(salesOrderId);
  const cId = Number(cycleId);
  const msg =
    "Cannot close this cycle because it is not empty (requirement, work order, production, QC, dispatch, or sales bill exists).";

  const rs = await tx.requirementSheet.count({
    where: { salesOrderId: soId, cycleId: cId },
  });
  if (rs > 0) return { ok: false, message: msg };

  const wo = await tx.workOrder.count({
    where: { salesOrderId: soId, cycleId: cId },
  });
  if (wo > 0) return { ok: false, message: msg };

  const pe = await tx.productionEntry.count({
    where: {
      workOrderLine: {
        workOrder: { salesOrderId: soId, cycleId: cId },
      },
    },
  });
  if (pe > 0) return { ok: false, message: msg };

  const qc = await tx.qcEntry.count({
    where: {
      production: {
        workOrderLine: {
          workOrder: { salesOrderId: soId, cycleId: cId },
        },
      },
    },
  });
  if (qc > 0) return { ok: false, message: msg };

  const disp = await tx.dispatch.count({
    where: { soId: soId, cycleId: cId },
  });
  if (disp > 0) return { ok: false, message: msg };

  const bills = await tx.salesBill.count({
    where: {
      cycleId: cId,
      dispatch: { soId: soId },
    },
  });
  if (bills > 0) return { ok: false, message: msg };

  return { ok: true };
}

module.exports = {
  closeEmptyNoQtyActiveCycle,
  assertNoQtyCycleHasNoDownstream,
};
