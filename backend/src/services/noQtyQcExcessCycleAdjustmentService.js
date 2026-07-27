/**
 * NO_QTY — post-QC WO excess adjustments onto the latest ACTIVE cycle (same SO + FG).
 *
 * Rolling multi-cycle design:
 * - Finalize RS with confirmed quantities only; Pending QC never locks finalize.
 * - Later QC accept of WO excess reduces the active cycle's production requirement (overlay).
 * - Rejected surplus does not create QC rejection recovery (demand-backed scrap keeps Keep/Waive).
 * - Never rewrite CLOSED / finalized cycle RS snapshots.
 * - If no ACTIVE cycle exists, store UNAPPLIED and consume exactly once when the next cycle is created.
 * - REGULAR_SO is isolated (no-op).
 */

const {
  EPS,
  computeWoLineProducedExcessSplit,
} = require("./noQtyProductionExcessRecoveryService");

const APPLICATION_MODE = Object.freeze({
  /** Active cycle still DRAFT (or no RS) — live accepted-excess math covers the credit. */
  LIVE: "LIVE",
  /** Active cycle RS already LOCKED — credit overlays frozen snapshot remaining. */
  OVERLAY: "OVERLAY",
  /** No ACTIVE cycle yet — wait for next cycle create. */
  UNAPPLIED: "UNAPPLIED",
});

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

/** Pure: delta of WO excess between pre/post QC splits. */
function computeQcExcessDecisionDelta(beforeSplit, afterSplit) {
  const before = beforeSplit || {};
  const after = afterSplit || {};
  return {
    acceptedExcessDeltaQty: Math.max(
      0,
      round3(n(after.acceptedWoExcessQty) - n(before.acceptedWoExcessQty)),
    ),
    rejectedSurplusDeltaQty: Math.max(
      0,
      round3(n(after.rejectedWoExcessQty) - n(before.rejectedWoExcessQty)),
    ),
    pendingExcessDeltaQty: round3(n(after.producedExcessPendingQcQty) - n(before.producedExcessPendingQcQty)),
  };
}

/**
 * Pure: reduce locked-cycle production requirement by carried accepted-excess overlay credits.
 * Does not mutate snapshots — callers apply as a display/planning overlay only.
 */
function applyCarriedAcceptedExcessCredit({
  lockedProductionRequirementQty = 0,
  carriedAcceptedExcessCreditQty = 0,
} = {}) {
  const locked = Math.max(0, round3(lockedProductionRequirementQty));
  const credit = Math.max(0, round3(carriedAcceptedExcessCreditQty));
  const applied = Math.max(0, round3(Math.min(credit, locked)));
  return {
    lockedProductionRequirementQty: locked,
    carriedAcceptedExcessCreditQty: credit,
    appliedCreditQty: applied,
    effectiveProductionRequirementQty: Math.max(0, round3(locked - applied)),
    unusedCreditQty: Math.max(0, round3(credit - applied)),
  };
}

/**
 * Pure idempotent consume: each consumptionKey applies at most once.
 * @param {Array<{ consumptionKey: string; acceptedExcessDeltaQty?: number; rejectedSurplusDeltaQty?: number; appliedCycleId?: number|null; applicationMode?: string|null }>} existing
 * @param {Array<{ consumptionKey: string; acceptedExcessDeltaQty?: number; rejectedSurplusDeltaQty?: number }>} incoming
 * @param {{ activeCycleId: number|null; applicationMode: string }} target
 */
function planQcExcessAdjustmentConsumption(existing, incoming, target) {
  const seen = new Set((existing || []).map((r) => String(r.consumptionKey)));
  const toInsert = [];
  for (const row of incoming || []) {
    const key = String(row?.consumptionKey || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const accepted = Math.max(0, round3(row.acceptedExcessDeltaQty));
    const rejected = Math.max(0, round3(row.rejectedSurplusDeltaQty));
    if (accepted <= EPS && rejected <= EPS) continue;
    const mode = target?.activeCycleId != null ? target.applicationMode : APPLICATION_MODE.UNAPPLIED;
    toInsert.push({
      consumptionKey: key,
      acceptedExcessDeltaQty: accepted,
      rejectedSurplusDeltaQty: rejected,
      appliedCycleId: mode === APPLICATION_MODE.UNAPPLIED ? null : Number(target.activeCycleId),
      applicationMode: mode,
    });
  }
  return { toInsert, alreadyConsumedKeys: [...seen] };
}

/** Pure recalculation — summing overlay credits is idempotent. */
function sumOverlayAcceptedExcessCreditsByItem(rows, cycleId) {
  /** @type {Map<number, number>} */
  const out = new Map();
  const cid = Number(cycleId);
  if (!(cid > 0)) return out;
  for (const row of rows || []) {
    if (Number(row.appliedCycleId) !== cid) continue;
    if (String(row.applicationMode) !== APPLICATION_MODE.OVERLAY) continue;
    const itemId = Number(row.itemId);
    const qty = Math.max(0, round3(row.acceptedExcessDeltaQty));
    if (!(itemId > 0) || qty <= EPS) continue;
    out.set(itemId, round3((out.get(itemId) || 0) + qty));
  }
  return out;
}

function buildQcEntryConsumptionKey(qcEntryId) {
  return `qcEntry:${Number(qcEntryId)}:woExcess`;
}

/**
 * Resolve how a new QC excess decision should land on the active cycle.
 */
async function resolveQcExcessApplicationTarget(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { orderType: true, currentCycleId: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    return { orderType: so?.orderType ?? null, activeCycleId: null, applicationMode: APPLICATION_MODE.UNAPPLIED };
  }
  const active = await tx.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true },
  });
  const activeCycleId = active?.id != null ? Number(active.id) : null;
  if (activeCycleId == null) {
    return { orderType: "NO_QTY", activeCycleId: null, applicationMode: APPLICATION_MODE.UNAPPLIED };
  }
  const lockedRs = await tx.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId: activeCycleId, status: "LOCKED" },
    select: { id: true },
  });
  return {
    orderType: "NO_QTY",
    activeCycleId,
    applicationMode: lockedRs ? APPLICATION_MODE.OVERLAY : APPLICATION_MODE.LIVE,
  };
}

/**
 * Record QC WO-excess decision and apply/consume once onto the active cycle when possible.
 * Rejected surplus is stored for audit only — never creates recovery here.
 */
async function recordNoQtyQcExcessDecision(tx, input) {
  const salesOrderId = Number(input?.salesOrderId);
  const itemId = Number(input?.itemId);
  const sourceCycleId = Number(input?.sourceCycleId);
  const qcEntryId = Number(input?.qcEntryId);
  const productionEntryId = Number(input?.productionEntryId) || null;
  const sourceWorkOrderId = Number(input?.sourceWorkOrderId) || null;
  const sourceWorkOrderLineId = Number(input?.sourceWorkOrderLineId) || null;

  if (!(salesOrderId > 0) || !(itemId > 0) || !(qcEntryId > 0)) {
    return { recorded: false, reason: "INVALID_INPUT" };
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { orderType: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    return { recorded: false, reason: "NOT_NO_QTY" };
  }

  const before = computeWoLineProducedExcessSplit({
    plannedQty: input.plannedQty,
    producedQty: input.producedQty,
    acceptedQty: input.acceptedQtyBefore,
    rejectedQty: input.rejectedQtyBefore,
  });
  const after = computeWoLineProducedExcessSplit({
    plannedQty: input.plannedQty,
    producedQty: input.producedQty,
    acceptedQty: input.acceptedQtyAfter,
    rejectedQty: input.rejectedQtyAfter,
  });
  const delta = computeQcExcessDecisionDelta(before, after);
  if (delta.acceptedExcessDeltaQty <= EPS && delta.rejectedSurplusDeltaQty <= EPS) {
    return { recorded: false, reason: "NO_EXCESS_DELTA", delta };
  }

  const consumptionKey = buildQcEntryConsumptionKey(qcEntryId);
  const existing = await tx.noQtyQcExcessCycleAdjustment.findUnique({
    where: { consumptionKey },
  });
  if (existing) {
    return { recorded: false, reason: "ALREADY_CONSUMED", existing, delta };
  }

  const target = await resolveQcExcessApplicationTarget(tx, salesOrderId);
  const now = new Date();
  const row = await tx.noQtyQcExcessCycleAdjustment.create({
    data: {
      salesOrderId,
      itemId,
      sourceCycleId: sourceCycleId > 0 ? sourceCycleId : null,
      sourceWorkOrderId,
      sourceWorkOrderLineId,
      sourceProductionEntryId: productionEntryId,
      sourceQcEntryId: qcEntryId,
      acceptedExcessDeltaQty: String(delta.acceptedExcessDeltaQty),
      rejectedSurplusDeltaQty: String(delta.rejectedSurplusDeltaQty),
      consumptionKey,
      applicationMode: target.applicationMode,
      appliedCycleId: target.applicationMode === APPLICATION_MODE.UNAPPLIED ? null : target.activeCycleId,
      appliedAt: target.applicationMode === APPLICATION_MODE.UNAPPLIED ? null : now,
    },
  });

  return {
    recorded: true,
    reason: "OK",
    delta,
    row,
    applicationMode: target.applicationMode,
    appliedCycleId: row.appliedCycleId != null ? Number(row.appliedCycleId) : null,
  };
}

/**
 * Consume UNAPPLIED adjustments exactly once onto a newly created ACTIVE cycle.
 */
async function consumeUnappliedNoQtyQcExcessAdjustmentsForCycle(tx, { salesOrderId, cycleId }) {
  const soId = Number(salesOrderId);
  const cid = Number(cycleId);
  if (!(soId > 0) || !(cid > 0)) return { consumed: 0, rows: [] };

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { orderType: true },
  });
  if (!so || so.orderType !== "NO_QTY") return { consumed: 0, rows: [] };

  const unapplied = await tx.noQtyQcExcessCycleAdjustment.findMany({
    where: {
      salesOrderId: soId,
      applicationMode: APPLICATION_MODE.UNAPPLIED,
      appliedCycleId: null,
    },
    orderBy: { id: "asc" },
  });
  if (!unapplied.length) return { consumed: 0, rows: [] };

  // New cycle has no LOCKED RS yet → LIVE (draft/live math will pick up accepted excess).
  const now = new Date();
  const ids = unapplied.map((r) => r.id);
  await tx.noQtyQcExcessCycleAdjustment.updateMany({
    where: { id: { in: ids }, applicationMode: APPLICATION_MODE.UNAPPLIED, appliedCycleId: null },
    data: {
      applicationMode: APPLICATION_MODE.LIVE,
      appliedCycleId: cid,
      appliedAt: now,
    },
  });

  const rows = await tx.noQtyQcExcessCycleAdjustment.findMany({
    where: { id: { in: ids } },
  });
  return { consumed: rows.length, rows };
}

/**
 * Overlay credits applied to a cycle (LOCKED RS remaining reduction). Idempotent sum.
 * @returns {Promise<Map<number, number>>} itemId → credit qty
 */
async function loadNoQtyQcExcessOverlayCreditsByItem(tx, { salesOrderId, cycleId }) {
  const soId = Number(salesOrderId);
  const cid = Number(cycleId);
  if (!(soId > 0) || !(cid > 0)) return new Map();

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { orderType: true },
  });
  if (!so || so.orderType !== "NO_QTY") return new Map();

  const rows = await tx.noQtyQcExcessCycleAdjustment.findMany({
    where: {
      salesOrderId: soId,
      appliedCycleId: cid,
      applicationMode: APPLICATION_MODE.OVERLAY,
    },
    select: { itemId: true, acceptedExcessDeltaQty: true, appliedCycleId: true, applicationMode: true },
  });
  return sumOverlayAcceptedExcessCreditsByItem(rows, cid);
}

/**
 * Unapplied accepted-excess credits still waiting for an ACTIVE cycle (display).
 */
async function loadNoQtyUnappliedQcExcessCreditsByItem(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!(soId > 0)) return new Map();
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { orderType: true },
  });
  if (!so || so.orderType !== "NO_QTY") return new Map();

  const rows = await tx.noQtyQcExcessCycleAdjustment.findMany({
    where: {
      salesOrderId: soId,
      applicationMode: APPLICATION_MODE.UNAPPLIED,
      appliedCycleId: null,
    },
    select: { itemId: true, acceptedExcessDeltaQty: true },
  });
  /** @type {Map<number, number>} */
  const out = new Map();
  for (const row of rows) {
    const itemId = Number(row.itemId);
    const qty = Math.max(0, round3(row.acceptedExcessDeltaQty));
    if (!(itemId > 0) || qty <= EPS) continue;
    out.set(itemId, round3((out.get(itemId) || 0) + qty));
  }
  return out;
}

module.exports = {
  EPS,
  APPLICATION_MODE,
  computeQcExcessDecisionDelta,
  applyCarriedAcceptedExcessCredit,
  planQcExcessAdjustmentConsumption,
  sumOverlayAcceptedExcessCreditsByItem,
  buildQcEntryConsumptionKey,
  resolveQcExcessApplicationTarget,
  recordNoQtyQcExcessDecision,
  consumeUnappliedNoQtyQcExcessAdjustmentsForCycle,
  loadNoQtyQcExcessOverlayCreditsByItem,
  loadNoQtyUnappliedQcExcessCreditsByItem,
};
