/**
 * Shared production rollups (reuse across routes / dashboards).
 */

/**
 * Approved produced qty by WorkOrderLine.id.
 * Only APPROVED production counts as active downstream production.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number[]} workOrderLineIds
 * @returns {Promise<Map<number, number>>}
 */
async function getApprovedProducedQtyByWorkOrderLineIds(db, workOrderLineIds) {
  const ids = (workOrderLineIds || []).filter((n) => Number.isFinite(n) && n > 0);
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map();

  const sums = await db.productionEntry.groupBy({
    by: ["workOrderLineId"],
    where: { workOrderLineId: { in: unique }, workflowStatus: "APPROVED" },
    _sum: { producedQty: true },
  });
  return new Map(sums.map((s) => [s.workOrderLineId, Number(s._sum.producedQty ?? 0)]));
}

module.exports = { getApprovedProducedQtyByWorkOrderLineIds };

