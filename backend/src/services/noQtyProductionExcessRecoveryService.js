/**
 * NO_QTY only — WO-level produced excess vs production-shortage recovery.
 *
 * Gross Production Shortage (e.g. 67) is the sum of closed-WO remainders and stays visible.
 * Produced Excess Pending QC (e.g. 10) is WO over-production still awaiting first-pass QC.
 * That excess must NOT appear as Prior Accepted Excess until QC-accepted.
 * Provisional Net Recovery = max(0, gross shortage + QC rejection − pending excess − accepted WO excess).
 * Finalize is blocked while excess relevant to recovery is still pending QC.
 */

const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { getProductionBatchQcPendingQty } = require("./reportMetrics");

const EPS = 1e-6;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

/**
 * Split one WO line's production into surplus / pending-excess / accepted-excess / rejected-excess.
 * Attribution is plan-first: accept/reject fill WO planned qty before surplus.
 * Excess is WO planned vs produced (not customer-demand surplus).
 */
function computeWoLineProducedExcessSplit({
  plannedQty = 0,
  producedQty = 0,
  acceptedQty = 0,
  rejectedQty = 0,
} = {}) {
  const planned = Math.max(0, round3(plannedQty));
  const produced = Math.max(0, round3(producedQty));
  const accepted = Math.max(0, round3(acceptedQty));
  const rejected = Math.max(0, round3(rejectedQty));
  const pendingQc = Math.max(0, round3(getProductionBatchQcPendingQty(produced, accepted, rejected)));
  const withinPlanProduced = Math.max(0, round3(Math.min(produced, planned)));
  const surplusProduced = Math.max(0, round3(produced - planned));

  let planSlots = withinPlanProduced;
  const acceptedTowardPlanQty = Math.max(0, round3(Math.min(accepted, planSlots)));
  planSlots = Math.max(0, round3(planSlots - acceptedTowardPlanQty));
  const rejectedTowardPlanQty = Math.max(0, round3(Math.min(rejected, planSlots)));
  planSlots = Math.max(0, round3(planSlots - rejectedTowardPlanQty));
  const pendingTowardPlanQty = Math.max(0, round3(Math.min(pendingQc, planSlots)));

  const acceptedWoExcessQty = Math.max(0, round3(accepted - acceptedTowardPlanQty));
  const rejectedWoExcessQty = Math.max(0, round3(rejected - rejectedTowardPlanQty));
  const producedExcessPendingQcQty = Math.max(
    0,
    round3(surplusProduced - acceptedWoExcessQty - rejectedWoExcessQty),
  );
  return {
    plannedQty: planned,
    producedQty: produced,
    acceptedQty: accepted,
    rejectedQty: rejected,
    pendingQcQty: pendingQc,
    withinPlanProducedQty: withinPlanProduced,
    surplusProducedQty: surplusProduced,
    acceptedTowardPlanQty,
    rejectedTowardPlanQty,
    pendingTowardPlanQty,
    producedExcessPendingQcQty,
    acceptedWoExcessQty,
    rejectedWoExcessQty,
  };
}

/**
 * Plan-first split of a terminal scrap delta into demand-backed vs surplus rejection.
 * Only demand-backed scrap may create QC_FINAL_REJECTION recovery.
 */
function splitTerminalScrapAgainstWoPlan({
  plannedQty = 0,
  producedQty = 0,
  acceptedQty = 0,
  rejectedQtyBeforeScrap = 0,
  scrapQty = 0,
} = {}) {
  const scrap = Math.max(0, round3(scrapQty));
  if (scrap <= EPS) {
    return { demandBackedScrapQty: 0, surplusScrapQty: 0 };
  }
  const planned = Math.max(0, round3(plannedQty));
  const produced = Math.max(0, round3(producedQty));
  const accepted = Math.max(0, round3(acceptedQty));
  const rejectedBefore = Math.max(0, round3(rejectedQtyBeforeScrap));
  const withinPlanProduced = Math.max(0, round3(Math.min(produced, planned)));

  let planSlots = withinPlanProduced;
  planSlots = Math.max(0, round3(planSlots - Math.min(accepted, planSlots)));
  planSlots = Math.max(0, round3(planSlots - Math.min(rejectedBefore, planSlots)));

  const demandBackedScrapQty = Math.max(0, round3(Math.min(scrap, planSlots)));
  const surplusScrapQty = Math.max(0, round3(scrap - demandBackedScrapQty));
  return { demandBackedScrapQty, surplusScrapQty };
}

/**
 * Recovery offset math. Never below zero.
 * - Accepted WO excess offsets recovery once.
 * - Rejected WO excess only cancels provisional offset — it is NOT kept QC-rejection recovery.
 * - keptFinalQcRejectionQty is clamped by rejectedWoExcessQty so leaked surplus scrap cannot create 67+10=77.
 */
function computeProductionShortageRecoveryOffset({
  grossProductionShortageQty = 0,
  keptFinalQcRejectionQty = 0,
  rejectedWoExcessQty = 0,
  producedExcessPendingQcQty = 0,
  acceptedWoExcessQty = 0,
} = {}) {
  const grossShortage = Math.max(0, round3(grossProductionShortageQty));
  const rawQcRejection = Math.max(0, round3(keptFinalQcRejectionQty));
  const rejectedExcess = Math.max(0, round3(rejectedWoExcessQty));
  // Surplus rejection must not inflate recovery (would turn full surplus reject into 77).
  const demandBackedQcRejectionQty = Math.max(0, round3(rawQcRejection - rejectedExcess));
  const pendingExcess = Math.max(0, round3(producedExcessPendingQcQty));
  const acceptedExcess = Math.max(0, round3(acceptedWoExcessQty));
  const grossRecovery = Math.max(0, round3(grossShortage + demandBackedQcRejectionQty));
  const acceptedOffset = Math.max(0, round3(Math.min(acceptedExcess, grossRecovery)));
  const remainingAcceptedExcessQty = Math.max(0, round3(acceptedExcess - acceptedOffset));
  const afterAccepted = Math.max(0, round3(grossRecovery - acceptedOffset));
  const pendingOffset = Math.max(0, round3(Math.min(pendingExcess, afterAccepted)));
  const provisionalNetRecoveryQty = Math.max(0, round3(afterAccepted - pendingOffset));
  const confirmedNetRecoveryQty = Math.max(0, round3(grossRecovery - acceptedOffset));
  const finalizeBlocked = pendingOffset > EPS && grossRecovery > EPS;
  const finalizeBlockMessage = finalizeBlocked
    ? `Final recovery cannot be confirmed until QC decides ${pendingExcess.toLocaleString("en-US", {
        maximumFractionDigits: 3,
      })} Nos excess production.`
    : null;
  return {
    grossProductionShortageQty: grossShortage,
    keptFinalQcRejectionQty: rawQcRejection,
    rejectedWoExcessQty: rejectedExcess,
    demandBackedQcRejectionQty,
    grossRecoveryQty: grossRecovery,
    producedExcessPendingQcQty: pendingExcess,
    acceptedWoExcessQty: acceptedExcess,
    acceptedExcessOffsetQty: acceptedOffset,
    remainingAcceptedExcessQty,
    provisionalNetRecoveryQty,
    confirmedNetRecoveryQty,
    finalizeBlocked,
    finalizeBlockMessage,
    subjectToQc: pendingExcess > EPS,
  };
}

/**
 * Prior-cycle WO produced-excess aggregates by FG for a target RS cycle.
 * @returns {Promise<Map<number, {
 *   producedExcessPendingQcQty: number;
 *   acceptedWoExcessQty: number;
 *   rejectedWoExcessQty: number;
 *   surplusProducedQty: number;
 *   pendingQcQty: number;
 * }>>}
 */
async function loadNoQtyProducedExcessByItemForPriorCycles(db, { salesOrderId, targetCycleId }) {
  const soId = Number(salesOrderId);
  const cycleId = Number(targetCycleId);
  if (!(soId > 0) || !(cycleId > 0)) return new Map();

  const [so, targetCycle] = await Promise.all([
    db.salesOrder.findUnique({ where: { id: soId }, select: { orderType: true } }),
    db.salesOrderCycle.findFirst({
      where: { id: cycleId, salesOrderId: soId },
      select: { id: true, cycleNo: true },
    }),
  ]);
  if (so?.orderType !== "NO_QTY" || !targetCycle) return new Map();

  const priorCycles = await db.salesOrderCycle.findMany({
    where: { salesOrderId: soId, cycleNo: { lt: targetCycle.cycleNo } },
    select: { id: true },
  });
  const priorCycleIds = priorCycles.map((r) => Number(r.id)).filter((id) => id > 0);
  if (!priorCycleIds.length) return new Map();

  const lines = await db.workOrderLine.findMany({
    where: {
      workOrder: {
        salesOrderId: soId,
        cycleId: { in: priorCycleIds },
        status: { not: "REJECTED" },
      },
    },
    select: {
      id: true,
      fgItemId: true,
      qty: true,
      plannedQty: true,
      workOrder: { select: { id: true } },
      productions: {
        where: { workflowStatus: "APPROVED" },
        select: {
          producedQty: true,
          qcEntries: { where: QC_ENTRY_ACTIVE_WHERE, select: { acceptedQty: true, rejectedQty: true } },
        },
      },
    },
  });

  /** @type {Map<number, { producedExcessPendingQcQty: number; acceptedWoExcessQty: number; rejectedWoExcessQty: number; surplusProducedQty: number; pendingQcQty: number }>} */
  const out = new Map();
  for (const line of lines) {
    const itemId = Number(line.fgItemId);
    if (!(itemId > 0)) continue;
    const planned = round3(n(line.plannedQty ?? line.qty));
    let produced = 0;
    let accepted = 0;
    let rejected = 0;
    for (const pe of line.productions || []) {
      produced = round3(produced + n(pe.producedQty));
      for (const qc of pe.qcEntries || []) {
        accepted = round3(accepted + n(qc.acceptedQty));
        rejected = round3(rejected + n(qc.rejectedQty));
      }
    }
    const split = computeWoLineProducedExcessSplit({
      plannedQty: planned,
      producedQty: produced,
      acceptedQty: accepted,
      rejectedQty: rejected,
    });
    if (
      split.surplusProducedQty <= EPS &&
      split.producedExcessPendingQcQty <= EPS &&
      split.acceptedWoExcessQty <= EPS &&
      split.rejectedWoExcessQty <= EPS
    ) {
      continue;
    }
    const prev = out.get(itemId) || {
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 0,
      rejectedWoExcessQty: 0,
      surplusProducedQty: 0,
      pendingQcQty: 0,
    };
    out.set(itemId, {
      producedExcessPendingQcQty: round3(prev.producedExcessPendingQcQty + split.producedExcessPendingQcQty),
      acceptedWoExcessQty: round3(prev.acceptedWoExcessQty + split.acceptedWoExcessQty),
      rejectedWoExcessQty: round3(prev.rejectedWoExcessQty + split.rejectedWoExcessQty),
      surplusProducedQty: round3(prev.surplusProducedQty + split.surplusProducedQty),
      pendingQcQty: round3(prev.pendingQcQty + split.pendingQcQty),
    });
  }
  return out;
}

/**
 * Compose recovery offset display + finalize gate inputs for one FG on a draft/locked RS.
 */
function composeNoQtyRecoveryExcessView({
  grossProductionShortageQty = 0,
  keptFinalQcRejectionQty = 0,
  rejectedWoExcessQty = 0,
  producedExcessPendingQcQty = 0,
  acceptedWoExcessQty = 0,
  unit = "Nos",
} = {}) {
  const offset = computeProductionShortageRecoveryOffset({
    grossProductionShortageQty,
    keptFinalQcRejectionQty,
    rejectedWoExcessQty,
    producedExcessPendingQcQty,
    acceptedWoExcessQty,
  });
  const unitLabel = String(unit || "Nos").trim() || "Nos";
  const pendingLabel = offset.producedExcessPendingQcQty.toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
  return {
    ...offset,
    finalizeBlockMessage: offset.finalizeBlocked
      ? `Final recovery cannot be confirmed until QC decides ${pendingLabel} ${unitLabel} excess production.`
      : null,
    provisionalNetRecoveryExplanation: offset.subjectToQc
      ? `Provisional net recovery ${offset.provisionalNetRecoveryQty.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })} ${unitLabel} (subject to QC on ${pendingLabel} ${unitLabel} produced excess).`
      : null,
  };
}

/**
 * Block Finalize/lock when WO excess that offsets recovery is still pending QC.
 */
async function assertNoProducedExcessPendingQcForRecoveryOrThrow(
  tx,
  { salesOrderId, targetCycleId, recoveryByItem },
) {
  const excessByItem = await loadNoQtyProducedExcessByItemForPriorCycles(tx, {
    salesOrderId,
    targetCycleId,
  });
  /** @type {Array<{ itemId: number; producedExcessPendingQcQty: number; grossRecoveryQty: number; message: string }>} */
  const blockers = [];
  const items = recoveryByItem instanceof Map ? recoveryByItem : new Map(Object.entries(recoveryByItem || {}));
  for (const [itemIdRaw, recovery] of items) {
    const itemId = Number(itemIdRaw);
    const excess = excessByItem.get(itemId) || {
      producedExcessPendingQcQty: 0,
      acceptedWoExcessQty: 0,
      rejectedWoExcessQty: 0,
    };
    const view = composeNoQtyRecoveryExcessView({
      grossProductionShortageQty: recovery?.grossProductionShortageQty ?? recovery?.productionShortfallQty ?? 0,
      keptFinalQcRejectionQty: recovery?.keptFinalQcRejectionQty ?? recovery?.qcFinalRejectionQty ?? 0,
      rejectedWoExcessQty: excess.rejectedWoExcessQty,
      producedExcessPendingQcQty: excess.producedExcessPendingQcQty,
      acceptedWoExcessQty: excess.acceptedWoExcessQty,
      unit: recovery?.unit || "Nos",
    });
    if (view.finalizeBlocked) {
      blockers.push({
        itemId,
        producedExcessPendingQcQty: view.producedExcessPendingQcQty,
        grossRecoveryQty: view.grossRecoveryQty,
        message: view.finalizeBlockMessage,
      });
    }
  }
  if (!blockers.length) return { ok: true, blockers: [] };
  const primary = blockers[0];
  const err = new Error(primary.message);
  err.statusCode = 409;
  err.code = "PRODUCED_EXCESS_PENDING_QC";
  err.details = { blockers };
  throw err;
}

/**
 * Effective recovery qty after accepted WO excess offset (for Net Production Requirement).
 * Pending excess is NOT subtracted here — finalize is blocked until QC resolves it.
 */
function effectiveRecoveryAfterAcceptedWoExcessOffset({
  productionShortfallQty = 0,
  qcRejectionRecoveryQty = 0,
  rejectedWoExcessQty = 0,
  acceptedWoExcessQty = 0,
} = {}) {
  const offset = computeProductionShortageRecoveryOffset({
    grossProductionShortageQty: productionShortfallQty,
    keptFinalQcRejectionQty: qcRejectionRecoveryQty,
    rejectedWoExcessQty,
    producedExcessPendingQcQty: 0,
    acceptedWoExcessQty,
  });
  return {
    effectiveRecoveryQty: offset.confirmedNetRecoveryQty,
    acceptedExcessOffsetQty: offset.acceptedExcessOffsetQty,
    remainingAcceptedExcessQty: offset.remainingAcceptedExcessQty,
    demandBackedQcRejectionQty: offset.demandBackedQcRejectionQty,
  };
}

module.exports = {
  EPS,
  computeWoLineProducedExcessSplit,
  splitTerminalScrapAgainstWoPlan,
  computeProductionShortageRecoveryOffset,
  composeNoQtyRecoveryExcessView,
  loadNoQtyProducedExcessByItemForPriorCycles,
  assertNoProducedExcessPendingQcForRecoveryOrThrow,
  effectiveRecoveryAfterAcceptedWoExcessOffset,
};
