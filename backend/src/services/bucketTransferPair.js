const auditLog = require("./auditLog");
const { assertSufficientStockForQtyOut, getItemStockQty, STOCK_EPS } = require("./stockService");

/**
 * Paired BUCKET_TRANSFER rows: qty out from fromBucket, qty in to toBucket. Total physical on-hand unchanged.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function pairBucketTransferInTx(
  tx,
  {
    itemId,
    item,
    qty,
    fromBucket,
    toBucket,
    reasonDetail,
    userId,
    req,
    auditLogTitle,
    qcRejectedDispositionId,
    /** When set, IN row uses this disposition id (OUT still uses qcRejectedDispositionId). Hold→rework: out parent hold, in child REWORK. */
    toQcRejectedDispositionId,
  },
) {
  const detail = String(reasonDetail || "").trim() || "—";
  const reasonNote = `Bucket ${fromBucket}→${toBucket}: ${detail}`;
  const inDispId = toQcRejectedDispositionId ?? qcRejectedDispositionId;
  await assertSufficientStockForQtyOut(tx, itemId, qty, "Insufficient quantity in source bucket.", {
    stockBucket: fromBucket,
    ...(qcRejectedDispositionId ? { qcRejectedDispositionId } : {}),
  });
  const stockBefore = await getItemStockQty(itemId, tx);
  const outTxn = await tx.stockTransaction.create({
    data: {
      itemId,
      transactionType: "BUCKET_TRANSFER",
      refId: qcRejectedDispositionId ?? inDispId ?? 0,
      qcRejectedDispositionId: qcRejectedDispositionId ?? null,
      stockBucket: fromBucket,
      qtyIn: "0",
      qtyOut: String(qty),
      reason: `${reasonNote} (out)`,
      createdByUserId: userId,
    },
    include: { item: true },
  });
  await tx.stockTransaction.create({
    data: {
      itemId,
      transactionType: "BUCKET_TRANSFER",
      refId: inDispId ?? qcRejectedDispositionId ?? 0,
      qcRejectedDispositionId: inDispId ?? null,
      stockBucket: toBucket,
      qtyIn: String(qty),
      qtyOut: "0",
      reason: `${reasonNote} (in)`,
      createdByUserId: userId,
    },
  });
  const stockAfter = await getItemStockQty(itemId, tx);
  if (Math.abs(stockAfter - stockBefore) > STOCK_EPS) {
    const err = new Error("Bucket transfer left total on-hand inconsistent; operation aborted.");
    err.statusCode = 500;
    throw err;
  }
  const title = auditLogTitle || "Bucket transfer";
  await auditLog.write(tx, {
    action: auditLog.AuditAction.CREATE,
    entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
    entityId: String(outTxn.id),
    actorUserId: userId,
    actorRole: req.user.role,
    summary: `${title} #${outTxn.id}: ${item.itemName} ${fromBucket}→${toBucket} qty ${qty}`,
    payload: {
      snapshot: {
        itemId,
        itemName: item.itemName,
        qty,
        fromBucket,
        toBucket,
      },
      stockBefore,
      stockAfter,
    },
    reason: detail,
  });
  return outTxn;
}

module.exports = { pairBucketTransferInTx };
