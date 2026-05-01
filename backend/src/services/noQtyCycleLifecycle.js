/**
 * NO_QTY only: SalesOrderCycle is the source of truth for cycles.
 * Repairs stale SalesOrder.currentCycleId and duplicate ACTIVE cycles.
 */

const auditLog = require("./auditLog");

/**
 * Normalize duplicate ACTIVE cycles: keep exactly one (highest cycleNo), close others.
 * If SO.currentCycleId points to a CLOSED cycle or missing row, repoint to the sole ACTIVE or null.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @returns {Promise<{ repaired: boolean; keptActiveCycleId: number | null; closedDuplicateIds: number[] }>}
 */
async function repairNoQtyCycleIntegrity(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    return { repaired: false, keptActiveCycleId: null, closedDuplicateIds: [] };
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    return { repaired: false, keptActiveCycleId: null, closedDuplicateIds: [] };
  }

  let repaired = false;
  const closedDuplicateIds = [];

  const actives = await tx.salesOrderCycle.findMany({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "asc" },
    select: { id: true, cycleNo: true },
  });

  if (actives.length > 1) {
    const keep = actives[actives.length - 1];
    const toClose = actives.filter((c) => c.id !== keep.id).map((c) => c.id);
    if (toClose.length) {
      await tx.salesOrderCycle.updateMany({
        where: { id: { in: toClose }, salesOrderId: soId },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      closedDuplicateIds.push(...toClose);
      repaired = true;
    }
    await tx.salesOrder.update({
      where: { id: soId },
      data: { currentCycleId: keep.id },
    });
    repaired = true;
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SALES_ORDER,
      entityId: String(soId),
      actorUserId: null,
      summary: `NO_QTY repair: collapsed ${actives.length} ACTIVE cycles to cycle ${keep.cycleNo} (id ${keep.id}).`,
      payload: { module: "SALES", actionLabel: "NO_QTY_CYCLE_REPAIR_DUPLICATES", closedCycleIds: toClose, keptCycleId: keep.id },
      reason: null,
    });
    return { repaired, keptActiveCycleId: keep.id, closedDuplicateIds };
  }

  if (so.currentCycleId != null) {
    const cid = Number(so.currentCycleId);
    const pointed = await tx.salesOrderCycle.findFirst({
      where: { id: cid, salesOrderId: soId },
      select: { id: true, status: true, cycleNo: true },
    });
    if (!pointed || pointed.status === "CLOSED") {
      const sole = await tx.salesOrderCycle.findFirst({
        where: { salesOrderId: soId, status: "ACTIVE" },
        orderBy: { cycleNo: "desc" },
        select: { id: true },
      });
      const nextId = sole?.id ?? null;
      await tx.salesOrder.update({
        where: { id: soId },
        data: { currentCycleId: nextId },
      });
      repaired = true;
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SALES_ORDER,
        entityId: String(soId),
        actorUserId: null,
        summary: `NO_QTY repair: cleared stale currentCycleId (was ${cid}) → ${nextId == null ? "null" : nextId}.`,
        payload: {
          module: "SALES",
          actionLabel: "NO_QTY_CYCLE_REPAIR_STALE_POINTER",
          previousCycleId: cid,
          nextCycleId: nextId,
        },
        reason: null,
      });
      return { repaired, keptActiveCycleId: nextId, closedDuplicateIds };
    }
  }

  if (actives.length === 1) {
    const only = actives[0];
    const cur = so.currentCycleId != null ? Number(so.currentCycleId) : null;
    if (cur !== only.id && so.internalStatus !== "CLOSED") {
      await tx.salesOrder.update({
        where: { id: soId },
        data: { currentCycleId: only.id },
      });
      repaired = true;
      return { repaired, keptActiveCycleId: only.id, closedDuplicateIds };
    }
    return { repaired, keptActiveCycleId: only.id, closedDuplicateIds };
  }

  return { repaired, keptActiveCycleId: null, closedDuplicateIds };
}

/**
 * Before creating a new ACTIVE cycle: if one already exists, return its id (do not create).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} salesOrderId
 * @returns {Promise<number | null>}
 */
async function getExistingActiveNoQtyCycleId(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  const row = await tx.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

module.exports = {
  repairNoQtyCycleIntegrity,
  getExistingActiveNoQtyCycleId,
};
