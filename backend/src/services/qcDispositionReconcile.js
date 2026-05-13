const { getItemStockQty, STOCK_EPS } = require("./stockService");

/**
 * Legacy rows can remain REWORK_PENDING_SUPERVISOR after stock was already moved to rework / awaiting-QC
 * (disposition-owned REWORK or legacy QC_PENDING). Promote to REWORK_READY_FOR_QC so they only appear in the rework QC queue.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function reconcileStaleSupervisorReworkDispositions(tx) {
  const rows = await tx.qcRejectedDisposition.findMany({
    where: { voidedAt: null, status: "REWORK_PENDING_SUPERVISOR" },
    select: { id: true, itemId: true },
    take: 500,
  });
  for (const row of rows) {
    const hold = await getItemStockQty(row.itemId, tx, {
      stockBucket: "QC_HOLD",
      qcRejectedDispositionId: row.id,
      excludeReversed: true,
    });
    const pend = await getItemStockQty(row.itemId, tx, {
      stockBucket: "QC_PENDING",
      qcRejectedDispositionId: row.id,
      excludeReversed: true,
    });
    const rw = await getItemStockQty(row.itemId, tx, {
      stockBucket: "REWORK",
      qcRejectedDispositionId: row.id,
      excludeReversed: true,
    });
    if (hold <= STOCK_EPS && (pend > STOCK_EPS || rw > STOCK_EPS)) {
      await tx.qcRejectedDisposition.update({
        where: { id: row.id },
        data: { status: "REWORK_READY_FOR_QC" },
      });
    }
  }
}

module.exports = { reconcileStaleSupervisorReworkDispositions };
