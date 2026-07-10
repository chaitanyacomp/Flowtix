/**
 * NO_QTY Carry Forward Pending Pool — created by Production, consumed by Store on RS create.
 */

const auditLog = require("./auditLog");

const EPS = 1e-6;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function ageDaysFrom(date) {
  if (!date) return 0;
  const ms = Date.now() - new Date(date).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/**
 * List pending carry-forward records for Store planning dashboard.
 */
async function listCarryForwardPending(db, { salesOrderId } = {}) {
  const where = { status: "PENDING" };
  if (salesOrderId != null) where.salesOrderId = salesOrderId;

  const rows = await db.carryForwardPending.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      item: { select: { id: true, itemName: true } },
      salesOrder: {
        select: {
          id: true,
          docNo: true,
          customer: { select: { id: true, name: true } },
          po: { select: { customer: { select: { id: true, name: true } } } },
        },
      },
      sourceRequirementSheet: { select: { id: true, docNo: true, periodKey: true } },
      sourceWorkOrder: { select: { id: true, docNo: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    itemName: r.item?.itemName ?? null,
    customerId: r.salesOrder?.customer?.id ?? r.salesOrder?.po?.customer?.id ?? null,
    customerName: r.salesOrder?.customer?.name ?? r.salesOrder?.po?.customer?.name ?? null,
    salesOrderId: r.salesOrderId,
    salesOrderDocNo: r.salesOrder?.docNo ?? null,
    sourceRequirementSheetId: r.sourceRequirementSheetId,
    sourceRequirementSheetDocNo: r.sourceRequirementSheet?.docNo ?? null,
    sourceRequirementSheetPeriodKey: r.sourceRequirementSheet?.periodKey ?? null,
    sourceWorkOrderId: r.sourceWorkOrderId,
    sourceWorkOrderDocNo: r.sourceWorkOrder?.docNo ?? null,
    cycleId: r.cycleId,
    remainingQty: round3(n(r.remainingQty)),
    resolutionReason: r.resolutionReason,
    resolutionReasonOther: r.resolutionReasonOther,
    remarks: r.remarks,
    ageDays: ageDaysFrom(r.createdAt),
    createdAt: r.createdAt,
    plannedNextRsHint: r.plannedNextRsHint,
  }));
}

/**
 * Consume matching PENDING pool records when Store creates a Requirement Sheet.
 * Batch 3C: delegates to recovery auto-allocate (RESERVED + line components).
 */
async function consumeCarryForwardPendingForRequirementSheet(tx, args) {
  const { consumeCarryForwardPendingForRequirementSheet: integrate } = require("./noQtyRsRecoveryIntegrationService");
  return integrate(tx, args);
}

async function createCarryForwardPendingFromProductionShortfall(tx, args) {
  // Batch 3B: delegate to authoritative recovery engine (idempotent).
  const { createProductionShortRecovery } = require("./noQtyRecoveryService");
  return createProductionShortRecovery(tx, args);
}

async function updatePlannedNextRsHint(db, carryForwardPendingId, { plannedNextRsHint, actorUserId, actorRole }) {
  const row = await db.carryForwardPending.findUnique({ where: { id: carryForwardPendingId } });
  if (!row || row.status !== "PENDING") {
    const err = new Error("Carry forward pending record not found or already consumed.");
    err.statusCode = 404;
    throw err;
  }

  const updated = await db.carryForwardPending.update({
    where: { id: carryForwardPendingId },
    data: { plannedNextRsHint: plannedNextRsHint?.trim()?.slice(0, 128) || null },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(db, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `CARRY_FORWARD_PENDING:${carryForwardPendingId}`,
      actorUserId,
      actorRole,
      summary: `Updated planned next RS hint for carry-forward pending ${carryForwardPendingId}`,
      payload: { plannedNextRsHint: updated.plannedNextRsHint },
    });
  }

  return updated;
}

/**
 * Sum PENDING carry-forward pool qty per FG item for next-cycle RS demand.
 * When currentCycleId is set, only includes records from prior cycles on the same SO.
 */
async function loadPendingCarryForwardQtyByItem(db, { salesOrderId, currentCycleId }) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return new Map();

  /** @type {Set<number> | null} */
  let priorCycleIds = null;
  const curCid = currentCycleId != null ? Number(currentCycleId) : null;
  if (Number.isFinite(curCid) && curCid > 0) {
    const current = await db.salesOrderCycle.findUnique({
      where: { id: curCid },
      select: { salesOrderId: true, cycleNo: true },
    });
    if (current?.salesOrderId === soId) {
      const prevRows = await db.salesOrderCycle.findMany({
        where: { salesOrderId: soId, cycleNo: { lt: Number(current.cycleNo) } },
        select: { id: true },
      });
      priorCycleIds = new Set(prevRows.map((r) => Number(r.id)).filter((id) => id > 0));
    }
  }

  const pending = await db.carryForwardPending.findMany({
    where: { salesOrderId: soId, status: "PENDING" },
    select: { itemId: true, remainingQty: true, cycleId: true },
  });

  /** @type {Map<number, number>} */
  const out = new Map();
  for (const row of pending) {
    const cycleId = row.cycleId != null ? Number(row.cycleId) : null;
    if (priorCycleIds != null && cycleId != null && !priorCycleIds.has(cycleId)) continue;
    const qty = round3(n(row.remainingQty));
    if (qty <= EPS) continue;
    out.set(row.itemId, round3((out.get(row.itemId) ?? 0) + qty));
  }
  return out;
}

module.exports = {
  listCarryForwardPending,
  consumeCarryForwardPendingForRequirementSheet,
  createCarryForwardPendingFromProductionShortfall,
  updatePlannedNextRsHint,
  loadPendingCarryForwardQtyByItem,
  ageDaysFrom,
};
