const {
  DISPATCH_ALLOC_MODE,
  netDispatchedByItemId,
  remainingDispatchCapacityForSoItem,
} = require("./salesOrderDispatchAllocation");
const { usableStockDisplayQty } = require("./stockService");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { loadNoQtyCycleQcAcceptedMap } = require("../routes/dispatch");
const {
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
} = require("./noQtyPostCycleApprovalService");

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round3(v) {
  return Math.round(num(v) * 1000) / 1000;
}

const EPS = 1e-6;

/**
 * Dev-only: set `NO_QTY_USABLE_PLAN_DEBUG=1` to trace commitment / pool / reserve / free surplus.
 * Skipped when NODE_ENV is `production`.
 */
function debugNoQtyUsablePlan(scope, payload) {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.NO_QTY_USABLE_PLAN_DEBUG !== "1") return;
  // eslint-disable-next-line no-console
  console.debug(`[NO_QTY_USABLE_PLAN_DEBUG:${scope}]`, payload);
}

/**
 * Deterministic winning selection for LOCKED requirement sheets of one cycle.
 * Preference order:
 * - higher version (when present)
 * - then periodKey lexical (best-effort tie-break; stable)
 * - then createdAt desc
 * - then id desc
 *
 * NOTE: This is intentionally stricter than "latest by createdAt" to avoid cross-module drift.
 *
 * @param {any} a
 * @param {any} b
 */
function pickWinningLockedRequirementSheet(a, b) {
  if (!a) return b;
  if (!b) return a;
  const vA = num(a.version ?? 0);
  const vB = num(b.version ?? 0);
  if (vA !== vB) return vA > vB ? a : b;
  const pA = String(a.periodKey ?? "");
  const pB = String(b.periodKey ?? "");
  if (pA !== pB) return pA > pB ? a : b;
  const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
  const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
  if (tA !== tB) return tA > tB ? a : b;
  return num(a.id) >= num(b.id) ? a : b;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @returns {Promise<Map<number, number>>} itemId -> global USABLE (floored at 0 for planning)
 */
async function loadTotalUsableByItemId(db) {
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId"],
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const m = new Map();
  for (const r of rows) {
    const itemId = Number(r.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    const raw = num(r._sum.qtyIn) - num(r._sum.qtyOut);
    m.set(itemId, usableStockDisplayQty(raw));
  }
  return m;
}

/**
 * Existing reservation semantics for NORMAL/REPLACEMENT open dispatch commitments (system-wide).
 *
 * reservedNormal[item] = sum(remaining dispatch capacity on open NORMAL/REPLACEMENT sales orders, FIFO per SO line)
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @returns {Promise<Map<number, number>>}
 */
async function computeReservedNormalDispatchQtyByItemForPlanning(db) {
  const openSos = await db.salesOrder.findMany({
    where: {
      orderType: { not: "NO_QTY" },
      internalStatus: { notIn: ["COMPLETED", "CLOSED"] },
    },
    select: {
      id: true,
      lines: { select: { id: true, itemId: true, qty: true, customerPoQty: true } },
    },
  });
  const openSoIds = openSos.map((s) => Number(s.id)).filter((x) => Number.isFinite(x) && x > 0);
  if (!openSoIds.length) return new Map();

  const dispatchRows = await db.dispatch.findMany({
    where: { soId: { in: openSoIds } },
    select: { soId: true, itemId: true, cycleId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true },
  });
  const dispatchBySoId = new Map();
  for (const d of dispatchRows) {
    const id = Number(d.soId);
    if (!dispatchBySoId.has(id)) dispatchBySoId.set(id, []);
    dispatchBySoId.get(id).push(d);
  }

  /** @type {Map<number, number>} */
  const reservedByItem = new Map();
  for (const so of openSos) {
    const soId = Number(so.id);
    const disp = dispatchBySoId.get(soId) ?? [];
    const lineInputs = (so.lines || []).map((l) => ({
      id: Number(l.id),
      itemId: Number(l.itemId),
      qty: num(l.qty ?? l.customerPoQty),
    }));
    const seenItems = new Set(lineInputs.map((l) => l.itemId).filter((x) => Number.isFinite(x) && x > 0));
    for (const itemId of seenItems) {
      const rem = remainingDispatchCapacityForSoItem(lineInputs, disp, itemId);
      if (rem > EPS) reservedByItem.set(itemId, (reservedByItem.get(itemId) ?? 0) + rem);
    }
  }
  return reservedByItem;
}

/**
 * Get the winning LOCKED requirement sheet (and lines) for a specific (SO, cycle).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} soId
 * @param {number} cycleId
 * @returns {Promise<null | { id: number; salesOrderId: number; cycleId: number; periodKey: string | null; version: number | null; createdAt: any; lines: any[] }>}
 */
async function getWinningLockedRequirementSheet(db, soId, cycleId) {
  const sid = Number(soId);
  const cid = Number(cycleId);
  if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(cid) || cid <= 0) return null;

  const sheets = await db.requirementSheet.findMany({
    where: { salesOrderId: sid, cycleId: cid, status: "LOCKED" },
    include: { lines: true },
  });
  if (!sheets.length) return null;
  let win = null;
  for (const sh of sheets) win = pickWinningLockedRequirementSheet(win, sh);
  return win;
}

/**
 * Computes NO_QTY usable planning breakdown for a sales order, using only free surplus usable stock.
 *
 * - Preserves NORMAL/REPLACEMENT reservation semantics by accepting a reservedForNormalDispatchByItem map (optional).
 * - Reserves against NO_QTY cycles FIFO by cycleNo ascending when cycle commitment
 *   is not yet fully covered by **confirmed** dispatch — includes CLOSED cycles with
 *   pending dispatch commitment (excludeCycleId still omits the cycle being planned/locked).
 * - Uses CONFIRMED dispatch basis (LOCKED forwards + reversals; excludes UNLOCKED drafts).
 * - Commitment per cycle+item is from winning LOCKED RS:
 *     commitment = requirementQty + shortfallQtySnapshot
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{
 *   salesOrderId: number;
 *   reservedForNormalDispatchByItem?: Map<number, number>;
 *   excludeCycleId?: number | null;
 *   includeDebugRows?: boolean;
 * }} options
 * @returns {Promise<Map<number, {
 *   totalUsableQty: number;
 *   reservedForNormalDispatchQty: number;
 *   reservedForActiveNoQtyDispatchQty: number;
 *   freeSurplusUsableQty: number;
 *   debugRows?: any[];
 * }>>}
 */
async function computeNoQtyUsablePlanningBreakdownByItem(db, options) {
  const soId = Number(options?.salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return new Map();

  const totalUsableByItem = await loadTotalUsableByItemId(db);
  const reservedNormalByItem = options?.reservedForNormalDispatchByItem ?? new Map();

  const cycles = await db.salesOrderCycle.findMany({
    where: { salesOrderId: soId, status: { in: ["ACTIVE", "CLOSED"] } },
    orderBy: { cycleNo: "asc" },
    select: { id: true, cycleNo: true, status: true },
  });
  const excludeCid = normalizePositiveCycleId(options?.excludeCycleId);
  const fifoCycles = (cycles || []).filter((c) => {
    const cid = normalizePositiveCycleId(c.id);
    if (cid == null) return false;
    if (excludeCid != null && cid === excludeCid) return false;
    return true;
  });

  debugNoQtyUsablePlan("perSo_fifo_scope", {
    salesOrderId: soId,
    excludeCycleId: excludeCid,
    cyclesActiveOrClosed: (cycles || []).map((c) => ({ id: c.id, cycleNo: c.cycleNo, status: c.status })),
    fifoCycleIds: fifoCycles.map((c) => ({ id: c.id, cycleNo: c.cycleNo, status: c.status })),
    note:
      fifoCycles.length === 0
        ? "FIFO empty (exclude removed all cycles — no NO_QTY pending-commitment reserve for this SO in this pass)"
        : undefined,
  });

  // Budget per item after NORMAL/REPLACEMENT reservations.
  /** @type {Map<number, number>} */
  const budgetByItem = new Map();
  for (const [itemId, total0] of totalUsableByItem.entries()) {
    const total = usableStockDisplayQty(total0);
    const resN = Math.max(0, num(reservedNormalByItem.get(itemId) ?? 0));
    budgetByItem.set(itemId, Math.max(0, total - resN));
  }

  // Preload QC/recheck/post maps for cycle pools (inputs are (soId, cycleId)).
  const cycleInputs = fifoCycles.map((c) => ({ id: soId, currentCycleId: c.id }));
  const [qcMap, recheckMap, postMap] =
    cycleInputs.length > 0
      ? await Promise.all([
          loadNoQtyCycleQcAcceptedMap(db, cycleInputs),
          loadNoQtyDispositionUsableForDispatchPoolMap(db, cycleInputs),
          loadNoQtyPostCycleApprovalMapForInputs(db, cycleInputs),
        ])
      : [new Map(), new Map(), new Map()];

  // Load all dispatch rows for these cycles; compute net CONFIRMED by cycle+item.
  const cycleIds = fifoCycles.map((c) => c.id);
  const dispatchRows =
    cycleIds.length > 0
      ? await db.dispatch.findMany({
          where: { soId, cycleId: { in: cycleIds } },
          select: { itemId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true, cycleId: true },
        })
      : [];
  /** @type {Map<string, any[]>} */
  const dispatchByCycleKey = new Map();
  for (const d of dispatchRows) {
    const cid = normalizePositiveCycleId(d.cycleId);
    if (cid == null) continue;
    const k = `${soId}:${cid}`;
    const arr = dispatchByCycleKey.get(k) ?? [];
    arr.push(d);
    dispatchByCycleKey.set(k, arr);
  }

  /** @type {Map<number, any[]>} */
  const debugByItem = new Map();

  // FIFO cycle reservation: older cycles reserve first.
  for (const cyc of fifoCycles) {
    const cid = normalizePositiveCycleId(cyc.id);
    if (cid == null) continue;

    const sheet = await getWinningLockedRequirementSheet(db, soId, cid);
    const lines = sheet?.lines || [];
    if (!lines.length) continue;

    const dispForCycle = dispatchByCycleKey.get(`${soId}:${cid}`) ?? [];
    const netConfirmed = netDispatchedByItemId(dispForCycle, DISPATCH_ALLOC_MODE.CONFIRMED);

    for (const ln of lines) {
      const itemId = Number(ln.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;

      const commitment = Math.max(0, num(ln.requirementQty ?? 0) + num(ln.shortfallQtySnapshot ?? 0));
      if (!(commitment > EPS)) continue;

      const disp = Math.max(0, num(netConfirmed.get(itemId) ?? 0));
      const commitmentRemaining = Math.max(0, commitment - disp);

      const qcKey = `${soId}:${cid}:${itemId}`;
      const qc = num(qcMap.get(qcKey) ?? 0);
      const recheck = num(recheckMap.get(qcKey) ?? 0);
      const post = num(postMap.get(qcKey) ?? 0);
      const poolRemaining = Math.max(0, qc + recheck + post - disp);

      const budget = Math.max(0, num(budgetByItem.get(itemId) ?? 0));
      const reserve = Math.min(budget, poolRemaining, commitmentRemaining);
      if (reserve > EPS) {
        budgetByItem.set(itemId, round3(budget - reserve));
      }

      if (options?.includeDebugRows) {
        const arr = debugByItem.get(itemId) ?? [];
        arr.push({
          cycleId: cid,
          cycleNo: cyc.cycleNo,
          cycleStatus: cyc.status,
          commitment: round3(commitment),
          dispatchedConfirmed: round3(disp),
          commitmentRemaining: round3(commitmentRemaining),
          qc: round3(qc),
          recheck: round3(recheck),
          postCycle: round3(post),
          poolRemaining: round3(poolRemaining),
          reserveApplied: round3(reserve),
          budgetAfter: round3(num(budgetByItem.get(itemId) ?? 0)),
        });
        debugByItem.set(itemId, arr);
      }
    }
  }

  /** @type {Map<number, any>} */
  const out = new Map();
  for (const [itemId, total0] of totalUsableByItem.entries()) {
    const totalUsableQty = round3(usableStockDisplayQty(total0));
    const reservedForNormalDispatchQty = round3(Math.max(0, num(reservedNormalByItem.get(itemId) ?? 0)));
    const budget = round3(Math.max(0, num(budgetByItem.get(itemId) ?? 0)));
    const reservedForActiveNoQtyDispatchQty = round3(
      Math.max(0, totalUsableQty - reservedForNormalDispatchQty - budget),
    );
    const freeSurplusUsableQty = round3(budget);
    out.set(itemId, {
      totalUsableQty,
      reservedForNormalDispatchQty,
      reservedForActiveNoQtyDispatchQty,
      freeSurplusUsableQty,
      ...(options?.includeDebugRows ? { debugRows: debugByItem.get(itemId) ?? [] } : {}),
    });

    const rA = num(reservedForActiveNoQtyDispatchQty);
    if (rA > EPS || (options?.includeDebugRows && debugByItem.has(itemId))) {
      debugNoQtyUsablePlan("perSo_item", {
        salesOrderId: soId,
        itemId,
        totalUsableQty,
        reservedNormal: reservedForNormalDispatchQty,
        reservedPendingNoQtyDispatch: reservedForActiveNoQtyDispatchQty,
        freeSurplusUsable: freeSurplusUsableQty,
        /** Reconciliation: freeSurplus is residual budget only (never budget + Σ surplus). */
        checkTotal: round3(reservedForNormalDispatchQty + reservedForActiveNoQtyDispatchQty + freeSurplusUsableQty),
      });
    }
  }
  return out;
}

/**
 * Global free-surplus usable per item for NO_QTY planning dashboards.
 *
 * This treats global USABLE as one pool and reserves it FIFO across NO_QTY cycles that may still owe
 * **confirmed** dispatch (ACTIVE or CLOSED), ordered by cycleNo asc, then salesOrderId asc.
 *
 * Commitment per cycle+item is from the winning LOCKED RS:
 *   commitment = requirementQty + shortfallQtySnapshot
 *
 * Dispatch basis is CONFIRMED (LOCKED forwards + reversals).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @returns {Promise<Map<number, { totalUsableQty: number; reservedForNormalDispatchQty: number; reservedForActiveNoQtyDispatchQty: number; freeSurplusUsableQty: number }>>}
 */
async function computeGlobalNoQtyUsablePlanningBreakdownByItem(db) {
  const totalUsableByItem = await loadTotalUsableByItemId(db);
  const reservedNormalByItem = await computeReservedNormalDispatchQtyByItemForPlanning(db);

  /** budget = totalUsable - reservedNormal */
  const budgetByItem = new Map();
  for (const [itemId, total0] of totalUsableByItem.entries()) {
    const total = usableStockDisplayQty(total0);
    const resN = Math.max(0, num(reservedNormalByItem.get(itemId) ?? 0));
    budgetByItem.set(itemId, Math.max(0, total - resN));
  }

  const cycles = await db.salesOrderCycle.findMany({
    where: {
      status: { in: ["ACTIVE", "CLOSED"] },
      salesOrder: { orderType: "NO_QTY", internalStatus: { notIn: ["COMPLETED", "CLOSED", "MANUALLY_CLOSED"] } },
    },
    select: { id: true, salesOrderId: true, cycleNo: true, status: true },
    orderBy: [{ cycleNo: "asc" }, { salesOrderId: "asc" }],
  });
  if (!cycles.length) {
    debugNoQtyUsablePlan("global_fifo_scope", { fifoCycleIds: [], reason: "no_no_qty_cycles_for_open_sos" });
    const out = new Map();
    for (const [itemId, total0] of totalUsableByItem.entries()) {
      const totalUsableQty = round3(usableStockDisplayQty(total0));
      const reservedForNormalDispatchQty = round3(Math.max(0, num(reservedNormalByItem.get(itemId) ?? 0)));
      const freeSurplusUsableQty = round3(Math.max(0, num(budgetByItem.get(itemId) ?? 0)));
      out.set(itemId, {
        totalUsableQty,
        reservedForNormalDispatchQty,
        reservedForActiveNoQtyDispatchQty: 0,
        freeSurplusUsableQty,
      });
    }
    return out;
  }

  debugNoQtyUsablePlan("global_fifo_scope", {
    fifoCycleIds: cycles.map((c) => ({
      salesOrderId: c.salesOrderId,
      cycleId: c.id,
      cycleNo: c.cycleNo,
      status: c.status,
    })),
  });

  const cycleInputs = cycles.map((c) => ({ id: c.salesOrderId, currentCycleId: c.id }));
  const [qcMap, recheckMap, postMap] = await Promise.all([
    loadNoQtyCycleQcAcceptedMap(db, cycleInputs),
    loadNoQtyDispositionUsableForDispatchPoolMap(db, cycleInputs),
    loadNoQtyPostCycleApprovalMapForInputs(db, cycleInputs),
  ]);

  const cycleIds = cycles.map((c) => c.id);
  const dispatchRows = await db.dispatch.findMany({
    where: { soId: { in: [...new Set(cycles.map((c) => c.salesOrderId))] }, cycleId: { in: cycleIds } },
    select: { itemId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true, cycleId: true, soId: true },
  });
  const dispatchBySoCycle = new Map();
  for (const d of dispatchRows) {
    const sid = Number(d.soId);
    const cid = normalizePositiveCycleId(d.cycleId);
    if (!Number.isFinite(sid) || sid <= 0 || cid == null) continue;
    const k = `${sid}:${cid}`;
    const arr = dispatchBySoCycle.get(k) ?? [];
    arr.push(d);
    dispatchBySoCycle.set(k, arr);
  }

  for (const cyc of cycles) {
    const sid = Number(cyc.salesOrderId);
    const cid = normalizePositiveCycleId(cyc.id);
    if (!Number.isFinite(sid) || sid <= 0 || cid == null) continue;

    const sheet = await getWinningLockedRequirementSheet(db, sid, cid);
    const lines = sheet?.lines || [];
    if (!lines.length) continue;

    const dispRowsOne = dispatchBySoCycle.get(`${sid}:${cid}`) ?? [];
    const netConfirmed = netDispatchedByItemId(dispRowsOne, DISPATCH_ALLOC_MODE.CONFIRMED);

    for (const ln of lines) {
      const itemId = Number(ln.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      const commitment = Math.max(0, num(ln.requirementQty ?? 0) + num(ln.shortfallQtySnapshot ?? 0));
      if (!(commitment > EPS)) continue;

      const disp = Math.max(0, num(netConfirmed.get(itemId) ?? 0));
      const commitmentRemaining = Math.max(0, commitment - disp);

      const qcKey = `${sid}:${cid}:${itemId}`;
      const qc = num(qcMap.get(qcKey) ?? 0);
      const recheck = num(recheckMap.get(qcKey) ?? 0);
      const post = num(postMap.get(qcKey) ?? 0);
      const poolRemaining = Math.max(0, qc + recheck + post - disp);

      const budget = Math.max(0, num(budgetByItem.get(itemId) ?? 0));
      const reserve = Math.min(budget, poolRemaining, commitmentRemaining);
      if (reserve > EPS) budgetByItem.set(itemId, round3(budget - reserve));
    }
  }

  const out = new Map();
  for (const [itemId, total0] of totalUsableByItem.entries()) {
    const totalUsableQty = round3(usableStockDisplayQty(total0));
    const reservedForNormalDispatchQty = round3(Math.max(0, num(reservedNormalByItem.get(itemId) ?? 0)));
    const budget = round3(Math.max(0, num(budgetByItem.get(itemId) ?? 0)));
    const reservedForActiveNoQtyDispatchQty = round3(
      Math.max(0, totalUsableQty - reservedForNormalDispatchQty - budget),
    );
    out.set(itemId, {
      totalUsableQty,
      reservedForNormalDispatchQty,
      reservedForActiveNoQtyDispatchQty,
      freeSurplusUsableQty: round3(budget),
    });

    const rA = num(reservedForActiveNoQtyDispatchQty);
    if (rA > EPS) {
      debugNoQtyUsablePlan("global_item", {
        itemId,
        totalUsableQty,
        reservedNormal: reservedForNormalDispatchQty,
        reservedPendingNoQtyDispatch: reservedForActiveNoQtyDispatchQty,
        freeSurplusUsable: round3(budget),
        checkTotal: round3(reservedForNormalDispatchQty + reservedForActiveNoQtyDispatchQty + round3(budget)),
      });
    }
  }
  return out;
}

module.exports = {
  pickWinningLockedRequirementSheet,
  getWinningLockedRequirementSheet,
  computeNoQtyUsablePlanningBreakdownByItem,
  loadTotalUsableByItemId,
  computeReservedNormalDispatchQtyByItemForPlanning,
  computeGlobalNoQtyUsablePlanningBreakdownByItem,
};

