/**
 * Shared reporting / dashboard quantity math (pure functions + explicit definitions).
 *
 * Dispatch storage: rows are per SalesOrder + itemId only. Per–sales-order-line display uses
 * FIFO-by-SalesOrderLine.id allocation from {@link allocateDispatchAcrossSalesOrderLines}.
 *
 * Term glossary (avoid mixing these in UI without reading the doc line):
 *
 * - **orderLineDispatchRemaining** (SO line): ordered qty on that line minus dispatch attributed
 *   to that line (FIFO across lines sharing the same itemId). Same as “remaining” on dispatch UI.
 * - **dispatchPendingQty / backlog** (SO line): same as orderLineDispatchRemaining when > 0; used in
 *   dispatch backlog rows (no QC/stock gate). Backlog uses **confirmed** dispatch only (LOCKED + reversals);
 *   draft UNLOCKED rows are excluded from “dispatched” and backlog.
 * - **soItemNetDispatched**: sum(Dispatch.dispatchedQty) for that SO + itemId (reversals negative).
 * - **soItemOrderedTotal**: sum(SalesOrderLine.qty) for that SO + itemId (all lines).
 * - **soItemDispatchShortfall**: soItemOrderedTotal − soItemNetDispatched (item-level gap; not shown
 *   per line directly).
 * - **qcApprovedRemainingAtSoItem**: max(0, total active QC accepted for that SO+FG item −
 *   soItemNetDispatched). Shared by every SO line with the same itemId — display / tracking only for dispatch UI;
 *   it does **not** cap dispatchable qty.
 * - **dispatchableQty (SO line)**: Dispatch-ready qty for that line — SO-line FIFO operational remaining,
 *   sharing one pool per SO+itemId of min(usable on-hand, QC pool remaining when QC exists for that SO+item;
 *   otherwise usable only). Same basis as the WO “sufficient dispatch” guard.
 * - **woLineRemainingProductionQty** (operational): max(0, WorkOrderLine.qty − sum of APPROVED
 *   ProductionEntry.producedQty on that line). Reversed approvals return batches to DRAFT and are excluded.
 *   Used for production dropdowns, dashboard production queue, and WO tracking “production pending”.
 * - **woLineProductionBalanceQty(a,b)**: a − b (generic); for queue rows use requiredQty − approvedProduced.
 * - **batchQcPending**: max(0, producedQty − (accepted+rejected)) on one ProductionEntry using active
 *   (non-reversed) QC rows only.
 *
 * **WO tracking report** uses a different dispatch split: FIFO by WorkOrderLine.id capped by each line’s
 * QC accepted — see {@link allocateDispatchFifoAcrossWorkOrderLines}. Do not mix with SO-line FIFO.
 */

const {
  allocateDispatchAcrossSalesOrderLines,
  netDispatchedByItemId,
  remainingDispatchCapacityForSoItem,
  DISPATCH_ALLOC_MODE,
} = require("./salesOrderDispatchAllocation");
const { mapSoLinesToDispatchFifoInputs, dispatchFifoQtyForSoLine } = require("./regularSoBufferQty");

const REPORT_QUEUE_EPS = 1e-6;
const DISPATCH_COMPLETE_EPS = 1e-6;

// --- Sales order + dispatch (SO-line FIFO allocation) ---

/**
 * @param {{ itemId: number; qty: unknown }[]} lines
 * @returns {Map<number, number>}
 */
function aggregateSoOrderedQtyByItemId(lines) {
  const m = new Map();
  for (const l of lines || []) {
    const id = l.itemId;
    m.set(id, (m.get(id) ?? 0) + Number(l.qty));
  }
  return m;
}

/** @alias netDispatchedByItemId — name matches reporting vocabulary */
function getSoNetDispatchedByItemIdMap(dispatchRecords, mode = DISPATCH_ALLOC_MODE.OPERATIONAL) {
  return netDispatchedByItemId(dispatchRecords, mode);
}

/**
 * Item-level: total ordered on SO for SKU minus net dispatched for that SKU (not per SO line).
 * @param {number} orderedTotalForItem
 * @param {number} netDispatchedForItem
 */
function getSoItemOrderedMinusDispatched(orderedTotalForItem, netDispatchedForItem) {
  return orderedTotalForItem - netDispatchedForItem;
}

/**
 * @param {{ id: number; itemId: number; qty: number }[]} lineInputs
 * @param {{ itemId: number; dispatchedQty: unknown }[]} dispatchRecords
 * @param {'operational' | 'confirmed'} [mode]
 */
function buildSoLineDispatchAllocation(lineInputs, dispatchRecords, mode = DISPATCH_ALLOC_MODE.OPERATIONAL) {
  const alloc = allocateDispatchAcrossSalesOrderLines(lineInputs, dispatchRecords || [], mode);
  const netByItem = netDispatchedByItemId(dispatchRecords || [], mode);
  return { alloc, netByItem };
}

/**
 * Per SO line: attributed dispatched qty (FIFO across lines with same item).
 * @param {Map<number, number>} alloc from buildSoLineDispatchAllocation
 * @param {number} salesOrderLineId
 */
function getSoLineAttributedDispatchedQty(alloc, salesOrderLineId) {
  return alloc.get(salesOrderLineId) ?? 0;
}

/**
 * Ordered qty on the line minus attributed dispatch (may be negative if data inconsistent; callers often compare to eps).
 */
function getSoLineOrderQtyMinusAttributedDispatch(orderedQty, attributedDispatchedQty) {
  return orderedQty - attributedDispatchedQty;
}

/**
 * max(0, ordered − attributed); “dispatch still owed” on this line under SO-line FIFO.
 */
function getSoLineDispatchPendingQty(orderedQty, attributedDispatchedQty) {
  return Math.max(0, orderedQty - attributedDispatchedQty);
}

/**
 * QC cap remaining at SO+item (not per line): how much accepted QC is not yet covered by net dispatch.
 */
function getSoItemQcApprovedRemainingQty(qcAcceptedTotalForSoItem, netDispatchedForSoItem) {
  return Math.max(0, qcAcceptedTotalForSoItem - netDispatchedForSoItem);
}

/**
 * Dispatch ship cap at SO+item.
 *
 * NORMAL / NO_QTY: physical usable FG (QC rollup is reflected separately in dispatchable composition where used).
 *
 * REPLACEMENT: cap by **return / replacement QC pool remaining** (gross return-QC for SO+item minus operational net
 * dispatched on that replacement SO+item), not production QcEntry and not raw global on-hand alone.
 *
 * @param {{ orderType?: string | null; onHandQty: number; qcAcceptedTotalForSoItem: number; netDispatchedOperationalForSoItem: number }} p
 */
function getSoItemDispatchShipCap(p) {
  const onHand = Number(p.onHandQty);
  if (p.orderType === "REPLACEMENT") {
    const qc = Number(p.qcAcceptedTotalForSoItem ?? 0);
    const net = Number(p.netDispatchedOperationalForSoItem ?? 0);
    return Math.max(0, qc - net);
  }
  return onHand;
}

/**
 * Item-level dispatch-ready qty: how much of this SO’s remaining operational dispatch need can ship now.
 */
function getSoItemDispatchableReadyQty({
  orderLineInputs,
  dispatchRecords,
  itemId,
  orderType,
  onHandQty,
  qcAcceptedTotalForSoItem,
}) {
  const pending = remainingDispatchCapacityForSoItem(orderLineInputs, dispatchRecords || [], itemId);
  const netOp = netDispatchedByItemId(dispatchRecords || [], DISPATCH_ALLOC_MODE.OPERATIONAL).get(itemId) ?? 0;
  const shipCap = getSoItemDispatchShipCap({
    orderType,
    onHandQty,
    qcAcceptedTotalForSoItem,
    netDispatchedOperationalForSoItem: netOp,
  });
  return Math.min(pending, shipCap);
}

/**
 * Per sales order line id: dispatch-ready qty (FIFO by line id within each itemId), one shared ship pool per item.
 */
function buildDispatchableQtyBySalesOrderLineId({
  orderLineInputs,
  dispatchRecords,
  orderType,
  onHandByItemId,
  qcAcceptedTotalByItemId,
}) {
  const { alloc: allocOp } = buildSoLineDispatchAllocation(
    orderLineInputs,
    dispatchRecords || [],
    DISPATCH_ALLOC_MODE.OPERATIONAL,
  );
  const netByItem = netDispatchedByItemId(dispatchRecords || [], DISPATCH_ALLOC_MODE.OPERATIONAL);

  /** @type {Map<number, { id: number; itemId: number; qty: number }[]>} */
  const byItem = new Map();
  for (const li of orderLineInputs) {
    if (!byItem.has(li.itemId)) byItem.set(li.itemId, []);
    byItem.get(li.itemId).push(li);
  }
  for (const arr of byItem.values()) {
    arr.sort((a, b) => a.id - b.id);
  }

  /** @type {Map<number, number>} */
  const out = new Map();
  for (const [itemId, group] of byItem) {
    const onHand = onHandByItemId.get(itemId) ?? 0;
    const net = netByItem.get(itemId) ?? 0;
    const qcAccepted = qcAcceptedTotalByItemId.get(itemId) ?? 0;
    let shipPool = getSoItemDispatchShipCap({
      orderType,
      onHandQty: onHand,
      qcAcceptedTotalForSoItem: qcAccepted,
      netDispatchedOperationalForSoItem: net,
    });

    for (const li of group) {
      const attr = getSoLineAttributedDispatchedQty(allocOp, li.id);
      const lineRemRaw = getSoLineOrderQtyMinusAttributedDispatch(li.qty, attr);
      const lineRem = Math.max(0, lineRemRaw);
      const d = Math.min(lineRem, shipPool);
      out.set(li.id, d);
      shipPool -= d;
    }
  }
  return out;
}

/**
 * @deprecated Prefer {@link buildDispatchableQtyBySalesOrderLineId} or {@link getSoItemDispatchableReadyQty}.
 * Legacy: min(line remaining, on-hand) without shared pool / QC cap.
 */
function getDispatchableQtyForSoLine({ orderLineRemaining, onHandQty }) {
  return Math.min(orderLineRemaining, onHandQty);
}

/**
 * Short UI copy when a line still has confirmed backlog but nothing can ship (dispatchable ≈ 0).
 * Does not change caps — explain only.
 *
 * @param {{ orderType?: string | null; pendingDispatchQty: number; dispatchable: number; operationalRemaining: number; totalStock: number; qcHoldQty: number; qcPendingQty: number; reworkQty: number; qcApprovedRemaining?: number; qcAcceptedGross?: number }} p
 * @returns {string | null}
 */
function getDispatchBlockedReason(p) {
  const eps = REPORT_QUEUE_EPS;
  if (p.pendingDispatchQty <= eps) return null;
  if (p.dispatchable > eps) return null;
  if (p.orderType === "REPLACEMENT") {
    const qcRem = p.qcApprovedRemaining;
    if (p.pendingDispatchQty > eps && p.dispatchable <= eps && qcRem != null && qcRem <= eps) {
      return "Replacement return QC pool is exhausted for this item (vs net dispatched)";
    }
    if (p.totalStock <= eps) return "Insufficient usable stock";
    return null;
  }
  if (p.reworkQty > eps) return "Stock is under rework";
  if (p.qcHoldQty + p.qcPendingQty > eps) return "Stock is under QC";
  if (p.totalStock <= eps) return "Insufficient usable stock";
  if (p.operationalRemaining <= eps) {
    return "No remaining qty to dispatch on this line (drafts may reserve capacity)";
  }
  const qcGross = p.qcAcceptedGross;
  const qcRem = p.qcApprovedRemaining;
  if (
    qcGross != null &&
    qcGross > eps &&
    qcRem != null &&
    qcRem <= eps &&
    p.totalStock > eps
  ) {
    return "QC-approved pool for this sales order item is exhausted — no dispatch-ready quantity left";
  }
  return null;
}

/**
 * @param {{ id: number; itemId: number; qty: import("@prisma/client").Decimal | string | number; customerPoQty?: unknown; bufferPercent?: unknown }[]} lines
 * @param {{ itemId: number; dispatchedQty: unknown }[]} dispatchRecords
 * @param {string | null | undefined} [orderType] — NORMAL: FIFO + pending use customerPoQty; others use line.qty
 * @returns {{ dispatchLineStats: object[], dispatchSummary: object }}
 */
function computeSalesOrderDispatchLineStats(lines, dispatchRecords, orderType) {
  const rawLines = lines ?? [];
  const dispatch = dispatchRecords ?? [];
  const lineInputs = mapSoLinesToDispatchFifoInputs(rawLines, orderType);
  const { alloc } = buildSoLineDispatchAllocation(lineInputs, dispatch, DISPATCH_ALLOC_MODE.CONFIRMED);

  const dispatchLineStats = rawLines.map((line) => {
    const ordered = dispatchFifoQtyForSoLine(line, orderType);
    const dispatched = getSoLineAttributedDispatchedQty(alloc, line.id);
    const pending = getSoLineDispatchPendingQty(ordered, dispatched);
    const row = {
      lineId: line.id,
      itemId: line.itemId,
      ordered,
      dispatched,
      pending,
    };
    if (orderType === "NORMAL") {
      row.customerPoQty = Number(line.customerPoQty ?? line.qty);
      row.bufferPercent = Number(line.bufferPercent ?? 0);
      row.plannedQty = Number(line.qty);
    }
    return row;
  });

  const totalOrdered = dispatchLineStats.reduce((s, l) => s + l.ordered, 0);
  const totalDispatched = dispatchLineStats.reduce((s, l) => s + l.dispatched, 0);
  const totalPending = dispatchLineStats.reduce((s, l) => s + l.pending, 0);
  const fullyDispatched =
    rawLines.length === 0 || dispatchLineStats.every((l) => l.pending <= DISPATCH_COMPLETE_EPS);

  return {
    dispatchLineStats,
    dispatchSummary: {
      totalOrdered,
      totalDispatched,
      totalPending,
      fullyDispatched,
    },
  };
}

/**
 * True if any line still has dispatch backlog (ordered − attributed > eps).
 * @param {{ qty: unknown; customerPoQty?: unknown }[]} lines
 * @param {{ itemId: number; dispatchedQty: unknown }[]} dispatchRecords
 * @param {string | null | undefined} [orderType]
 */
function salesOrderHasDispatchBacklog(lines, dispatchRecords, orderType, eps = REPORT_QUEUE_EPS) {
  const lineInputs = mapSoLinesToDispatchFifoInputs(lines ?? [], orderType);
  const { alloc } = buildSoLineDispatchAllocation(lineInputs, dispatchRecords ?? [], DISPATCH_ALLOC_MODE.OPERATIONAL);
  for (const line of lines ?? []) {
    const ordered = dispatchFifoQtyForSoLine(line, orderType);
    const attributed = getSoLineAttributedDispatchedQty(alloc, line.id);
    if (getSoLineOrderQtyMinusAttributedDispatch(ordered, attributed) > eps) return true;
  }
  return false;
}

// --- Work order line production ---

/**
 * Remaining FG to satisfy the work order line’s SO quantity (never negative).
 * producedQty must be APPROVED production only (draft/reversed excluded upstream).
 */
function getWoLineRemainingProductionQty(woLineRequiredQty, approvedProducedQty) {
  return Math.max(0, Number(woLineRequiredQty) - Number(approvedProducedQty));
}

/** @deprecated Legacy names kept for compatibility; they now operate on WO qty (target) not planned qty. */
function getWoLineProductionPendingQty(workOrderQty, producedQty) {
  return Math.max(0, Number(workOrderQty) - Number(producedQty));
}

/** Raw balance first − second (may be negative). */
function getWoLineProductionBalanceQty(workOrderQty, producedQty) {
  return Number(workOrderQty) - Number(producedQty);
}

const { isActiveQcEntry } = require("./qcEntryConstants");

// --- Production batch QC (one ProductionEntry) ---

function sumActiveQcAcceptedQty(qcEntries) {
  let a = 0;
  for (const q of qcEntries || []) {
    if (!isActiveQcEntry(q)) continue;
    a += Number(q.acceptedQty);
  }
  return a;
}

function sumActiveQcRejectedQty(qcEntries) {
  let r = 0;
  for (const q of qcEntries || []) {
    if (!isActiveQcEntry(q)) continue;
    r += Number(q.rejectedQty);
  }
  return r;
}

/** max(0, produced − accepted − rejected) for active QC only */
function getProductionBatchQcPendingQty(producedQty, acceptedQty, rejectedQty) {
  return Math.max(0, producedQty - (acceptedQty + rejectedQty));
}

// --- WO tracking report: dispatch FIFO by WO line (different from SO-line FIFO) ---

/**
 * Split net dispatched for one FG on an SO across WO lines (FIFO by workOrderLineId), each share capped
 * by that line’s QC accepted total. Used only by work-order tracking report.
 * @param {Array<{ lineId: number; acceptedQty: number }>} linesInGroup
 * @param {number} netDispatchedForItem
 * @returns {Map<number, number>} workOrderLineId -> attributed dispatch
 */
function allocateDispatchFifoAcrossWorkOrderLines(linesInGroup, netDispatchedForItem) {
  let remaining = Math.max(0, netDispatchedForItem);
  const byLineId = new Map();
  const sorted = [...linesInGroup].sort((a, b) => a.lineId - b.lineId);
  for (const entry of sorted) {
    const cap = Math.max(0, entry.acceptedQty);
    const take = Math.min(remaining, cap);
    byLineId.set(entry.lineId, take);
    remaining -= take;
  }
  return byLineId;
}

/** Production stage pending: max(0, WO line SO qty − APPROVED produced rollup). */
function getWoTrackingProductionPendingQty(workOrderLineRequiredQty, approvedProducedQtyRollup) {
  return Math.max(0, workOrderLineRequiredQty - approvedProducedQtyRollup);
}

function getWoTrackingQcPendingQty(producedQtyRollup, acceptedQtyRollup, rejectedQtyRollup) {
  return Math.max(0, producedQtyRollup - (acceptedQtyRollup + rejectedQtyRollup));
}

function getWoTrackingDispatchPendingQty(acceptedQtyRollup, woLineAttributedDispatchedQty) {
  return Math.max(0, acceptedQtyRollup - woLineAttributedDispatchedQty);
}

/**
 * Same stage gate order as work-order-tracking report row status.
 */
function deriveWoTrackingOperationalStatus({
  productionPendingQty,
  qcPendingQty,
  dispatchPendingQty,
  producedQty,
  acceptedQty,
  rejectedQty,
  dispatchedQty,
}, eps = REPORT_QUEUE_EPS) {
  if (productionPendingQty > eps) {
    if (producedQty <= eps) return "PENDING_PRODUCTION";
    return "IN_PRODUCTION";
  }
  if (qcPendingQty > eps) {
    if (acceptedQty + rejectedQty <= eps) return "PENDING_QC";
    return "PARTIAL_QC";
  }
  if (dispatchPendingQty > eps) {
    if (dispatchedQty <= eps) return "READY_TO_DISPATCH";
    return "PARTIAL_DISPATCH";
  }
  return "COMPLETED";
}

/**
 * SO progress: dispatched vs ordered along all lines (uses line stats).
 * @param {{ ordered: number, dispatched: number }[]} dispatchLineStats from computeSalesOrderDispatchLineStats
 */
function getSalesOrderDispatchCompletionPercent(dispatchLineStats) {
  const ordered = (dispatchLineStats ?? []).reduce((s, l) => s + l.ordered, 0);
  if (ordered <= REPORT_QUEUE_EPS) return 100;
  const dispatched = (dispatchLineStats ?? []).reduce((s, l) => s + l.dispatched, 0);
  return Math.min(100, (dispatched / ordered) * 100);
}

/**
 * Work-order-tracking summary: pending dispatch capped by sales order (not raw sum of WO-line accepted−dispatch).
 * For each distinct (salesOrderId, itemId): netDispatched = sum of FIFO-attributed dispatchedQty on those lines
 * (= net dispatch for that SO+FG). Then add min(SO remainder, accepted remainder) where:
 *   SO remainder = max(0, orderedQty − netDispatched)
 *   accepted remainder = max(0, sum(acceptedQty) − netDispatched)
 * Matches min(SO Qty − Dispatched, Total Accepted − Dispatched) when using totals at SO+FG scope.
 *
 * @param {Array<{ salesOrderId?: number, itemId?: number, orderedQty?: number, acceptedQty?: number, dispatchedQty?: number }>} rows
 */
function computeWorkOrderTrackingSummaryPendingDispatchQtySum(rows) {
  const list = rows ?? [];
  if (!list.length) return 0;
  /** @type {Map<string, { orderedQty: number, totalAccepted: number, netDispatched: number }>} */
  const groups = new Map();
  for (const r of list) {
    const soId = r.salesOrderId;
    const itemId = r.itemId;
    if (soId == null || itemId == null || r.orderedQty == null) {
      return list.reduce((s, row) => s + Number(row.dispatchPendingQty ?? 0), 0);
    }
    const key = `${soId}-${itemId}`;
    if (!groups.has(key)) {
      groups.set(key, { orderedQty: Number(r.orderedQty), totalAccepted: 0, netDispatched: 0 });
    }
    const g = groups.get(key);
    g.totalAccepted += Number(r.acceptedQty ?? 0);
    g.netDispatched += Number(r.dispatchedQty ?? 0);
  }
  let sum = 0;
  for (const g of groups.values()) {
    const soRemainder = Math.max(0, g.orderedQty - g.netDispatched);
    const acceptedRemainder = Math.max(0, g.totalAccepted - g.netDispatched);
    sum += Math.min(soRemainder, acceptedRemainder);
  }
  return sum;
}

/**
 * Recompute work-order-tracking summary from row payloads (verification / API consistency guard).
 * @param {Array<{ status: string, productionPendingQty: number, qcPendingQty: number, dispatchPendingQty: number, salesOrderId?: number, itemId?: number, orderedQty?: number, acceptedQty?: number, dispatchedQty?: number }>} rows
 */
function computeWorkOrderTrackingSummaryFromRows(rows) {
  const list = rows ?? [];
  const openWoLines = list.filter((r) => r.status !== "COMPLETED").length;
  const pendingProductionQtySum = list.reduce((s, r) => s + Number(r.productionPendingQty ?? 0), 0);
  const pendingQcQtySum = list.reduce((s, r) => s + Number(r.qcPendingQty ?? 0), 0);
  const pendingDispatchQtySum = computeWorkOrderTrackingSummaryPendingDispatchQtySum(list);
  return {
    openWoLines,
    pendingProductionQtySum,
    pendingQcQtySum,
    pendingDispatchQtySum,
  };
}

/**
 * @returns {{ ok: true, computed: object } | { ok: false, key?: string, computed: object, expected: object, reason?: string }}
 */
function assertWorkOrderTrackingSummaryMatches(rows, summary, eps = 1e-6) {
  const computed = computeWorkOrderTrackingSummaryFromRows(rows);
  if (!summary || typeof summary !== "object") {
    return { ok: false, reason: "missing summary", computed, expected: summary };
  }
  /** @type {(keyof ReturnType<typeof computeWorkOrderTrackingSummaryFromRows>)[]} */
  const keys = ["openWoLines", "pendingProductionQtySum", "pendingQcQtySum", "pendingDispatchQtySum"];
  for (const k of keys) {
    const a = computed[k];
    const b = summary[k];
    if (typeof b !== "number" || Number.isNaN(b) || Math.abs(a - b) > eps) {
      return { ok: false, key: k, computed, expected: summary };
    }
  }
  return { ok: true, computed };
}

/**
 * Mirrors frontend `normalizeWoTrackingApiResponse` summary selection (keep in sync with
 * `frontend/src/lib/woTrackingResponse.ts`). Used for contract tests only — not a runtime API.
 * @param {unknown} payload
 * @returns {{ rows: object[], summary: object | null }}
 */
function normalizeWorkOrderTrackingApiPayloadForVerification(payload) {
  if (Array.isArray(payload)) {
    const rows = payload;
    return { rows, summary: rows.length ? computeWorkOrderTrackingSummaryFromRows(rows) : null };
  }
  const o = payload && typeof payload === "object" ? payload : {};
  const rows = Array.isArray(o.rows) ? o.rows : [];
  const s = o.summary;
  if (s != null && typeof s === "object") {
    return { rows, summary: s };
  }
  return { rows, summary: rows.length ? computeWorkOrderTrackingSummaryFromRows(rows) : null };
}

/**
 * Canonical text definitions for reporting APIs and tooltips (documentation in code).
 * Keys align with JSON field names where possible.
 */
const METRIC_DEFINITIONS = {
  soLinePending:
    "max(0, ordered minus SO-line-FIFO attributed dispatch) per sales order line; not the same as item-level net gap",
  backlogPendingQty:
    "Same remainder as soLinePending before backlog filter; only rows with remainder > threshold appear in backlog",
  qcApprovedRemaining:
    "Total active QC accepted for this sales order + FG item minus net dispatched at that item (shared across SO lines)",
  dispatchableQty:
    "SO-line FIFO operational remaining, capped by a shared per SO+item pool of min(usable stock, QC pool remaining when QC exists for that SO+item; else usable only). Same basis as WO sufficiency guard.",
  productionBalanceQty:
    "WO line SO required qty minus sum of APPROVED production on that line; remaining uses max(0, ...)",
  qcPendingQty: "Production batch produced qty minus (accepted + rejected) from active (non-reversed) QC rows",
  woDispatchPendingQty:
    "WO-line QC accepted rollup minus WO-line-FIFO attributed dispatch (work-order tracking report only)",
  exceptionPendingShare:
    "pendingQty / orderedQty on a backlog row — used only for operations-exception severity (computed on server)",
  exceptionBalanceShare:
    "balanceQty / requiredQty (WO line SO qty) on a production queue row — operations-exception severity (server)",
  exceptionPendingQcToProducedRatio:
    "pendingQcQty compared to producedQty for QC exception critical tier (server-side rule input)",
};

/** Short labels attached to API payloads so UIs do not mix FIFO rules silently */
const METRIC_CONTEXT = {
  SO_FIFO: "SO_FIFO",
  SO_ITEM_TOTAL: "SO_ITEM_TOTAL",
  WO_FIFO: "WO_FIFO",
  QC_POOL: "QC_POOL",
  QC_BATCH: "QC_BATCH",
  WO_LINE: "WO_LINE",
  RM_PO_LINE: "RM_PO_LINE",
  RM_PLANNING: "RM_PLANNING",
  DISPATCH_LEDGER: "DISPATCH_LEDGER",
  /** Dispatch-ready qty (SO FIFO × ship cap per SO+item) */
  DISPATCHABLE_MIN: "DISPATCHABLE_MIN",
};

module.exports = {
  REPORT_QUEUE_EPS,
  DISPATCH_COMPLETE_EPS,
  DISPATCH_ALLOC_MODE,
  METRIC_DEFINITIONS,
  METRIC_CONTEXT,
  aggregateSoOrderedQtyByItemId,
  getSoNetDispatchedByItemIdMap,
  getSoItemOrderedMinusDispatched,
  buildSoLineDispatchAllocation,
  getSoLineAttributedDispatchedQty,
  getSoLineOrderQtyMinusAttributedDispatch,
  getSoLineDispatchPendingQty,
  getSoItemQcApprovedRemainingQty,
  getSoItemDispatchShipCap,
  getSoItemDispatchableReadyQty,
  buildDispatchableQtyBySalesOrderLineId,
  getDispatchableQtyForSoLine,
  getDispatchBlockedReason,
  computeSalesOrderDispatchLineStats,
  salesOrderHasDispatchBacklog,
  getWoLineRemainingProductionQty,
  getWoLineProductionPendingQty,
  getWoLineProductionBalanceQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
  getProductionBatchQcPendingQty,
  allocateDispatchFifoAcrossWorkOrderLines,
  getWoTrackingProductionPendingQty,
  getWoTrackingQcPendingQty,
  getWoTrackingDispatchPendingQty,
  deriveWoTrackingOperationalStatus,
  getSalesOrderDispatchCompletionPercent,
  computeWorkOrderTrackingSummaryFromRows,
  computeWorkOrderTrackingSummaryPendingDispatchQtySum,
  assertWorkOrderTrackingSummaryMatches,
  normalizeWorkOrderTrackingApiPayloadForVerification,
};
