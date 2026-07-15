/**
 * NO_QTY dispatch prepare / lock FIFO allocation — shared by draft save, lock, and eligibility.
 */

const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { computeNoQtyDispatchHeadroom } = require("./noQtyDispatchHeadroom");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");
const { REPORT_QUEUE_EPS } = require("./reportMetrics");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function filterNoQtyDispatchRowsForActiveCycle(dispatchRecords, activeCycleId) {
  const want = normalizePositiveCycleId(activeCycleId);
  if (want == null) return [];
  return (dispatchRecords || []).filter((d) => normalizePositiveCycleId(d.cycleId) === want);
}

function netNoQtyCycleDispatchedByItemId(dispatchRecords, mode) {
  const raw = netDispatchedByItemId(dispatchRecords, mode);
  const m = new Map();
  for (const [k, v] of raw) {
    const nk = Number(k);
    if (!Number.isFinite(nk)) continue;
    m.set(nk, (m.get(nk) ?? 0) + num(v));
  }
  return m;
}

function getNoQtyCycleDispatchHeadroomForItem(so, cycleId, itemId, qcMap, recheckMap, postCycleMap, demandByCycleItem) {
  const c = normalizePositiveCycleId(cycleId);
  if (c == null) return 0;
  const qcKey = `${so.id}:${c}:${itemId}`;
  const qcTotal =
    num(qcMap.get(qcKey) ?? 0) + num(recheckMap.get(qcKey) ?? 0) + num(postCycleMap.get(qcKey) ?? 0);
  const net = num(
    netNoQtyCycleDispatchedByItemId(
      filterNoQtyDispatchRowsForActiveCycle(so.dispatch, c),
      DISPATCH_ALLOC_MODE.OPERATIONAL,
    ).get(Number(itemId)) ?? 0,
  );
  return computeNoQtyDispatchHeadroom({
    alreadyOpNet: net,
    customerDemandQty: demandByCycleItem?.get(`${c}:${itemId}`),
    qcAcceptedThisCycle: qcTotal,
  });
}

function getNoQtyUnlockedDraftQtyForItem(so, itemId) {
  return (so.dispatch || [])
    .filter((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED" && Number(d.itemId) === Number(itemId))
    .reduce((s, d) => s + num(d.dispatchedQty), 0);
}

function getNoQtyUnlockedDraftQtyForItemCycle(so, cycleId, itemId) {
  const want = normalizePositiveCycleId(cycleId);
  if (want == null) return 0;
  return (so.dispatch || [])
    .filter(
      (d) =>
        d.reversalOfId == null &&
        d.workflowStatus === "UNLOCKED" &&
        Number(d.itemId) === Number(itemId) &&
        normalizePositiveCycleId(d.cycleId) === want,
    )
    .reduce((s, d) => s + num(d.dispatchedQty), 0);
}

function getNoQtyCycleDispatchHeadroomForPrepare(so, cycleId, itemId, qcMap, recheckMap, postCycleMap, demandByCycleItem) {
  const c = normalizePositiveCycleId(cycleId);
  if (c == null) return 0;
  const replaceable = getNoQtyUnlockedDraftQtyForItemCycle(so, cycleId, itemId);
  const net = num(netNoQtyCycleDispatchedByItemId(filterNoQtyDispatchRowsForActiveCycle(so.dispatch, c), DISPATCH_ALLOC_MODE.OPERATIONAL).get(Number(itemId)));
  const qcKey = `${so.id}:${c}:${itemId}`;
  const qcTotal = num(qcMap.get(qcKey)) + num(recheckMap.get(qcKey)) + num(postCycleMap.get(qcKey));
  return computeNoQtyDispatchHeadroom({
    alreadyOpNet: Math.max(0, net - replaceable),
    customerDemandQty: demandByCycleItem?.get(`${c}:${itemId}`),
    qcAcceptedThisCycle: qcTotal,
  });
}

/**
 * FIFO across sales-order cycles (cycleNo ascending) for one FG item.
 */
function computeNoQtyFifoPrepareSlicesForItem({
  so,
  itemId,
  requestedQty,
  cyclesSorted,
  qcMap,
  recheckMap,
  postCycleMap,
  usableStock,
  unlockedDraftReservedQty,
  replaceableDraftQty,
  demandByCycleItem,
}) {
  let rem = num(requestedQty);
  /** @type {Array<{ cycleId: number; cycleNo: number; qty: number }>} */
  const slices = [];
  let cycleHeadroomTotal = 0;
  for (const c of cyclesSorted) {
    cycleHeadroomTotal += getNoQtyCycleDispatchHeadroomForPrepare(so, c.id, itemId, qcMap, recheckMap, postCycleMap, demandByCycleItem);
  }
  const freePhysicalUsable = Math.max(0, num(usableStock) - num(unlockedDraftReservedQty) + num(replaceableDraftQty));
  const totalAvailable = Math.min(cycleHeadroomTotal, freePhysicalUsable);
  let physicalRemaining = totalAvailable;
  for (const c of cyclesSorted) {
    if (rem <= REPORT_QUEUE_EPS || physicalRemaining <= REPORT_QUEUE_EPS) break;
    const headroom = getNoQtyCycleDispatchHeadroomForPrepare(so, c.id, itemId, qcMap, recheckMap, postCycleMap, demandByCycleItem);
    const take = Math.min(rem, headroom, physicalRemaining);
    if (take > REPORT_QUEUE_EPS) {
      slices.push({ cycleId: c.id, cycleNo: num(c.cycleNo), qty: take });
      rem -= take;
      physicalRemaining -= take;
    }
  }
  return { slices, totalAvailable, cycleHeadroomTotal, freePhysicalUsable, unallocated: Math.max(0, rem) };
}

/**
 * Same gates as draft save (FIFO + usable FG). Throws on failure.
 * @param {object} p
 * @param {(message: string, statusCode?: number) => Error} p.throwError
 */
function assertNoQtyDispatchLockQtyAllowed(
  {
    so,
    itemId,
    qty,
    cycleId,
    cyclesSorted,
    qcMap,
    recheckMap,
    postCycleMap,
    usableStock,
    demandByCycleItem,
  },
  throwError,
) {
  const unlockedDraftReserved = getNoQtyUnlockedDraftQtyForItem(so, itemId);
  const replaceableDraftQty = getNoQtyUnlockedDraftQtyForItemCycle(so, cycleId, itemId);
  const fifo = computeNoQtyFifoPrepareSlicesForItem({
    so,
    itemId,
    requestedQty: qty,
    cyclesSorted,
    qcMap,
    recheckMap,
    postCycleMap,
    usableStock,
    unlockedDraftReservedQty: unlockedDraftReserved,
    replaceableDraftQty: Math.max(replaceableDraftQty, qty),
    demandByCycleItem,
  });
  if (fifo.totalAvailable + REPORT_QUEUE_EPS < qty) {
    throw throwError("Dispatch exceeds current usable stock available for this item.", 400);
  }
  if (fifo.unallocated > REPORT_QUEUE_EPS) {
    throw throwError(
      "Dispatch exceeds dispatchable quantity for available QC and stock. Refresh and adjust the draft.",
      400,
    );
  }
}

/** Derive cycle list for FIFO when full `cyclesSorted` is not preloaded (eligibility badges). */
function deriveNoQtyCyclesSortedForItem(soId, itemId, noQtyQcMaps, dispatchRecords, cycleId) {
  /** @type {Set<number>} */
  const cycleIds = new Set();
  const ingestKey = (key) => {
    const parts = String(key).split(":");
    if (parts.length < 3) return;
    if (Number(parts[0]) !== Number(soId) || Number(parts[2]) !== Number(itemId)) return;
    const c = normalizePositiveCycleId(parts[1]);
    if (c != null) cycleIds.add(c);
  };
  for (const m of [
    noQtyQcMaps?.cycleQcAcceptedMap,
    noQtyQcMaps?.cycleRecheckAcceptedMap,
    noQtyQcMaps?.postCycleApprovalMap,
  ]) {
    for (const key of m?.keys?.() ?? []) ingestKey(key);
  }
  for (const d of dispatchRecords || []) {
    if (Number(d.itemId) !== Number(itemId)) continue;
    const c = normalizePositiveCycleId(d.cycleId);
    if (c != null) cycleIds.add(c);
  }
  const want = normalizePositiveCycleId(cycleId);
  if (want != null) cycleIds.add(want);
  return [...cycleIds].sort((a, b) => a - b).map((id) => ({ id, cycleNo: id }));
}

/**
 * Eligibility mirror of {@link assertNoQtyDispatchLockQtyAllowed} (non-throwing).
 */
function resolveNoQtyFifoLockEligibility({
  so,
  soId,
  itemId,
  draftQty,
  cycleId,
  cyclesSorted,
  onHandUsable,
  noQtyQcMaps,
}) {
  const eps = REPORT_QUEUE_EPS;
  const cycleIdNorm = normalizePositiveCycleId(cycleId);
  if (cycleIdNorm == null) {
    return { state: "WAITING_APPROVAL", reason: "No cycle assigned for this dispatch draft." };
  }
  const qcMap = noQtyQcMaps?.cycleQcAcceptedMap ?? new Map();
  const recheckMap = noQtyQcMaps?.cycleRecheckAcceptedMap ?? new Map();
  const postCycleMap = noQtyQcMaps?.postCycleApprovalMap ?? new Map();
  const soStub = so ?? { id: soId, dispatch: [] };
  const cycles =
    cyclesSorted?.length > 0
      ? cyclesSorted
      : deriveNoQtyCyclesSortedForItem(soId, itemId, noQtyQcMaps, soStub.dispatch, cycleId);
  const unlockedDraftReserved = getNoQtyUnlockedDraftQtyForItem(soStub, itemId);
  const replaceableDraftQty = getNoQtyUnlockedDraftQtyForItemCycle(soStub, cycleIdNorm, itemId);
  const fifo = computeNoQtyFifoPrepareSlicesForItem({
    so: soStub,
    itemId,
    requestedQty: draftQty,
    cyclesSorted: cycles,
    qcMap,
    recheckMap,
    postCycleMap,
    usableStock: onHandUsable,
    unlockedDraftReservedQty: unlockedDraftReserved,
    replaceableDraftQty: Math.max(replaceableDraftQty, draftQty),
  });
  if (fifo.totalAvailable + eps < draftQty) {
    return { state: "WAITING_STOCK", reason: "Insufficient usable stock for dispatch." };
  }
  if (fifo.unallocated > eps) {
    return {
      state: "WAITING_QA",
      reason: "Dispatch exceeds dispatchable quantity for available QC and stock.",
    };
  }
  return { state: "READY", reason: null };
}

module.exports = {
  deriveNoQtyCyclesSortedForItem,
  filterNoQtyDispatchRowsForActiveCycle,
  netNoQtyCycleDispatchedByItemId,
  getNoQtyUnlockedDraftQtyForItem,
  getNoQtyUnlockedDraftQtyForItemCycle,
  getNoQtyCycleDispatchHeadroomForItem,
  getNoQtyCycleDispatchHeadroomForPrepare,
  computeNoQtyFifoPrepareSlicesForItem,
  assertNoQtyDispatchLockQtyAllowed,
  resolveNoQtyFifoLockEligibility,
};
