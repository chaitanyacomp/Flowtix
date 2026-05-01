const { DISPATCH_ALLOC_MODE, netDispatchedByItemId } = require("./salesOrderDispatchAllocation");
const { buildQcAcceptedMap } = require("./dispatchQcCap");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");

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
 * Simple operational status per item row.
 * @param {{ ordered: number; planned: number; produced: number; qcCleared: number; dispatched: number }} q
 */
function deriveItemStatus(q) {
  const ordered = Number(q.ordered || 0);
  const planned = Number(q.planned || 0);
  const produced = Number(q.produced || 0);
  const qc = Number(q.qcCleared || 0);
  const disp = Number(q.dispatched || 0);

  if (disp >= ordered && ordered > 0) return "Delivered";
  if (disp > 0) return "Partly Delivered";
  if (qc > 0) return "Ready to Dispatch";
  if (produced > 0) return "QC Pending";
  if (planned > 0) return "In Production";
  return "Pending";
}

/**
 * Overall status for a PO from ordered vs dispatched totals.
 * @param {{ ordered: number; dispatched: number; anyStarted: boolean }} p
 */
function derivePoStatus({ ordered, dispatched, anyStarted }) {
  if (ordered > 0 && dispatched >= ordered) return "Delivered";
  if (dispatched > 0) return "Partly Delivered";
  if (anyStarted) return "In Process";
  return "Pending";
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
 */
async function aggregateMetricsForSalesOrder(db, so, qcMap, returnedBySoItem) {
  const po = so.po || null;
  const orderedFromPoLines = po?.lines?.length
    ? po.lines.reduce((s, l) => s + Number(l.qty || 0), 0)
    : 0;
  const orderedFromSoLines = (so.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  const ordered = orderedFromPoLines > 0 ? orderedFromPoLines : orderedFromSoLines;

  let soQty = 0;
  let planned = 0;
  let produced = 0;
  let qcCleared = 0;
  let dispatched = 0;
  let returned = 0;
  let netDelivered = 0;
  let lastActivity = displayOrderDate(so, po);
  let anyStarted = false;

  soQty = orderedFromSoLines;
  planned = (so.workOrders || []).flatMap((w) => w.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);

  const woLines = (so.workOrders || []).flatMap((w) => w.lines || []);
  const woLineIds = woLines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(db, woLineIds);
  produced = woLines.reduce((s, l) => s + (producedByLineId.get(l.id) ?? 0), 0);

  qcCleared = woLines.reduce((s, l) => {
    const k = `${so.id}:${l.fgItemId}`;
    return s + (qcMap.get(k) ?? 0);
  }, 0);

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

  anyStarted = planned > 0 || produced > 0 || qcCleared > 0 || dispatched > 0 || soQty > 0;

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
    anyStarted,
    lastActivity,
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
 * }} q
 */
async function listCustomerPosForTracking(db, q) {
  const customerId = q.customerId != null && String(q.customerId).trim() !== "" ? Number(q.customerId) : undefined;
  const poSearch = typeof q.poSearch === "string" ? q.poSearch.trim() : "";
  const status = typeof q.status === "string" ? q.status.trim() : "All";
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
    // Customer Tracking: customer commitment only (Requirement Sheet / cycles own NO_QTY).
    { orderType: { not: "NO_QTY" } },
  ];
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

  const rows = [];
  for (const so of page) {
    const po = so.po || null;
    const m = await aggregateMetricsForSalesOrder(db, so, qcMap, returnedBySoItem);
    const derivedStatus = derivePoStatus({ ordered: m.ordered, dispatched: m.netDelivered, anyStarted: m.anyStarted });
    if (status !== "All" && derivedStatus !== status) continue;

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
      dispatchedQty: m.dispatched,
      returnedQty: m.returned,
      netDeliveredQty: m.netDelivered,
      balanceQty: balanceQty(m.ordered, m.netDelivered),
      status: derivedStatus,
      lastActivityDate: m.lastActivity,
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

  if (String(so.orderType || "") === "NO_QTY") {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const orderedByItemId = new Map();
  if (po?.lines?.length) {
    for (const l of po.lines) {
      orderedByItemId.set(l.itemId, (orderedByItemId.get(l.itemId) ?? 0) + Number(l.qty || 0));
    }
  }

  const soOrderedByItemId = new Map();
  for (const l of so.lines || []) {
    soOrderedByItemId.set(l.itemId, (soOrderedByItemId.get(l.itemId) ?? 0) + Number(l.qty || 0));
  }

  const woLines = (so.workOrders || []).flatMap((w) => w.lines || []);
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

  /** @type {any[]} */
  const itemRows = [];
  const itemIds = Array.from(new Set([...orderedByItemId.keys(), ...soOrderedByItemId.keys()]));

  for (const itemId of itemIds) {
    const poQty = orderedByItemId.get(itemId) ?? 0;
    const soQty = soOrderedByItemId.get(itemId) ?? 0;
    const orderedForItem = poQty > 0 ? poQty : soQty;
    const plannedQty = plannedByItemId.get(itemId) ?? 0;
    const producedQty = producedByItemId.get(itemId) ?? 0;
    const qcClearedQty = qcClearedByItemId.get(itemId) ?? 0;
    const dispatchedQty = dispatchedByItemId.get(itemId) ?? 0;
    const returnedQty = returnedBySoItem.get(`${so.id}:${itemId}`) ?? 0;
    const recoveryQty = replacementRecoveryByItemId.get(itemId) ?? 0;
    const netDeliveredQty = Math.max(0, dispatchedQty - returnedQty) + recoveryQty;
    const bal = balanceQty(orderedForItem, netDeliveredQty);

    const itemName =
      po?.lines?.find((l) => l.itemId === itemId)?.item?.itemName ||
      so.lines?.find((l) => l.itemId === itemId)?.item?.itemName ||
      `Item #${itemId}`;

    const statusLabel = deriveItemStatus({
      ordered: orderedForItem,
      planned: plannedQty,
      produced: producedQty,
      qcCleared: qcClearedQty,
      dispatched: netDeliveredQty,
    });

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
      soQty,
      plannedQty,
      producedQty,
      qcClearedQty,
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

  const anyStarted = plannedTotal > 0 || producedTotal > 0 || qcTotal > 0 || dispatchedTotal > 0 || Boolean(so);
  const overallStatus = derivePoStatus({ ordered: orderedTotal, dispatched: netDeliveredTotal, anyStarted });

  const stage = (name, qty, done, lastAt, state) => ({ name, qty, done: Boolean(done), lastAt: lastAt ?? null, state });
  const orderPlacedAt = displayOrderDate(so, po);
  const soCreatedAt = so.createdAt ?? null;
  const prodUpdatedAt = so.workOrders?.length ? so.workOrders.map((w) => w.updatedAt).sort().slice(-1)[0] : null;
  const lastDispatchAt = (so.dispatch || [])[0]?.date ?? null;

  const dispatchBaseline = orderedTotal;
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
      qcTotal > 0,
      prodUpdatedAt,
      qcTotal >= producedTotal && producedTotal > 0 ? "completed" : qcTotal > 0 ? "in_progress" : "not_started",
    ),
    stage(
      "Dispatch",
      netDeliveredTotal,
      netDeliveredTotal > 0,
      lastDispatchAt,
      dispatchBaseline > 0 && netDeliveredTotal >= dispatchBaseline ? "completed" : netDeliveredTotal > 0 ? "in_progress" : "not_started",
    ),
    stage(
      "Delivered",
      netDeliveredTotal,
      dispatchBaseline > 0 && netDeliveredTotal >= dispatchBaseline,
      lastDispatchAt,
      dispatchBaseline > 0 && netDeliveredTotal >= dispatchBaseline ? "completed" : netDeliveredTotal > 0 ? "in_progress" : "not_started",
    ),
  ];

  const exceptions = [];
  const prodPending = Math.max(0, (plannedTotal || orderedTotal) - producedTotal);
  const qcPending = Math.max(0, producedTotal - qcTotal);
  const dispatchPending = Math.max(0, qcTotal - netDeliveredTotal);
  const deliveryPending = Math.max(0, orderedTotal - netDeliveredTotal);
  if (prodPending > 0) exceptions.push(`${Math.round(prodPending * 1000) / 1000} pending for production`);
  if (qcPending > 0) exceptions.push(`${Math.round(qcPending * 1000) / 1000} waiting for QC`);
  if (dispatchPending > 0) exceptions.push(`${Math.round(dispatchPending * 1000) / 1000} ready for dispatch`);
  if (po?.requiredDate && new Date(po.requiredDate).getTime() < Date.now() && deliveryPending > 0) {
    exceptions.push("Delivery date crossed");
  }
  if (dispatchedTotal > 0 && dispatchedTotal < orderedTotal) exceptions.push("Partial delivery done");

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
    },
    summaryCards: {
      orderedQty: orderedTotal,
      plannedQty: plannedTotal,
      producedQty: producedTotal,
      qcClearedQty: qcTotal,
      dispatchedQty: netDeliveredTotal,
      returnedQty: returnedTotal,
      netDeliveredQty: netDeliveredTotal,
      balanceQty: balanceTotal,
    },
    journey,
    items: itemRows,
    dispatchHistory,
    exceptions,
  };
}

module.exports = {
  listCustomerPosForTracking,
  getCustomerPoTrackingDetail,
  parseDateStart,
  parseDateEnd,
};
