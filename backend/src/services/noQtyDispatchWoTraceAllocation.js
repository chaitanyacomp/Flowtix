/**
 * NO_QTY dispatch WO/production/QC FIFO traceability.
 *
 * Dispatch scope remains SO + FG + RS cycle (never a WO gate).
 * These helpers allocate accepted FG across QC lots for audit/reversal only.
 */

const { REPORT_QUEUE_EPS } = require("./reportMetrics");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round3(v) {
  return Math.round(num(v) * 1000) / 1000;
}

/**
 * @typedef {{
 *   qcEntryId: number | null;
 *   productionId: number | null;
 *   workOrderId: number | null;
 *   acceptedQty: number;
 *   lotKey: string;
 * }} NoQtyQcAcceptedLot
 */

/**
 * @typedef {{
 *   qcEntryId: number | null;
 *   productionId: number | null;
 *   workOrderId: number | null;
 *   itemId: number;
 *   cycleId: number | null;
 *   allocatedQty: number;
 *   sortOrder: number;
 *   lotKey: string;
 * }} NoQtyDispatchTraceSlice
 */

function lotKeyFor(row) {
  if (row?.qcEntryId != null && Number(row.qcEntryId) > 0) return `qc:${Number(row.qcEntryId)}`;
  if (row?.productionId != null && Number(row.productionId) > 0) return `pe:${Number(row.productionId)}`;
  if (row?.workOrderId != null && Number(row.workOrderId) > 0) return `wo:${Number(row.workOrderId)}`;
  return `unattributed`;
}

/**
 * FIFO allocate requested qty across QC-accepted lots after subtracting prior net consumption.
 * @param {{
 *   lots: NoQtyQcAcceptedLot[];
 *   previouslyConsumedByLotKey?: Map<string, number> | Record<string, number>;
 *   requestedQty: number;
 *   itemId: number;
 *   cycleId: number | null;
 * }} p
 * @returns {{ slices: NoQtyDispatchTraceSlice[]; allocatedQty: number; unallocatedQty: number }}
 */
function allocateNoQtyDispatchFifoAcrossQcLots(p) {
  const requested = round3(Math.max(0, num(p.requestedQty)));
  /** @type {Map<string, number>} */
  const consumed = new Map();
  const prior = p.previouslyConsumedByLotKey;
  if (prior instanceof Map) {
    for (const [k, v] of prior) consumed.set(String(k), num(v));
  } else if (prior && typeof prior === "object") {
    for (const [k, v] of Object.entries(prior)) consumed.set(String(k), num(v));
  }

  let rem = requested;
  /** @type {NoQtyDispatchTraceSlice[]} */
  const slices = [];
  let sortOrder = 0;
  for (const lot of p.lots || []) {
    if (rem <= REPORT_QUEUE_EPS) break;
    const key = lot.lotKey || lotKeyFor(lot);
    const remainingAccepted = Math.max(0, num(lot.acceptedQty) - num(consumed.get(key) ?? 0));
    const take = round3(Math.min(rem, remainingAccepted));
    if (take <= REPORT_QUEUE_EPS) continue;
    slices.push({
      qcEntryId: lot.qcEntryId != null ? Number(lot.qcEntryId) : null,
      productionId: lot.productionId != null ? Number(lot.productionId) : null,
      workOrderId: lot.workOrderId != null ? Number(lot.workOrderId) : null,
      itemId: Number(p.itemId),
      cycleId: p.cycleId != null ? Number(p.cycleId) : null,
      allocatedQty: take,
      sortOrder: sortOrder++,
      lotKey: key,
    });
    rem = round3(rem - take);
    consumed.set(key, num(consumed.get(key) ?? 0) + take);
  }

  // If QC pool is short but stock gate already passed, keep an unattributed remainder for audit completeness.
  if (rem > REPORT_QUEUE_EPS) {
    slices.push({
      qcEntryId: null,
      productionId: null,
      workOrderId: null,
      itemId: Number(p.itemId),
      cycleId: p.cycleId != null ? Number(p.cycleId) : null,
      allocatedQty: rem,
      sortOrder: sortOrder++,
      lotKey: "unattributed",
    });
    rem = 0;
  }

  const allocatedQty = round3(slices.reduce((s, x) => s + num(x.allocatedQty), 0));
  return { slices, allocatedQty, unallocatedQty: round3(Math.max(0, requested - allocatedQty)) };
}

/**
 * Unwind prior FIFO allocations LIFO for a reverse qty (exact restore of underlying lots).
 * @param {{
 *   originalAllocations: Array<{ qcEntryId?: number | null; productionId?: number | null; workOrderId?: number | null; allocatedQty: number; sortOrder?: number; itemId?: number; cycleId?: number | null }>;
 *   alreadyReversedByLotKey?: Map<string, number> | Record<string, number>;
 *   reverseQty: number;
 *   itemId: number;
 *   cycleId: number | null;
 * }} p
 * @returns {{ slices: NoQtyDispatchTraceSlice[]; restoredQty: number; unallocatedQty: number }}
 */
function unwindNoQtyDispatchFifoAllocations(p) {
  const reverseQty = round3(Math.max(0, num(p.reverseQty)));
  /** @type {Map<string, number>} */
  const already = new Map();
  const prior = p.alreadyReversedByLotKey;
  if (prior instanceof Map) {
    for (const [k, v] of prior) already.set(String(k), num(v));
  } else if (prior && typeof prior === "object") {
    for (const [k, v] of Object.entries(prior)) already.set(String(k), num(v));
  }

  const originals = [...(p.originalAllocations || [])]
    .map((row, idx) => ({
      ...row,
      sortOrder: row.sortOrder != null ? Number(row.sortOrder) : idx,
      lotKey: lotKeyFor(row),
      allocatedQty: num(row.allocatedQty),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  /** Remaining forward attribution per lot after prior partial reverses. */
  /** @type {Map<string, number>} */
  const remainingByKey = new Map();
  /** @type {Array<{ row: typeof originals[number]; remaining: number }>} */
  const stack = [];
  for (const row of originals) {
    const taken = num(already.get(row.lotKey) ?? 0);
    const remaining = round3(Math.max(0, row.allocatedQty - taken));
    remainingByKey.set(row.lotKey, num(remainingByKey.get(row.lotKey) ?? 0) + remaining);
    if (remaining > REPORT_QUEUE_EPS) stack.push({ row, remaining });
  }

  let rem = reverseQty;
  /** @type {NoQtyDispatchTraceSlice[]} */
  const slices = [];
  let sortOrder = 0;
  for (let i = stack.length - 1; i >= 0 && rem > REPORT_QUEUE_EPS; i -= 1) {
    const entry = stack[i];
    const take = round3(Math.min(rem, entry.remaining));
    if (take <= REPORT_QUEUE_EPS) continue;
    slices.push({
      qcEntryId: entry.row.qcEntryId != null ? Number(entry.row.qcEntryId) : null,
      productionId: entry.row.productionId != null ? Number(entry.row.productionId) : null,
      workOrderId: entry.row.workOrderId != null ? Number(entry.row.workOrderId) : null,
      itemId: Number(p.itemId ?? entry.row.itemId),
      cycleId: p.cycleId != null ? Number(p.cycleId) : entry.row.cycleId != null ? Number(entry.row.cycleId) : null,
      allocatedQty: -take,
      sortOrder: sortOrder++,
      lotKey: entry.row.lotKey,
    });
    rem = round3(rem - take);
  }

  if (rem > REPORT_QUEUE_EPS) {
    slices.push({
      qcEntryId: null,
      productionId: null,
      workOrderId: null,
      itemId: Number(p.itemId),
      cycleId: p.cycleId != null ? Number(p.cycleId) : null,
      allocatedQty: -rem,
      sortOrder: sortOrder++,
      lotKey: "unattributed",
    });
    rem = 0;
  }

  const restoredQty = round3(Math.abs(slices.reduce((s, x) => s + num(x.allocatedQty), 0)));
  return { slices, restoredQty, unallocatedQty: rem };
}

/**
 * Sum net allocated qty by lot key (forward positive, reverse negative).
 * @param {Array<{ qcEntryId?: number | null; productionId?: number | null; workOrderId?: number | null; allocatedQty: number }>} rows
 * @returns {Map<string, number>}
 */
function netTraceAllocatedQtyByLotKey(rows) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const row of rows || []) {
    const key = lotKeyFor(row);
    m.set(key, round3(num(m.get(key) ?? 0) + num(row.allocatedQty)));
  }
  return m;
}

module.exports = {
  lotKeyFor,
  allocateNoQtyDispatchFifoAcrossQcLots,
  unwindNoQtyDispatchFifoAllocations,
  netTraceAllocatedQtyByLotKey,
};
