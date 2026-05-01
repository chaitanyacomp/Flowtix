/** @typedef {import('@prisma/client').Prisma.TransactionClient} Tx */

const QUEUE_EPS = 1e-6;

/** Prisma Decimal / string / number → finite number for comparisons */
function qtyToNumber(q) {
  if (q == null) return 0;
  if (typeof q === "number" && Number.isFinite(q)) return q;
  if (typeof q === "string") {
    const n = Number(q);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof q === "object" && q !== null && typeof q.toString === "function") {
    const n = Number(String(q));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Sum received qty per RM PO line from GRN lines (optionally exclude reversed GRNs).
 * @param {{ reversedAt?: Date | null; lines?: { rmPoLineId: number; receivedQty: unknown }[] }[]} grns
 */
function sumReceivedByRmPoLineFromGrns(grns, { includeReversed = false } = {}) {
  const byLine = new Map();
  for (const g of grns || []) {
    if (!includeReversed && g.reversedAt) continue;
    for (const gl of g.lines || []) {
      const prev = byLine.get(gl.rmPoLineId) || 0;
      byLine.set(gl.rmPoLineId, prev + qtyToNumber(gl.receivedQty));
    }
  }
  return byLine;
}

/**
 * Recompute PO status from lines + non-reversed GRNs. Does not change CANCELLED.
 * @param {Tx} tx
 * @param {number} rmPoId
 */
async function recalcRmPoStatus(tx, rmPoId) {
  const rmPo = await tx.rmPurchaseOrder.findUnique({
    where: { id: rmPoId },
    include: { lines: true, grns: { include: { lines: true } } },
  });
  if (!rmPo || rmPo.status === "CANCELLED") return;

  const receivedByLine = sumReceivedByRmPoLineFromGrns(rmPo.grns);
  let totalOrdered = 0;
  let totalReceived = 0;
  for (const l of rmPo.lines) {
    totalOrdered += qtyToNumber(l.qty);
    totalReceived += receivedByLine.get(l.id) || 0;
  }

  // Status follows *net* received on current PO lines only (active GRNs).
  // Do not use "has any GRN row" — empty/orphan GRN headers must not force PENDING
  // when lines are already fully received.
  let next;
  if (totalOrdered <= QUEUE_EPS) {
    next = "PENDING";
  } else if (totalReceived <= QUEUE_EPS) {
    next = "PENDING";
  } else if (totalReceived + QUEUE_EPS < totalOrdered) {
    next = "PARTIAL";
  } else {
    next = "COMPLETED";
  }

  if (next !== rmPo.status) {
    await tx.rmPurchaseOrder.update({ where: { id: rmPoId }, data: { status: next } });
  }
}

/**
 * @param {Tx} tx
 * @param {number[]} itemIds
 */
async function assertAllItemsAreRm(tx, itemIds) {
  const uniq = [...new Set(itemIds)];
  const items = await tx.item.findMany({ where: { id: { in: uniq } } });
  if (items.length !== uniq.length) {
    const err = new Error("One or more item IDs not found");
    err.statusCode = 400;
    throw err;
  }
  const bad = items.filter((i) => i.itemType !== "RM");
  if (bad.length) {
    const err = new Error("All PO lines must be RM items");
    err.statusCode = 400;
    throw err;
  }
}

/**
 * True if the PO has at least one goods receipt that is not reversed (operational lock for delete).
 * @param {{ reversedAt?: Date | null }[]} grns
 */
function hasActiveGrn(grns) {
  return (grns || []).some((g) => !g.reversedAt);
}

module.exports = {
  QUEUE_EPS,
  qtyToNumber,
  sumReceivedByRmPoLineFromGrns,
  recalcRmPoStatus,
  assertAllItemsAreRm,
  hasActiveGrn,
};
