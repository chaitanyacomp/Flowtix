/**
 * Backfill/claim disposition-owned QC_PENDING for rework QC ownership.
 *
 * Problem: historical data used pooled QC_PENDING by item. After introducing StockTransaction.qcRejectedDispositionId,
 * older "REWORK_READY_FOR_QC" dispositions may have QC_PENDING stock without ownership tags, which would make
 * owned availability appear as 0.
 *
 * This script "claims" QC_PENDING from the unowned pool (qcRejectedDispositionId IS NULL) into a disposition-owned
 * QC_PENDING balance by posting an internal BUCKET_TRANSFER pair that keeps total QC_PENDING unchanged:
 * - QC_PENDING (unowned) qtyOut = claim
 * - QC_PENDING (owned, qcRejectedDispositionId=dispId) qtyIn = claim
 *
 * Usage:
 *   node scripts/backfillDispositionOwnedQcPending.js
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const STOCK_EPS = 1e-6;

async function netInBucket(tx, { itemId, stockBucket, qcRejectedDispositionId }) {
  const agg = await tx.stockTransaction.aggregate({
    where: {
      itemId,
      stockBucket,
      ...(qcRejectedDispositionId === undefined ? {} : { qcRejectedDispositionId }),
      reversedAt: null,
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return Number(agg._sum.qtyIn || 0) - Number(agg._sum.qtyOut || 0);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const dispositions = await prisma.qcRejectedDisposition.findMany({
      where: { voidedAt: null, status: "REWORK_READY_FOR_QC", remainingQty: { gt: "0" } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { item: true, workOrder: true, sourceQcEntry: true },
      take: 500,
    });

    const results = [];
    for (const d of dispositions) {
      const dispId = d.id;
      const itemId = d.itemId;
      const dispRemaining = Number(d.remainingQty);
      if (!(dispRemaining > STOCK_EPS)) continue;

      const out = await prisma.$transaction(async (tx) => {
        const owned = await netInBucket(tx, { itemId, stockBucket: "QC_PENDING", qcRejectedDispositionId: dispId });
        if (owned > STOCK_EPS) {
          return { claimed: 0, ownedBefore: owned, ownedAfter: owned, unownedBefore: null, unownedAfter: null };
        }

        const unownedBefore = await netInBucket(tx, { itemId, stockBucket: "QC_PENDING", qcRejectedDispositionId: null });
        const claim = Math.min(dispRemaining, Math.max(0, unownedBefore));
        if (!(claim > STOCK_EPS)) {
          return { claimed: 0, ownedBefore: owned, ownedAfter: owned, unownedBefore, unownedAfter: unownedBefore };
        }

        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "BUCKET_TRANSFER",
            refId: dispId,
            qcRejectedDispositionId: null,
            stockBucket: "QC_PENDING",
            qtyIn: "0",
            qtyOut: String(claim),
            reason: `QC_PENDING ownership claim → disposition #${dispId} (out)`,
            createdByUserId: null,
          },
        });
        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "BUCKET_TRANSFER",
            refId: dispId,
            qcRejectedDispositionId: dispId,
            stockBucket: "QC_PENDING",
            qtyIn: String(claim),
            qtyOut: "0",
            reason: `QC_PENDING ownership claim → disposition #${dispId} (in)`,
            createdByUserId: null,
          },
        });

        const ownedAfter = await netInBucket(tx, { itemId, stockBucket: "QC_PENDING", qcRejectedDispositionId: dispId });
        const unownedAfter = await netInBucket(tx, { itemId, stockBucket: "QC_PENDING", qcRejectedDispositionId: null });
        return { claimed: claim, ownedBefore: owned, ownedAfter, unownedBefore, unownedAfter };
      });

      results.push({
        dispositionId: dispId,
        itemId,
        itemName: d.item?.itemName,
        workOrder: d.workOrder?.docNo ?? d.workOrderId,
        sourceQc: d.sourceQcEntry?.docNo ?? d.sourceQcEntryId,
        dispositionRemainingQty: dispRemaining,
        ...out,
      });
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ processed: results.length, results }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

