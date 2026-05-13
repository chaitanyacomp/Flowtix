const { normalizePositiveCycleId } = require("../utils/cycleIds");

function num(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * NO_QTY: disposition-linked BUCKET_TRANSFER → USABLE for WOs in each (salesOrderId, cycleId), counting only
 * transfers on or before {@link SalesOrderCycle.closedAt} when that cycle is CLOSED. Excludes post-cycle approvals
 * from closed-cycle dispatch caps and from last-shortage carry-forward fulfillment.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {{ id: number; currentCycleId: number | null }[]} noQtySoCycleInputs
 * @returns {Promise<Map<string, number>>} key `${soId}:${cycleId}:${itemId}` → qty
 */
async function loadNoQtyDispositionUsableForDispatchPoolMap(prisma, noQtySoCycleInputs) {
  /** @type {Map<string, { sid: number; cid: number }>} */
  const unique = new Map();
  for (const s of noQtySoCycleInputs || []) {
    const sid = Number(s.id);
    const cid = normalizePositiveCycleId(s.currentCycleId);
    if (!Number.isFinite(sid) || sid <= 0 || cid == null) continue;
    unique.set(`${sid}:${cid}`, { sid, cid });
  }
  if (!unique.size) return new Map();

  /** Current active cycle per SO (used to redirect non-ACTIVE cycle attribution). */
  const soIds = [...new Set([...unique.values()].map((x) => x.sid))];
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: soIds }, orderType: "NO_QTY" },
    select: { id: true, currentCycleId: true },
  });
  const activeCycleBySoId = new Map(
    orders
      .map((o) => [Number(o.id), normalizePositiveCycleId(o.currentCycleId)])
      .filter(([, cid]) => cid != null),
  );

  const cycleIds = [...new Set([...unique.values()].map((x) => x.cid))];
  const cycles = await prisma.salesOrderCycle.findMany({
    where: { id: { in: cycleIds } },
    select: { id: true, salesOrderId: true, status: true, closedAt: true },
  });
  /** @type {Map<number, { status: string; closedAt: Date | null; salesOrderId: number }>} */
  const cycleMeta = new Map(
    cycles.map((c) => [
      Number(c.id),
      {
        status: String(c.status ?? ""),
        closedAt: c.closedAt ? (c.closedAt instanceof Date ? c.closedAt : new Date(c.closedAt)) : null,
        salesOrderId: Number(c.salesOrderId),
      },
    ]),
  );

  /** @type {Map<string, number>} */
  const out = new Map();

  for (const { sid, cid } of unique.values()) {
    const meta = cycleMeta.get(cid);
    if (!meta || Number(meta.salesOrderId) !== sid) continue;

    // FINAL DESIGN DECISION: closed/non-active cycles must not accrue new usable;
    // redirect disposition→USABLE attribution to the SO's current active cycle.
    const activeCid = activeCycleBySoId.get(sid) ?? null;
    const targetCid = meta.status === "ACTIVE" || activeCid == null ? cid : activeCid;

    const closedBoundary =
      meta.status === "CLOSED" && meta.closedAt instanceof Date && !Number.isNaN(meta.closedAt.getTime())
        ? meta.closedAt
        : null;

    const dispositions = await prisma.qcRejectedDisposition.findMany({
      where: { voidedAt: null, workOrder: { salesOrderId: sid, cycleId: cid } },
      select: { id: true, itemId: true },
    });
    if (!dispositions.length) continue;

    const dispIds = dispositions.map((d) => Number(d.id)).filter((x) => Number.isFinite(x) && x > 0);
    const dispById = new Map(dispositions.map((d) => [Number(d.id), d]));

    const txns = await prisma.stockTransaction.findMany({
      where: {
        transactionType: "BUCKET_TRANSFER",
        stockBucket: "USABLE",
        refId: { in: dispIds },
        qtyIn: { gt: 0 },
      },
      select: { refId: true, itemId: true, qtyIn: true, date: true },
    });

    for (const t of txns) {
      const disp = dispById.get(Number(t.refId));
      if (!disp) continue;
      if (closedBoundary) {
        const txnDate = t.date instanceof Date ? t.date : new Date(t.date);
        if (txnDate.getTime() > closedBoundary.getTime()) continue;
      }
      const itemId = Number(disp.itemId ?? t.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      const k = `${sid}:${targetCid}:${itemId}`;
      out.set(k, (out.get(k) || 0) + num(t.qtyIn));
    }
  }

  return out;
}

/**
 * NO_QTY: qty that moved to USABLE via disposition after its work order's cycle was already CLOSED.
 * Applies to planning/dispatch on {@code currentCycleId} (only prior CLOSED cycles with cycleNo less than current).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {number} salesOrderId
 * @param {number|null|undefined} currentCycleId
 * @returns {Promise<Map<number, number>>} fg itemId → qty
 */
async function loadNoQtyPostCycleApprovalQtyByItem(prisma, salesOrderId, currentCycleId) {
  const soId = Number(salesOrderId);
  const curCid = normalizePositiveCycleId(currentCycleId);
  if (!Number.isFinite(soId) || soId <= 0 || curCid == null) return new Map();

  const cur = await prisma.salesOrderCycle.findFirst({
    where: { id: curCid, salesOrderId: soId },
    select: { id: true, cycleNo: true },
  });
  if (!cur) return new Map();
  const curNo = Number(cur.cycleNo);
  if (!Number.isFinite(curNo)) return new Map();

  const priorClosed = await prisma.salesOrderCycle.findMany({
    where: { salesOrderId: soId, cycleNo: { lt: curNo }, status: "CLOSED", closedAt: { not: null } },
    select: { id: true, closedAt: true },
  });
  if (!priorClosed.length) return new Map();

  /** @type {Map<number, Date>} */
  const closedAtByCycleId = new Map();
  for (const row of priorClosed) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const d = row.closedAt instanceof Date ? row.closedAt : row.closedAt ? new Date(row.closedAt) : null;
    if (d && !Number.isNaN(d.getTime())) closedAtByCycleId.set(id, d);
  }
  const priorCycleIds = [...closedAtByCycleId.keys()];
  if (!priorCycleIds.length) return new Map();

  const dispositions = await prisma.qcRejectedDisposition.findMany({
    where: {
      voidedAt: null,
      workOrder: { salesOrderId: soId, cycleId: { in: priorCycleIds } },
    },
    select: { id: true, itemId: true, workOrder: { select: { cycleId: true } } },
  });
  if (!dispositions.length) return new Map();

  const dispIds = dispositions.map((d) => Number(d.id)).filter((x) => Number.isFinite(x) && x > 0);
  const dispById = new Map(dispositions.map((d) => [Number(d.id), d]));

  const txns = await prisma.stockTransaction.findMany({
    where: {
      transactionType: "BUCKET_TRANSFER",
      stockBucket: "USABLE",
      refId: { in: dispIds },
      qtyIn: { gt: 0 },
    },
    select: { refId: true, itemId: true, qtyIn: true, date: true },
  });

  /** @type {Map<number, number>} */
  const byItem = new Map();
  for (const t of txns) {
    const disp = dispById.get(Number(t.refId));
    if (!disp) continue;
    const origCycleId = normalizePositiveCycleId(disp.workOrder?.cycleId);
    if (origCycleId == null) continue;
    const cClosed = closedAtByCycleId.get(origCycleId);
    if (!cClosed) continue;
    const txnDate = t.date instanceof Date ? t.date : new Date(t.date);
    if (txnDate.getTime() <= cClosed.getTime()) continue;
    const itemId = Number(disp.itemId ?? t.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    const q = num(t.qtyIn);
    byItem.set(itemId, (byItem.get(itemId) || 0) + q);
  }
  return byItem;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {{ id: number; currentCycleId: number | null }[]} noQtySoCycleInputs
 * @returns {Promise<Map<string, number>>} key `${soId}:${cycleId}:${itemId}` → post-cycle qty for that target cycle
 */
async function loadNoQtyPostCycleApprovalMapForInputs(prisma, noQtySoCycleInputs) {
  /** @type {Map<string, number>} */
  const out = new Map();

  /**
   * FINAL DESIGN DECISION:
   * Post-cycle usable (disposition→USABLE after cycle close) must be attributed to the *current active* cycle.
   *
   * Callers may pass historical / closed cycleIds (e.g. dashboard per-cycle rows). We ignore those targets and
   * always key the post-cycle quantities onto SalesOrder.currentCycleId so closed cycles never receive new qty.
   */
  const soIds = [
    ...new Set((noQtySoCycleInputs || []).map((s) => Number(s?.id)).filter((x) => Number.isFinite(x) && x > 0)),
  ];
  if (!soIds.length) return out;

  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: soIds }, orderType: "NO_QTY" },
    select: { id: true, currentCycleId: true },
  });
  const activeCycleBySoId = new Map(
    orders
      .map((o) => [Number(o.id), normalizePositiveCycleId(o.currentCycleId)])
      .filter(([, cid]) => cid != null),
  );

  const seen = new Set();
  for (const sid of soIds) {
    const activeCid = activeCycleBySoId.get(sid) ?? null;
    if (activeCid == null) continue;
    const k = `${sid}:${activeCid}`;
    if (seen.has(k)) continue;
    seen.add(k);

    const m = await loadNoQtyPostCycleApprovalQtyByItem(prisma, sid, activeCid);
    for (const [itemId, qty] of m.entries()) {
      out.set(`${sid}:${activeCid}:${itemId}`, qty);
    }
  }
  return out;
}

/** Disposition rows still awaiting hold/rework/recheck decision (not CLOSED / not scrapped as terminal). */
const NO_QTY_PENDING_DISPOSITION_STATUSES = [
  "HOLD",
  "REWORK_PENDING_SUPERVISOR",
  "REWORK_APPROVED_PENDING_EXECUTION",
  "REWORK_READY_FOR_QC",
];

/**
 * NO_QTY: sum of {@link QcRejectedDisposition.remainingQty} on the **latest previous** sales order cycle
 * (cycleNo = current − 1) for each FG item — qty still in the QC disposition pipeline (not yet USABLE / CLOSED).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} prisma
 * @param {number} salesOrderId
 * @param {number|null|undefined} currentCycleId
 * @returns {Promise<Map<number, number>>} itemId → pending qty
 */
async function loadNoQtyPendingQcDispositionQtyByItem(prisma, salesOrderId, currentCycleId) {
  const soId = Number(salesOrderId);
  const curCid = normalizePositiveCycleId(currentCycleId);
  if (!Number.isFinite(soId) || soId <= 0 || curCid == null) return new Map();

  const cur = await prisma.salesOrderCycle.findFirst({
    where: { id: curCid, salesOrderId: soId },
    select: { id: true, cycleNo: true },
  });
  if (!cur) return new Map();
  const curNo = Number(cur.cycleNo);
  if (!Number.isFinite(curNo) || curNo <= 1) return new Map();

  const prev = await prisma.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, cycleNo: curNo - 1 },
    select: { id: true },
  });
  if (!prev?.id) return new Map();
  const prevId = Number(prev.id);
  if (!Number.isFinite(prevId) || prevId <= 0) return new Map();

  const rows = await prisma.qcRejectedDisposition.findMany({
    where: {
      voidedAt: null,
      status: { in: NO_QTY_PENDING_DISPOSITION_STATUSES },
      workOrder: { salesOrderId: soId, cycleId: prevId },
    },
    select: { itemId: true, remainingQty: true },
  });

  /** @type {Map<number, number>} */
  const byItem = new Map();
  for (const r of rows) {
    const itemId = Number(r.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    const q = num(r.remainingQty);
    if (!(q > 0)) continue;
    byItem.set(itemId, (byItem.get(itemId) || 0) + q);
  }
  return byItem;
}

module.exports = {
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalQtyByItem,
  loadNoQtyPostCycleApprovalMapForInputs,
  loadNoQtyPendingQcDispositionQtyByItem,
};
