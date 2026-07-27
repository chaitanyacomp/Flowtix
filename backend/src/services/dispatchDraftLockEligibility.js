/**
 * Draft lock eligibility — informational state for UNLOCKED dispatch rows.
 *
 * Draft create is intentionally permissive (Store may prepare before QA completes).
 * LOCK remains the authoritative gate (QC pool, USABLE stock, SO balance).
 *
 * @typedef {'READY' | 'WAITING_QA' | 'WAITING_STOCK' | 'WAITING_APPROVAL'} DispatchDraftLockEligibilityState
 */

const { STOCK_EPS } = require("./stockService");
const {
  remainingDispatchCapacityForSoItem,
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
} = require("./salesOrderDispatchAllocation");
const { getSoItemDispatchShipCap, REPORT_QUEUE_EPS } = require("./reportMetrics");
const { resolveNoQtyFifoLockEligibility } = require("./noQtyDispatchFifoAllocation");
const { normalizePositiveCycleId } = require("../utils/cycleIds");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function onHandForItem(onHandByItemId, itemId) {
  if (!onHandByItemId) return 0;
  if (typeof onHandByItemId.get === "function") {
    return Math.max(0, num(onHandByItemId.get(itemId)));
  }
  return Math.max(0, num(onHandByItemId[itemId]));
}

function mapGet(m, key) {
  if (!m) return 0;
  if (typeof m.get === "function") return num(m.get(key));
  return num(m[key]);
}

/**
 * @param {Array<{ cycleId?: number | null }>} dispatchRecords
 * @param {number | null | undefined} cycleId
 */
function filterDispatchRowsForCycle(dispatchRecords, cycleId) {
  const want = normalizePositiveCycleId(cycleId);
  if (want == null) return [];
  return (dispatchRecords || []).filter((d) => normalizePositiveCycleId(d.cycleId) === want);
}

/**
 * @param {object} p
 * @returns {{ state: DispatchDraftLockEligibilityState; reason: string | null }}
 */
function resolveRegularDispatchDraftLockEligibility(p) {
  const {
    orderType,
    internalStatus,
    itemId,
    draftQty,
    lineInputs,
    dispatchRecords,
    onHandUsable,
    qcAcceptedGross,
    replacementQcGross,
  } = p;

  if (internalStatus === "DRAFT") {
    return { state: "WAITING_APPROVAL", reason: "Dispatch requires an approved sales order." };
  }
  if (internalStatus === "MANUALLY_CLOSED" || internalStatus === "CLOSED_WITH_WAIVER" || internalStatus === "CLOSED") {
    return { state: "WAITING_APPROVAL", reason: "Sales order is closed for dispatch." };
  }

  const bucketRemaining = remainingDispatchCapacityForSoItem(lineInputs, dispatchRecords, itemId);
  if (draftQty > bucketRemaining + STOCK_EPS) {
    return { state: "WAITING_APPROVAL", reason: "Dispatch qty exceeds remaining sales order line balance." };
  }

  const netOp = netDispatchedByItemId(dispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL).get(itemId) ?? 0;

  if (orderType === "REPLACEMENT") {
    const qcGross = num(replacementQcGross ?? qcAcceptedGross);
    const poolShipCap = getSoItemDispatchShipCap({
      orderType: "REPLACEMENT",
      onHandQty: 0,
      qcAcceptedTotalForSoItem: qcGross,
      netDispatchedOperationalForSoItem: netOp,
    });
    const allowedQty = Math.min(poolShipCap, onHandUsable);
    if (draftQty > allowedQty + STOCK_EPS) {
      if (draftQty > poolShipCap + STOCK_EPS) {
        return {
          state: "WAITING_QA",
          reason: "Dispatch exceeds replacement return QC pool for this sales order.",
        };
      }
      return { state: "WAITING_STOCK", reason: "Insufficient usable stock for dispatch." };
    }
    return { state: "READY", reason: null };
  }

  const qcGross = num(qcAcceptedGross);
  const qcRemaining = Math.max(0, qcGross - netOp);
  if (draftQty > qcRemaining + STOCK_EPS) {
    return { state: "WAITING_QA", reason: "Dispatch exceeds QC-approved quantity for this sales order." };
  }

  const allowedQty = getSoItemDispatchShipCap({
    orderType: "NORMAL",
    onHandQty: onHandUsable,
    qcAcceptedTotalForSoItem: qcGross,
    netDispatchedOperationalForSoItem: netOp,
  });
  if (draftQty > allowedQty + STOCK_EPS || draftQty > onHandUsable + STOCK_EPS) {
    return { state: "WAITING_STOCK", reason: "Insufficient usable stock for dispatch." };
  }

  return { state: "READY", reason: null };
}

/**
 * @param {object} p
 * @returns {{ state: DispatchDraftLockEligibilityState; reason: string | null }}
 */
function resolveNoQtyDispatchDraftLockEligibility(p) {
  const {
    internalStatus,
    soId,
    itemId,
    draftQty,
    dispatchRecordsAll,
    cycleId,
    onHandUsable,
    noQtyQcMaps,
    noQtyCyclesSorted,
  } = p;

  if (internalStatus === "MANUALLY_CLOSED" || internalStatus === "CLOSED_WITH_WAIVER" || internalStatus === "CLOSED") {
    return { state: "WAITING_APPROVAL", reason: "Sales order is closed for dispatch." };
  }

  return resolveNoQtyFifoLockEligibility({
    so: { id: soId, dispatch: dispatchRecordsAll || [] },
    soId,
    itemId,
    draftQty,
    cycleId,
    cyclesSorted: noQtyCyclesSorted,
    onHandUsable,
    noQtyQcMaps,
    demandByCycleItem: p.demandByCycleItem ?? null,
    unlockedDraftReservedQty: p.unlockedDraftReservedQty,
  });
}

/**
 * Resolve lock eligibility for one draft row (same gates as POST /dispatches/:id/lock, without throwing).
 *
 * @param {object} ctx
 * @returns {{ state: DispatchDraftLockEligibilityState; reason: string | null }}
 */
function resolveDispatchDraftLockEligibility(ctx) {
  const draftQty = num(ctx.draftQty);
  if (draftQty <= STOCK_EPS) {
    return { state: "READY", reason: null };
  }

  const dispatchId = ctx.dispatchId;
  const dispatchRecordsAll = ctx.dispatchRecords || [];
  const others = dispatchRecordsAll.filter((d) => Number(d.id) !== Number(dispatchId));
  const onHandUsable = onHandForItem(ctx.onHandByItemId, ctx.itemId);

  if (ctx.orderType === "NO_QTY") {
    return resolveNoQtyDispatchDraftLockEligibility({
      internalStatus: ctx.internalStatus,
      soId: ctx.soId,
      itemId: ctx.itemId,
      draftQty,
      dispatchRecords: others,
      dispatchRecordsAll,
      cycleId: ctx.cycleId,
      onHandUsable,
      noQtyQcMaps: ctx.noQtyQcMaps,
      noQtyCyclesSorted: ctx.noQtyCyclesSorted,
      demandByCycleItem: ctx.demandByCycleItem,
      unlockedDraftReservedQty: ctx.unlockedDraftReservedByItemId?.get?.(Number(ctx.itemId)),
    });
  }

  return resolveRegularDispatchDraftLockEligibility({
    orderType: ctx.orderType,
    internalStatus: ctx.internalStatus,
    itemId: ctx.itemId,
    draftQty,
    lineInputs: ctx.lineInputs || [],
    dispatchRecords: others,
    onHandUsable,
    qcAcceptedGross: ctx.qcAcceptedGross,
    replacementQcGross: ctx.replacementQcGross,
  });
}

/**
 * @param {object} so
 * @param {object} deps
 */
function buildDispatchDraftLockEligibilityContext(so, deps) {
  return {
    orderType: so.orderType,
    internalStatus: so.internalStatus,
    soId: so.id,
    customerReturnId: so.customerReturnId ?? null,
    lineInputs: deps.lineInputs,
    dispatchRecords: so.dispatch || [],
    onHandByItemId: deps.onHandByItemId,
    qcAcceptedMap: deps.qcAcceptedMap,
    replacementQcGrossBySoItem: deps.replacementQcGrossBySoItem,
    noQtyQcMaps: deps.noQtyQcMaps ?? null,
    noQtyCyclesSorted: deps.noQtyCyclesSorted ?? null,
    demandByCycleItem: deps.demandByCycleItem ?? null,
    unlockedDraftReservedByItemId: deps.unlockedDraftReservedByItemId ?? null,
  };
}

/**
 * @param {Array<Record<string, unknown>>} dispatchRows
 * @param {ReturnType<typeof buildDispatchDraftLockEligibilityContext> | null | undefined} eligibilityContext
 */
function attachDraftLockEligibilityToDispatchRows(dispatchRows, eligibilityContext) {
  if (!eligibilityContext) return dispatchRows || [];
  return (dispatchRows || []).map((d) => {
    if (d.reversalOfId != null || d.workflowStatus !== "UNLOCKED") {
      return d;
    }
    const itemId = Number(d.itemId);
    const repKey = `${eligibilityContext.soId}:${itemId}`;
    let qcGross = mapGet(eligibilityContext.qcAcceptedMap, repKey);
    if (
      eligibilityContext.orderType === "REPLACEMENT" &&
      eligibilityContext.replacementQcGrossBySoItem?.has?.(repKey)
    ) {
      qcGross = num(eligibilityContext.replacementQcGrossBySoItem.get(repKey));
    }
    const { state, reason } = resolveDispatchDraftLockEligibility({
      ...eligibilityContext,
      itemId,
      draftQty: d.dispatchedQty,
      dispatchId: d.id,
      cycleId: d.cycleId,
      qcAcceptedGross: qcGross,
      replacementQcGross: qcGross,
    });
    return {
      ...d,
      draftLockEligibility: state,
      draftLockEligibilityReason: reason,
    };
  });
}

module.exports = {
  resolveDispatchDraftLockEligibility,
  resolveRegularDispatchDraftLockEligibility,
  resolveNoQtyDispatchDraftLockEligibility,
  buildDispatchDraftLockEligibilityContext,
  attachDraftLockEligibilityToDispatchRows,
};
