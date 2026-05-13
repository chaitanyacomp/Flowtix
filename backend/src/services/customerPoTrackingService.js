const { DISPATCH_ALLOC_MODE, netDispatchedByItemId } = require("./salesOrderDispatchAllocation");
const { buildQcAcceptedMap } = require("./dispatchQcCap");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const {
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
  getProductionBatchQcPendingQty,
  getSoItemDispatchableReadyQty,
  REPORT_QUEUE_EPS,
} = require("./reportMetrics");
const { mapSoLinesToDispatchFifoInputs } = require("./regularSoBufferQty");
const { getUsableItemStockQty } = require("./stockService");
const { sumQcAcceptedForSoItem } = require("./dispatchQcCap");

/**
 * Parse YYYY-MM-DD to Date at local start-of-day. Returns undefined when missing/invalid.
 * @param {unknown} s
 */
function parseDateStart(s) {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (!t) return undefined;
  const d = new Date(`${t}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/**
 * Parse YYYY-MM-DD to Date at local end-of-day. Returns undefined when missing/invalid.
 * @param {unknown} s
 */
function parseDateEnd(s) {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (!t) return undefined;
  const d = new Date(`${t}T23:59:59.999`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/**
 * @param {number} ordered
 * @param {number} dispatched
 */
function balanceQty(ordered, dispatched) {
  return Math.max(0, Number(ordered || 0) - Number(dispatched || 0));
}

/**
 * Customer PO lines by item (customer-requested qty).
 * @param {any} po
 * @returns {Map<number, number>}
 */
function buildPoQtyByItemId(po) {
  const m = new Map();
  if (!po?.lines?.length) return m;
  for (const pl of po.lines) {
    const id = pl.itemId;
    m.set(id, (m.get(id) ?? 0) + Number(pl.qty || 0));
  }
  return m;
}

/**
 * Customer commitment for one sales order line — not planned production qty (`SalesOrderLine.qty`).
 * @param {any} line
 * @param {Map<number, number>} poQtyByItem
 */
function customerOrderQtyForSalesOrderLine(line, poQtyByItem) {
  const cpq = Number(line.customerPoQty || 0);
  if (cpq > 0) return cpq;
  const pq = Number(poQtyByItem.get(line.itemId) ?? 0);
  if (pq > 0) return pq;
  return 0;
}

/**
 * Total customer-ordered qty for Customer Tracking (dispatch/billing cap), never WO/planned buffer.
 * @param {any} so
 * @param {any|null} po
 */
function sumCustomerOrderedQtyForTracking(so, po) {
  const poQtyByItem = buildPoQtyByItemId(po);
  let sumLines = 0;
  for (const l of so.lines || []) {
    sumLines += customerOrderQtyForSalesOrderLine(l, poQtyByItem);
  }
  if (sumLines > 0) return sumLines;
  if (po?.lines?.length) {
    return po.lines.reduce((s, pl) => s + Number(pl.qty || 0), 0);
  }
  return 0;
}

/**
 * Per-item customer ordered qty for detail rows.
 * @param {any} so
 * @param {Map<number, number>} poQtyByItem
 * @returns {Map<number, number>}
 */
function buildCustomerOrderQtyByItemId(so, poQtyByItem) {
  const m = new Map();
  for (const l of so.lines || []) {
    const id = l.itemId;
    const q = customerOrderQtyForSalesOrderLine(l, poQtyByItem);
    m.set(id, (m.get(id) ?? 0) + q);
  }
  return m;
}

/**
 * Batch-level QC pending (same as GET /production/production-entries?withoutQc=1):
 * each APPROVED ProductionEntry contributes max(0, produced − active accepted − active rejected).
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number[]} salesOrderIds
 * @returns {Promise<{ pendingTotalBySo: Map<number, number>; pendingBySoFg: Map<string, number> }>}
 */
async function buildApprovedBatchQcPendingAggregatesForSalesOrders(db, salesOrderIds) {
  /** @type {Map<number, number>} */
  const pendingTotalBySo = new Map();
  /** @type {Map<string, number>} key `${salesOrderId}:${fgItemId}` */
  const pendingBySoFg = new Map();
  const ids = [...new Set((salesOrderIds || []).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return { pendingTotalBySo, pendingBySoFg };

  const entries = await db.productionEntry.findMany({
    where: {
      workflowStatus: "APPROVED",
      workOrderLine: { workOrder: { salesOrderId: { in: ids } } },
    },
    include: {
      qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
      workOrderLine: { select: { fgItemId: true, workOrder: { select: { salesOrderId: true } } } },
    },
  });

  for (const row of entries) {
    const soId = row.workOrderLine?.workOrder?.salesOrderId;
    const fgId = row.workOrderLine?.fgItemId;
    if (!Number.isFinite(soId)) continue;
    const produced = Number(row.producedQty ?? 0);
    const acc = sumActiveQcAcceptedQty(row.qcEntries);
    const rej = sumActiveQcRejectedQty(row.qcEntries);
    const pend = getProductionBatchQcPendingQty(produced, acc, rej);
    pendingTotalBySo.set(soId, (pendingTotalBySo.get(soId) ?? 0) + pend);
    if (Number.isFinite(fgId)) {
      const k = `${soId}:${fgId}`;
      pendingBySoFg.set(k, (pendingBySoFg.get(k) ?? 0) + pend);
    }
  }
  return { pendingTotalBySo, pendingBySoFg };
}

/**
 * Line status for Customer Tracking only: customer ordered qty vs net delivered (no WO/QC/planned).
 */
function deriveItemStatusForTracking(ordered, netDelivered) {
  const o = Number(ordered || 0);
  const d = Number(netDelivered || 0);
  if (o > 0 && d >= o) return "Completed";
  if (d > 0) return "Partly Delivered";
  return "Pending";
}

/**
 * Overall list/detail status: customer ordered vs net dispatched only (not production).
 * @param {{ ordered: number; dispatched: number }} p
 */
function derivePoStatus({ ordered, dispatched }) {
  if (ordered > 0 && dispatched >= ordered) return "Completed";
  if (dispatched > 0) return "Partly Delivered";
  return "Pending";
}

/**
 * REGULAR (NORMAL) SO: at least one finalized sales bill (via dispatch) → treat order as commercially complete for status.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} salesOrderId
 */
async function hasFinalizedSalesBillForSalesOrder(db, salesOrderId) {
  const id = Number(salesOrderId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const n = await db.salesBill.count({
    where: { status: "FINALIZED", dispatch: { soId: id } },
  });
  return n > 0;
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number[]} salesOrderIds
 * @returns {Promise<Set<number>>}
 */
async function loadNormalSoIdsWithFinalizedSalesBill(db, salesOrderIds) {
  const ids = [...new Set((salesOrderIds || []).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return new Set();
  const rows = await db.salesBill.findMany({
    where: { status: "FINALIZED", dispatch: { soId: { in: ids } } },
    select: { dispatch: { select: { soId: true } } },
  });
  return new Set(rows.map((r) => Number(r.dispatch.soId)).filter((n) => Number.isFinite(n) && n > 0));
}

/**
 * Sum active (non-voided) customer returns by key "soId:itemId".
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number[]} soIds
 */
async function buildReturnedQtyBySoItemMap(db, soIds) {
  const ids = (soIds || []).filter((n) => Number.isFinite(n) && n > 0);
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map();
  const rows = await db.customerReturn.groupBy({
    by: ["salesOrderId", "itemId"],
    where: { reversedAt: null, salesOrderId: { in: unique } },
    _sum: { returnedQty: true },
  });
  return new Map(rows.map((r) => [`${r.salesOrderId}:${r.itemId}`, Number(r._sum.returnedQty ?? 0)]));
}

/**
 * For a **NORMAL** original sales order: qty shipped on linked replacement SO(s) that
 * recovers returned shortage (reporting only; does not change dispatch/return posting).
 *
 * Per active return with a linked replacement SO: add min(returnedQty, confirmed net
 * dispatch on that replacement SO for the same item). Multiple returns for the same
 * item accumulate (each replacement capped by its own return row).
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} originalSoId
 * @returns {Promise<Map<number, number>>} itemId -> recovery qty
 */
async function buildReplacementRecoveryByItemIdForOriginalSo(db, originalSoId) {
  const id = Number(originalSoId);
  if (!Number.isFinite(id) || id <= 0) return new Map();

  const returns = await db.customerReturn.findMany({
    where: { salesOrderId: id, reversedAt: null },
    include: {
      replacementSalesOrder: {
        include: { dispatch: true },
      },
    },
  });

  /** @type {Map<number, number>} */
  const recoveryByItemId = new Map();
  for (const r of returns) {
    const repl = r.replacementSalesOrder;
    if (!repl) continue;
    const byItem = netDispatchedByItemId(repl.dispatch || [], DISPATCH_ALLOC_MODE.CONFIRMED);
    const replNetForItem = Math.max(0, Number(byItem.get(r.itemId) ?? 0));
    const returned = Number(r.returnedQty || 0);
    const capped = Math.min(returned, replNetForItem);
    if (capped <= 0) continue;
    recoveryByItemId.set(r.itemId, (recoveryByItemId.get(r.itemId) ?? 0) + capped);
  }
  return recoveryByItemId;
}

/** @param {any} so @param {any|null} po */
function displayOrderRef(so, po) {
  if (po?.poNumber) return String(po.poNumber);
  if (so.customerPoReference) return String(so.customerPoReference);
  if (so.docNo) return String(so.docNo);
  return `SO-${so.id}`;
}

/** @param {any} so @param {any|null} po */
function displayOrderDate(so, po) {
  return po?.poDate ?? so.createdAt;
}

/** @param {any} so @param {any|null} po */
function rowCustomer(so, po) {
  if (so.customer) return { id: so.customer.id, name: so.customer.name };
  if (po?.customer) return { id: po.customer.id, name: po.customer.name };
  if (so.replacementForReturn?.customer) {
    return { id: so.replacementForReturn.customer.id, name: so.replacementForReturn.customer.name };
  }
  const id = so.customerId ?? po?.customerId ?? 0;
  return { id, name: "—" };
}

const soIncludeForTracking = {
  customer: true,
  replacementForReturn: { include: { customer: true } },
  po: { include: { customer: true, lines: { include: { item: true } } } },
  lines: { include: { item: true } },
  workOrders: {
    orderBy: { id: "asc" },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { fgItem: true },
      },
    },
  },
  dispatch: { orderBy: { id: "desc" } },
};

/**
 * Aggregate production / QC / dispatch metrics for one sales order (shared list + detail).
 * @param {import('@prisma/client').PrismaClient} db
 * @param {any} so
 * @param {Map<string, number>} qcMap
 * @param {Map<string, number>} returnedBySoItem
 * @param {{ pendingTotalBySo: Map<number, number>; pendingBySoFg: Map<string, number> }} [qcBatchPendingCtx]
 */
async function aggregateMetricsForSalesOrder(db, so, qcMap, returnedBySoItem, qcBatchPendingCtx) {
  const po = so.po || null;
  const poQtyByItem = buildPoQtyByItemId(po);
  const ordered = sumCustomerOrderedQtyForTracking(so, po);
  let soQty = (so.lines || []).reduce((s, l) => s + customerOrderQtyForSalesOrderLine(l, poQtyByItem), 0);
  if (soQty <= 0 && po?.lines?.length) {
    soQty = po.lines.reduce((s, pl) => s + Number(pl.qty || 0), 0);
  }

  let planned = 0;
  let produced = 0;
  let qcCleared = 0;
  let dispatched = 0;
  let returned = 0;
  let netDelivered = 0;
  let lastActivity = displayOrderDate(so, po);

  planned = (so.workOrders || []).flatMap((w) => w.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);

  const woLines = (so.workOrders || []).flatMap((w) => w.lines || []);
  const woLineIds = woLines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(db, woLineIds);
  produced = woLines.reduce((s, l) => s + (producedByLineId.get(l.id) ?? 0), 0);

  /** QC accepted is keyed once per (SO, FG item); do not sum the same map entry once per WO line. */
  const fgIdsForQc = new Set(woLines.map((l) => l.fgItemId));
  qcCleared = [...fgIdsForQc].reduce((s, fgId) => {
    const k = `${so.id}:${fgId}`;
    return s + (qcMap.get(k) ?? 0);
  }, 0);

  let qcPendingBatchTotal = 0;
  if (qcBatchPendingCtx?.pendingTotalBySo) {
    qcPendingBatchTotal = Number(qcBatchPendingCtx.pendingTotalBySo.get(so.id) ?? 0);
  } else {
    const built = await buildApprovedBatchQcPendingAggregatesForSalesOrders(db, [so.id]);
    qcPendingBatchTotal = Number(built.pendingTotalBySo.get(so.id) ?? 0);
  }

  const confirmedDispatched = Array.from(
    netDispatchedByItemId(so.dispatch || [], DISPATCH_ALLOC_MODE.CONFIRMED).values(),
  ).reduce((s, v) => s + Number(v || 0), 0);

  const returnKeys = new Set(
    (po?.lines?.length ? po.lines : so.lines || []).map((l) => `${so.id}:${l.itemId}`),
  );
  returned = [...returnKeys].reduce((s, k) => s + (returnedBySoItem.get(k) ?? 0), 0);
  dispatched = confirmedDispatched;
  let replacementRecovery = 0;
  if (String(so.orderType || "") === "NORMAL") {
    const recoveryByItem = await buildReplacementRecoveryByItemIdForOriginalSo(db, so.id);
    replacementRecovery = [...recoveryByItem.values()].reduce((s, v) => s + Number(v || 0), 0);
  }
  netDelivered = Math.max(0, confirmedDispatched - returned) + replacementRecovery;

  const candidates = [
    so.updatedAt,
    ...(so.workOrders || []).map((w) => w.updatedAt),
    ...(so.dispatch || []).map((d) => d.date),
    po?.updatedAt,
    po?.poDate,
  ].filter(Boolean);
  for (const d of candidates) {
    if (d && new Date(d).getTime() > new Date(lastActivity).getTime()) lastActivity = d;
  }

  return {
    ordered,
    soQty,
    planned,
    produced,
    qcCleared,
    dispatched,
    returned,
    netDelivered,
    lastActivity,
    /** Sum of production-batch QC pending; matches QC queue (`withoutQc=1`) totals for this SO. */
    qcPendingBatchTotal,
  };
}

/**
 * List trackable customer flow rows (sales-order–centric).
 *
 * `poKey` in each row is the **sales order id** (stable key for detail API).
 * Optional linked Customer PO metadata is folded into display ref / dates.
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{
 *  customerId?: unknown;
 *  poSearch?: unknown;
 *  status?: unknown;
 *  dateFrom?: unknown;
 *  dateTo?: unknown;
 *  limit?: unknown;
 *  includeNoQty?: unknown;
 * }} q
 */
async function listCustomerPosForTracking(db, q) {
  const customerId = q.customerId != null && String(q.customerId).trim() !== "" ? Number(q.customerId) : undefined;
  const poSearch = typeof q.poSearch === "string" ? q.poSearch.trim() : "";
  const status = typeof q.status === "string" ? q.status.trim() : "All";
  const includeNoQty =
    q.includeNoQty === true ||
    q.includeNoQty === 1 ||
    String(q.includeNoQty ?? "").trim().toLowerCase() === "1" ||
    String(q.includeNoQty ?? "").trim().toLowerCase() === "true";
  const dateFrom = parseDateStart(q.dateFrom);
  const dateTo = parseDateEnd(q.dateTo);
  const limitRaw = q.limit != null ? Number(q.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

  if (!Number.isFinite(customerId) || customerId <= 0) {
    return { rows: [], hasMore: false, limit };
  }

  const dateFilter = {};
  if (dateFrom) dateFilter.gte = dateFrom;
  if (dateTo) dateFilter.lte = dateTo;

  /** @type {any[]} */
  const andParts = [
    {
      OR: [
        { customerId },
        { po: { is: { customerId } } },
        { replacementForReturn: { is: { customerId } } },
      ],
    },
  ];
  if (!includeNoQty) {
    // Default: Requirement Sheet / cycles own NO_QTY elsewhere; optional inclusion for commercial tracking screens.
    andParts.push({ orderType: { not: "NO_QTY" } });
  }
  if (Object.keys(dateFilter).length) {
    andParts.push({ createdAt: dateFilter });
  }
  if (poSearch) {
    andParts.push({
      OR: [
        { docNo: { contains: poSearch } },
        { customerPoReference: { contains: poSearch } },
        { po: { is: { poNumber: { contains: poSearch } } } },
      ],
    });
  }

  const sos = await db.salesOrder.findMany({
    where: { AND: andParts },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: soIncludeForTracking,
  });

  const hasMore = sos.length > limit;
  const page = hasMore ? sos.slice(0, limit) : sos;

  const qcMap = await buildQcAcceptedMap(db);
  const soIds = page.map((s) => s.id);
  const returnedBySoItem = await buildReturnedQtyBySoItemMap(db, soIds);
  const qcBatchPendingCtx = await buildApprovedBatchQcPendingAggregatesForSalesOrders(db, soIds);
  const normalSoFinalizedBill = await loadNormalSoIdsWithFinalizedSalesBill(db, soIds);

  const rows = [];
  for (const so of page) {
    const po = so.po || null;
    const m = await aggregateMetricsForSalesOrder(db, so, qcMap, returnedBySoItem, qcBatchPendingCtx);
    let derivedStatus = derivePoStatus({ ordered: m.ordered, dispatched: m.netDelivered });
    if (normalSoFinalizedBill.has(so.id)) {
      derivedStatus = "Completed";
    }
    if (status !== "All" && derivedStatus !== status) continue;

    const commerciallyClosed = normalSoFinalizedBill.has(so.id);
    rows.push({
      poKey: so.id,
      salesOrderId: so.id,
      orderType: so.orderType ?? null,
      poNumber: displayOrderRef(so, po),
      poDate: displayOrderDate(so, po),
      requiredDate: po?.requiredDate ?? null,
      customer: rowCustomer(so, po),
      orderedQty: m.ordered,
      soQty: m.soQty,
      plannedQty: m.planned,
      producedQty: m.produced,
      qcClearedQty: m.qcCleared,
      qcPendingQty: m.qcPendingBatchTotal,
      dispatchedQty: m.dispatched,
      returnedQty: m.returned,
      netDeliveredQty: m.netDelivered,
      balanceQty: balanceQty(m.ordered, m.netDelivered),
      status: derivedStatus,
      lastActivityDate: m.lastActivity,
      isCommerciallyClosed: commerciallyClosed,
    });
  }

  return { rows, hasMore, limit };
}

/**
 * Resolve sales order from URL key: primary = sales order id; legacy = customer PO id with linked SO.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} key
 */
async function resolveSalesOrderForTrackingKey(db, key) {
  const id = Number(key);
  if (!Number.isFinite(id) || id <= 0) return null;

  let so = await db.salesOrder.findUnique({
    where: { id },
    include: soIncludeForTracking,
  });
  if (so) return { so, po: so.po || null };

  const cp = await db.customerPO.findUnique({
    where: { id },
    include: { salesOrder: { select: { id: true } } },
  });
  if (cp?.salesOrder?.id) {
    so = await db.salesOrder.findUnique({
      where: { id: cp.salesOrder.id },
      include: soIncludeForTracking,
    });
    const poFull = await db.customerPO.findUnique({
      where: { id: cp.id },
      include: { customer: true, lines: { include: { item: true } } },
    });
    if (so) return { so, po: poFull };
  }
  return null;
}

/**
 * Full tracking detail for one row. `:poKey` is **sales order id**, or legacy customer PO id when linked.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} routeKey
 */
async function getCustomerPoTrackingDetail(db, routeKey) {
  const resolved = await resolveSalesOrderForTrackingKey(db, Number(routeKey));
  if (!resolved?.so) {
    const maybeCp = await db.customerPO.findUnique({
      where: { id: Number(routeKey) },
      select: { id: true, salesOrder: { select: { id: true } } },
    });
    if (maybeCp) {
      const err = new Error("This customer PO is not linked to a sales order yet. Create a sales order from the PO first.");
      err.statusCode = 409;
      throw err;
    }
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  const { so, po } = resolved;

  const poQtyByItem = buildPoQtyByItemId(po);
  const orderedByItemId = new Map();
  if (po?.lines?.length) {
    for (const l of po.lines) {
      orderedByItemId.set(l.itemId, (orderedByItemId.get(l.itemId) ?? 0) + Number(l.qty || 0));
    }
  }

  const customerOrderByItemId = buildCustomerOrderQtyByItemId(so, poQtyByItem);

  const woLines = (so.workOrders || []).flatMap((w) => w.lines || []);
  const qcBatchPendingCtx = await buildApprovedBatchQcPendingAggregatesForSalesOrders(db, [so.id]);
  const qcPendingOrderTotal = Number(qcBatchPendingCtx.pendingTotalBySo.get(so.id) ?? 0);

  const plannedByItemId = new Map();
  for (const wl of woLines) {
    plannedByItemId.set(wl.fgItemId, (plannedByItemId.get(wl.fgItemId) ?? 0) + Number(wl.qty || 0));
  }

  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(db, woLines.map((l) => l.id));
  const producedByItemId = new Map();
  for (const wl of woLines) {
    producedByItemId.set(wl.fgItemId, (producedByItemId.get(wl.fgItemId) ?? 0) + (producedByLineId.get(wl.id) ?? 0));
  }

  const qcMap = await buildQcAcceptedMap(db);
  const qcClearedByItemId = new Map();
  for (const itemId of new Set(woLines.map((l) => l.fgItemId))) {
    const k = `${so.id}:${itemId}`;
    qcClearedByItemId.set(itemId, qcMap.get(k) ?? 0);
  }

  const dispatchedByItemId = netDispatchedByItemId(so.dispatch || [], DISPATCH_ALLOC_MODE.CONFIRMED);
  const returnedBySoItem = await buildReturnedQtyBySoItemMap(db, [so.id]);
  const replacementRecoveryByItemId =
    String(so.orderType || "") === "NORMAL" ? await buildReplacementRecoveryByItemIdForOriginalSo(db, so.id) : new Map();

  const isNormalSo = String(so.orderType || "") === "NORMAL";
  const isCommerciallyClosed = await hasFinalizedSalesBillForSalesOrder(db, so.id);

  /** @type {any[]} */
  const itemRows = [];
  const itemIds = Array.from(new Set([...orderedByItemId.keys(), ...customerOrderByItemId.keys()]));

  for (const itemId of itemIds) {
    const fromPo = orderedByItemId.get(itemId) ?? 0;
    const fromSoCustomer = customerOrderByItemId.get(itemId) ?? 0;
    const orderedForItem = fromSoCustomer > 0 ? fromSoCustomer : fromPo;
    const plannedQty = plannedByItemId.get(itemId) ?? 0;
    const producedQty = producedByItemId.get(itemId) ?? 0;
    const qcClearedQty = qcClearedByItemId.get(itemId) ?? 0;
    const dispatchedQty = dispatchedByItemId.get(itemId) ?? 0;
    const returnedQty = returnedBySoItem.get(`${so.id}:${itemId}`) ?? 0;
    const recoveryQty = replacementRecoveryByItemId.get(itemId) ?? 0;
    const netDeliveredQty = Math.max(0, dispatchedQty - returnedQty) + recoveryQty;
    const bal = balanceQty(orderedForItem, netDeliveredQty);
    const qcPendingForItem = Number(qcBatchPendingCtx.pendingBySoFg.get(`${so.id}:${itemId}`) ?? 0);

    const itemName =
      po?.lines?.find((l) => l.itemId === itemId)?.item?.itemName ||
      so.lines?.find((l) => l.itemId === itemId)?.item?.itemName ||
      `Item #${itemId}`;

    const statusLabel = isCommerciallyClosed
      ? "Completed"
      : deriveItemStatusForTracking(orderedForItem, netDeliveredQty);

    const workOrdersForItem = (so.workOrders || [])
      .filter((w) => (w.lines || []).some((ln) => ln.fgItemId === itemId))
      .map((w) => ({
        workOrderId: w.id,
        status: w.status,
        lines: (w.lines || [])
          .filter((ln) => ln.fgItemId === itemId)
          .map((ln) => ({
            workOrderLineId: ln.id,
            requiredQty: Number(ln.qty || 0),
            plannedQty: Number(ln.plannedQty || 0),
            approvedProducedQty: producedByLineId.get(ln.id) ?? 0,
          })),
      }));

    itemRows.push({
      itemId,
      itemName,
      poQty: orderedForItem,
      soQty: fromSoCustomer,
      plannedQty,
      producedQty,
      qcClearedQty,
      qcPendingQty: qcPendingForItem,
      dispatchedQty,
      returnedQty,
      netDeliveredQty,
      balanceQty: bal,
      status: statusLabel,
      detail: {
        ordered: orderedForItem,
        planned: plannedQty,
        produced: producedQty,
        qcCleared: qcClearedQty,
        qcPendingBatch: qcPendingForItem,
        dispatched: dispatchedQty,
        returned: returnedQty,
        netDelivered: netDeliveredQty,
        remainingToDeliver: bal,
        salesOrderNo: so.docNo ?? `SO-${so.id}`,
        workOrders: workOrdersForItem,
      },
    });
  }

  const orderedTotal = itemRows.reduce((s, r) => s + Number(r.poQty || 0), 0);
  const plannedTotal = itemRows.reduce((s, r) => s + Number(r.plannedQty || 0), 0);
  const producedTotal = itemRows.reduce((s, r) => s + Number(r.producedQty || 0), 0);
  const qcTotal = itemRows.reduce((s, r) => s + Number(r.qcClearedQty || 0), 0);
  const dispatchedTotal = itemRows.reduce((s, r) => s + Number(r.dispatchedQty || 0), 0);
  const returnedTotal = itemRows.reduce((s, r) => s + Number(r.returnedQty || 0), 0);
  const netDeliveredTotal = itemRows.reduce((s, r) => s + Number(r.netDeliveredQty || 0), 0);
  const balanceTotal = balanceQty(orderedTotal, netDeliveredTotal);

  let overallStatus = derivePoStatus({ ordered: orderedTotal, dispatched: netDeliveredTotal });
  if (isCommerciallyClosed) overallStatus = "Completed";

  const stage = (name, qty, done, lastAt, state) => ({ name, qty, done: Boolean(done), lastAt: lastAt ?? null, state });
  const orderPlacedAt = displayOrderDate(so, po);
  const soCreatedAt = so.createdAt ?? null;
  const prodUpdatedAt = so.workOrders?.length ? so.workOrders.map((w) => w.updatedAt).sort().slice(-1)[0] : null;
  const lastDispatchAt = (so.dispatch || [])[0]?.date ?? null;

  const dispatchBaseline = orderedTotal;
  const deliveryPending = Math.max(0, orderedTotal - netDeliveredTotal);
  const prodGapStrict = Math.max(0, plannedTotal - producedTotal);
  const productionInProgressFlg = producedTotal > REPORT_QUEUE_EPS && prodGapStrict > REPORT_QUEUE_EPS;
  const workOrderBacklogFlg =
    !productionInProgressFlg &&
    (prodGapStrict > REPORT_QUEUE_EPS ||
      (plannedTotal <= REPORT_QUEUE_EPS &&
        producedTotal <= REPORT_QUEUE_EPS &&
        deliveryPending > REPORT_QUEUE_EPS));

  /** @type {null | { qtyPendingToDeliver: number; dispatchableNowTotal: number; realQcBatchPendingQty: number; productionInProgress: boolean; workOrderBacklog: boolean }} */
  let regularDispatchGuidance = null;
  let dispatchableNowTotal = 0;
  if (isNormalSo && (so.lines || []).length > 0 && !isCommerciallyClosed) {
    const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines || [], so.orderType);
    const dispatchRows = so.dispatch || [];
    const uniqItemIds = [
      ...new Set((so.lines || []).map((l) => Number(l.itemId)).filter((n) => Number.isFinite(n) && n > 0)),
    ];
    const perItemDispatchable = await Promise.all(
      uniqItemIds.map(async (itemId) => {
        const [stockAvailableQty, qcAcceptedGross] = await Promise.all([
          getUsableItemStockQty(itemId, db),
          sumQcAcceptedForSoItem(db, so.id, itemId),
        ]);
        const dispatchableQty = getSoItemDispatchableReadyQty({
          orderLineInputs: lineInputs,
          dispatchRecords: dispatchRows,
          itemId,
          orderType: so.orderType,
          onHandQty: stockAvailableQty,
          qcAcceptedTotalForSoItem: qcAcceptedGross,
        });
        return Math.max(0, Number(dispatchableQty || 0));
      }),
    );
    dispatchableNowTotal = perItemDispatchable.reduce((a, b) => a + b, 0);
    regularDispatchGuidance = {
      qtyPendingToDeliver: deliveryPending,
      dispatchableNowTotal,
      realQcBatchPendingQty: qcPendingOrderTotal,
      productionInProgress: productionInProgressFlg,
      workOrderBacklog: workOrderBacklogFlg,
    };
  }

  const dispatchDeliveredDonePhysically =
    dispatchBaseline > 0 && netDeliveredTotal >= dispatchBaseline;
  const dispatchDeliveredDone = dispatchDeliveredDonePhysically || isCommerciallyClosed;

  const journey = [
    stage("Order / PO recorded", orderedTotal, true, orderPlacedAt, "completed"),
    stage("Sales Order", orderedTotal, true, soCreatedAt, "completed"),
    stage("Production Plan", plannedTotal, plannedTotal > 0, prodUpdatedAt, plannedTotal > 0 ? "in_progress" : "not_started"),
    stage(
      "Production Done",
      producedTotal,
      producedTotal > 0,
      prodUpdatedAt,
      producedTotal >= plannedTotal && plannedTotal > 0 ? "completed" : producedTotal > 0 ? "in_progress" : "not_started",
    ),
    stage(
      "QC Cleared",
      qcTotal,
      qcPendingOrderTotal <= REPORT_QUEUE_EPS && producedTotal > REPORT_QUEUE_EPS,
      prodUpdatedAt,
      producedTotal <= REPORT_QUEUE_EPS
        ? "not_started"
        : qcPendingOrderTotal <= REPORT_QUEUE_EPS
          ? "completed"
          : "in_progress",
    ),
    stage(
      "Dispatch",
      netDeliveredTotal,
      netDeliveredTotal > 0 || isCommerciallyClosed,
      lastDispatchAt,
      dispatchDeliveredDone ? "completed" : netDeliveredTotal > 0 ? "in_progress" : "not_started",
    ),
    stage(
      "Delivered",
      netDeliveredTotal,
      dispatchDeliveredDone,
      lastDispatchAt,
      dispatchDeliveredDone ? "completed" : netDeliveredTotal > 0 ? "in_progress" : "not_started",
    ),
  ];

  const exceptions = [];
  const prodPending = Math.max(0, (plannedTotal || orderedTotal) - producedTotal);
  /** Same basis as GET /production/production-entries?withoutQc=1&salesOrderId= (batch rollups, includes rejects). */
  const qcPending = qcPendingOrderTotal;
  const dispatchPending = Math.max(0, qcTotal - netDeliveredTotal);
  const stockDispatch = isNormalSo && dispatchableNowTotal > REPORT_QUEUE_EPS;
  if (!isCommerciallyClosed) {
    if (prodPending > 0) exceptions.push(`${Math.round(prodPending * 1000) / 1000} pending for production`);
    if (qcPending > REPORT_QUEUE_EPS && (!isNormalSo || !stockDispatch)) {
      exceptions.push(`${Math.round(qcPending * 1000) / 1000} waiting for QC`);
    }
    if (dispatchPending > REPORT_QUEUE_EPS && (!isNormalSo || !stockDispatch)) {
      exceptions.push(`${Math.round(dispatchPending * 1000) / 1000} ready for dispatch`);
    }
    if (po?.requiredDate && new Date(po.requiredDate).getTime() < Date.now() && deliveryPending > 0) {
      exceptions.push("Delivery date crossed");
    }
    if (dispatchedTotal > 0 && dispatchedTotal < orderedTotal) exceptions.push("Partial delivery done");
  }

  // Dispatch / return audit trail (detail only): include forward dispatch + dispatch reversals + customer returns.
  // Keep summary totals unchanged (netDelivered is still dispatched - returned via separate aggregation).
  const forwardAndReversalDispatch = (so.dispatch || [])
    .filter((d) => d.workflowStatus === "LOCKED")
    .slice(0, 400)
    .map((d) => ({
      type: d.reversalOfId != null ? "REVERSAL" : "DISPATCH",
      dispatchNo: d.docNo ? String(d.docNo) : `DSP-${String(d.id).padStart(6, "0")}`,
      date: d.date,
      itemId: d.itemId,
      itemName: so.lines?.find((l) => l.itemId === d.itemId)?.item?.itemName ?? `Item #${d.itemId}`,
      // Reversal rows already persist negative dispatchedQty per schema; keep signed qty for audit clarity.
      qty: Number(d.dispatchedQty || 0),
      vehicleOrRefNo: null,
      remarks: d.reversalOfId != null ? d.reversalReason ?? "Dispatch reversal" : null,
    }));

  const returnRows = await db.customerReturn.findMany({
    where: { salesOrderId: so.id, reversedAt: null },
    orderBy: { returnDate: "desc" },
    take: 200,
    include: { item: true },
  });
  const returnEvents = returnRows.map((r) => ({
    type: "RETURN",
    dispatchNo: `RET-${String(r.id).padStart(6, "0")}`,
    date: r.returnDate,
    itemId: r.itemId,
    itemName: r.item?.itemName ?? `Item #${r.itemId}`,
    // Returns reduce delivered qty: store as negative for history display.
    qty: -Number(r.returnedQty || 0),
    vehicleOrRefNo: null,
    remarks: r.reason ? String(r.reason).slice(0, 180) : null,
  }));

  const dispatchHistory = [...forwardAndReversalDispatch, ...returnEvents]
    .filter((x) => x.qty !== 0 && x.qty !== null && x.qty !== undefined)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 400);

  const cust = rowCustomer(so, po);

  return {
    header: {
      poKey: so.id,
      salesOrderId: so.id,
      orderType: so.orderType ?? null,
      poNumber: displayOrderRef(so, po),
      poDate: displayOrderDate(so, po),
      requiredDate: po?.requiredDate ?? null,
      customer: cust,
      status: overallStatus,
      isCommerciallyClosed: Boolean(isCommerciallyClosed),
    },
    summaryCards: {
      orderedQty: orderedTotal,
      plannedQty: plannedTotal,
      producedQty: producedTotal,
      qcClearedQty: qcTotal,
      qcPendingQty: qcPendingOrderTotal,
      dispatchedQty: netDeliveredTotal,
      returnedQty: returnedTotal,
      netDeliveredQty: netDeliveredTotal,
      balanceQty: balanceTotal,
    },
    journey,
    items: itemRows,
    dispatchHistory,
    exceptions,
    regularDispatchGuidance,
  };
}

module.exports = {
  listCustomerPosForTracking,
  getCustomerPoTrackingDetail,
  parseDateStart,
  parseDateEnd,
};
