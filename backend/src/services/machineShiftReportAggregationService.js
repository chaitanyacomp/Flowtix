/**
 * Aggregate linked ProductionEntry quantities for Shift Report (APPROVED only).
 * QC accepted/rejected and RM/WO wastage never alter these totals.
 */

const QTY_EPS = 0.0005;

function roundQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 1000) / 1000;
}

function qtyAdd(a, b) {
  return roundQty(roundQty(a) + roundQty(b));
}

function lineKey(runSegmentId, itemId) {
  return `${Number(runSegmentId)}:${Number(itemId)}`;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {number} sessionId
 * @returns {Promise<{
 *   byLine: Map<string, { runSegmentId: number, itemId: number, qtySentToQc: number, workOrderId: number | null, workOrderNo: string | null, itemName: string | null }>,
 *   pendingDraftCount: number,
 *   pendingDraftQty: number,
 *   pendingByLine: Map<string, { count: number, qty: number }>,
 * }>}
 */
async function aggregateShiftSessionProductionQuantities(db, sessionId) {
  const sid = Number(sessionId);
  const byLine = new Map();
  const pendingByLine = new Map();
  let pendingDraftCount = 0;
  let pendingDraftQty = 0;

  if (!Number.isInteger(sid) || sid <= 0) {
    return { byLine, pendingDraftCount, pendingDraftQty, pendingByLine };
  }

  const entries = await db.productionEntry.findMany({
    where: { shiftSessionId: sid },
    select: {
      id: true,
      producedQty: true,
      workflowStatus: true,
      shiftRunSegmentId: true,
      workOrderLine: {
        select: {
          fgItemId: true,
          workOrderId: true,
          workOrder: { select: { docNo: true } },
          fgItem: { select: { id: true, itemName: true } },
        },
      },
    },
  });

  for (const entry of entries) {
    const segmentId = entry.shiftRunSegmentId != null ? Number(entry.shiftRunSegmentId) : null;
    const itemId = entry.workOrderLine?.fgItemId != null ? Number(entry.workOrderLine.fgItemId) : null;
    if (!Number.isInteger(segmentId) || segmentId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      continue;
    }
    const key = lineKey(segmentId, itemId);
    const qty = roundQty(entry.producedQty);
    const status = String(entry.workflowStatus || "").toUpperCase();

    if (status === "APPROVED") {
      const prev = byLine.get(key) || {
        runSegmentId: segmentId,
        itemId,
        qtySentToQc: 0,
        workOrderId: entry.workOrderLine?.workOrderId ?? null,
        workOrderNo: entry.workOrderLine?.workOrder?.docNo ?? null,
        itemName: entry.workOrderLine?.fgItem?.itemName ?? null,
      };
      prev.qtySentToQc = qtyAdd(prev.qtySentToQc, qty);
      byLine.set(key, prev);
    } else if (status === "DRAFT") {
      pendingDraftCount += 1;
      pendingDraftQty = qtyAdd(pendingDraftQty, qty);
      const p = pendingByLine.get(key) || { count: 0, qty: 0 };
      p.count += 1;
      p.qty = qtyAdd(p.qty, qty);
      pendingByLine.set(key, p);
    }
    // Reversed = DRAFT after reverse; already covered. Unknown statuses ignored.
  }

  return { byLine, pendingDraftCount, pendingDraftQty, pendingByLine };
}

/**
 * Build report line quantities: scrap from operator, QC-sent from APPROVED PE, gross = sum.
 * @param {Array<{ runSegmentId: number, itemId: number, productionScrapQty?: number, remarks?: string | null }>} clientLines
 * @param {Map<string, { qtySentToQc: number }>} approvedByLine
 */
function buildCalculatedReportLines(clientLines, approvedByLine) {
  const scrapByKey = new Map();
  const remarksByKey = new Map();
  const order = [];

  for (const raw of clientLines || []) {
    const runSegmentId = Number(raw.runSegmentId);
    const itemId = Number(raw.itemId);
    if (!Number.isInteger(runSegmentId) || runSegmentId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      continue;
    }
    const key = lineKey(runSegmentId, itemId);
    if (!scrapByKey.has(key)) order.push(key);
    scrapByKey.set(key, roundQty(raw.productionScrapQty ?? 0));
    if (raw.remarks !== undefined) {
      remarksByKey.set(key, raw.remarks);
    }
  }

  // Ensure every APPROVED PE group appears even if client omitted scrap line.
  for (const key of approvedByLine.keys()) {
    if (!scrapByKey.has(key)) {
      order.push(key);
      scrapByKey.set(key, 0);
    }
  }

  const lines = [];
  let sumGross = 0;
  let sumScrap = 0;
  let sumQc = 0;

  for (const key of order) {
    const [runSegmentIdStr, itemIdStr] = key.split(":");
    const runSegmentId = Number(runSegmentIdStr);
    const itemId = Number(itemIdStr);
    const productionScrapQty = roundQty(scrapByKey.get(key) ?? 0);
    const qtySentToQc = roundQty(approvedByLine.get(key)?.qtySentToQc ?? 0);
    const grossOutputQty = qtyAdd(productionScrapQty, qtySentToQc);
    sumGross = qtyAdd(sumGross, grossOutputQty);
    sumScrap = qtyAdd(sumScrap, productionScrapQty);
    sumQc = qtyAdd(sumQc, qtySentToQc);

    let remarks = null;
    if (remarksByKey.has(key)) {
      const text = remarksByKey.get(key);
      if (text != null && text !== "") {
        const trimmed = String(text).trim().replace(/\s+/g, " ");
        remarks = trimmed ? trimmed.slice(0, 2000) : null;
      }
    }

    lines.push({
      runSegmentId,
      itemId,
      grossOutputQty,
      productionScrapQty,
      qtySentToQc,
      remarks,
    });
  }

  return {
    lines,
    totals: {
      grossOutputQty: sumGross,
      productionScrapQty: sumScrap,
      qtySentToQc: sumQc,
    },
  };
}

function pendingDraftSummaryFromAggregate(agg, runSegmentId, itemId) {
  const key = lineKey(runSegmentId, itemId);
  const row = agg.pendingByLine.get(key);
  return {
    pendingDraftCount: row?.count ?? 0,
    pendingDraftQty: roundQty(row?.qty ?? 0),
  };
}

module.exports = {
  QTY_EPS,
  roundQty,
  qtyAdd,
  lineKey,
  aggregateShiftSessionProductionQuantities,
  buildCalculatedReportLines,
  pendingDraftSummaryFromAggregate,
};
