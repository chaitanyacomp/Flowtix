/**
 * Shared dispatch → sales billing eligibility (single source for service, SO list, dashboard).
 * Billing is commercial-only; dispatch LOCK is the shipment authority.
 */

const BILLING_EPS = 1e-9;

/** Prisma where fragment: forward confirmed dispatch rows only. */
const BILLABLE_FORWARD_DISPATCH_WHERE = Object.freeze({
  reversalOfId: null,
  workflowStatus: "LOCKED",
});

/** Revenue SO types that may be billed from dispatch. */
const BILLABLE_SALES_ORDER_WHERE = Object.freeze({
  OR: [
    { orderType: "NO_QTY" },
    { orderType: "NORMAL", internalStatus: { not: "DRAFT" } },
  ],
});

function isPositiveDispatchQty(dispatchedQty) {
  const q = Number(dispatchedQty);
  return Number.isFinite(q) && q > BILLING_EPS;
}

/**
 * @param {string | null | undefined} status
 * @param {Date | null | undefined} cancelledAt
 */
function isActiveSalesBillRecord(status, cancelledAt) {
  if (cancelledAt != null) return false;
  return status === "DRAFT" || status === "FINALIZED";
}

/**
 * @param {number} dispatchId
 * @param {string} status
 * @param {Date | null | undefined} cancelledAt
 * @returns {number | null}
 */
function activeBillDispatchKeyForBill(dispatchId, status, cancelledAt) {
  if (!isActiveSalesBillRecord(status, cancelledAt)) return null;
  const id = Number(dispatchId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} dispatchIds
 * @returns {Promise<Set<number>>} dispatch ids with DRAFT or FINALIZED (non-cancelled) bill
 */
async function loadActiveBillDispatchIdSet(db, dispatchIds) {
  const ids = [...new Set((dispatchIds || []).map((x) => Number(x)).filter((x) => x > 0))];
  const out = new Set();
  if (!ids.length) return out;
  const rows = await db.salesBill.findMany({
    where: {
      dispatchId: { in: ids },
      status: { in: ["DRAFT", "FINALIZED"] },
      cancelledAt: null,
    },
    select: { dispatchId: true },
  });
  for (const r of rows) out.add(Number(r.dispatchId));
  return out;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} dispatchIds
 * @returns {Promise<Set<number>>} dispatch ids with FINALIZED non-cancelled bill
 */
async function loadFinalizedBillDispatchIdSet(db, dispatchIds) {
  const ids = [...new Set((dispatchIds || []).map((x) => Number(x)).filter((x) => x > 0))];
  const out = new Set();
  if (!ids.length) return out;
  const rows = await db.salesBill.findMany({
    where: {
      dispatchId: { in: ids },
      status: "FINALIZED",
      cancelledAt: null,
    },
    select: { dispatchId: true },
  });
  for (const r of rows) out.add(Number(r.dispatchId));
  return out;
}

/**
 * Prefer active bill row for dispatch ledger (DRAFT, then FINALIZED; ignore CANCELLED).
 * @param {Array<{ id: number; dispatchId: number; status: string; isExported?: boolean; cancelledAt?: Date | null; billingAdjustmentRequired?: boolean }>} bills
 */
function pickPrimaryBillForDispatch(bills) {
  const active = (bills || []).filter((b) => b.status !== "CANCELLED" && b.cancelledAt == null);
  if (!active.length) return null;
  const draft = active.find((b) => b.status === "DRAFT");
  if (draft) return draft;
  const finalized = active.find((b) => b.status === "FINALIZED");
  if (finalized) return finalized;
  return active[0] ?? null;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} dispatchIds
 */
async function loadPrimaryBillSummaryByDispatchId(db, dispatchIds) {
  const ids = [...new Set((dispatchIds || []).map((x) => Number(x)).filter((x) => x > 0))];
  /** @type {Map<number, { id: number; isExported: boolean; status: string; billingAdjustmentRequired: boolean }>} */
  const out = new Map();
  if (!ids.length) return out;

  const bills = await db.salesBill.findMany({
    where: { dispatchId: { in: ids } },
    select: {
      id: true,
      dispatchId: true,
      isExported: true,
      status: true,
      cancelledAt: true,
      billingAdjustmentRequired: true,
    },
    orderBy: { id: "desc" },
  });

  /** @type {Map<number, typeof bills>} */
  const byDispatch = new Map();
  for (const b of bills) {
    const k = Number(b.dispatchId);
    if (!byDispatch.has(k)) byDispatch.set(k, []);
    byDispatch.get(k).push(b);
  }
  for (const [dispatchId, group] of byDispatch) {
    const primary = pickPrimaryBillForDispatch(group);
    if (!primary) continue;
    out.set(dispatchId, {
      id: Number(primary.id),
      isExported: Boolean(primary.isExported),
      status: String(primary.status),
      billingAdjustmentRequired: Boolean(primary.billingAdjustmentRequired),
    });
  }
  return out;
}

/**
 * Finalize/export gate: dispatch must still be billable forward LOCKED row (qty unchanged on bill).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} dispatchId
 */
async function assertDispatchEligibleForBillingFinalize(tx, dispatchId) {
  const dispatch = await tx.dispatch.findUnique({ where: { id: dispatchId } });
  if (!dispatch) {
    const err = new Error("Linked dispatch not found.");
    err.statusCode = 404;
    throw err;
  }
  if (dispatch.reversalOfId != null) {
    const err = new Error("Cannot finalize billing for a dispatch reversal row.");
    err.statusCode = 409;
    throw err;
  }
  if (dispatch.workflowStatus !== "LOCKED") {
    const err = new Error("Cannot finalize billing until dispatch is confirmed (locked).");
    err.statusCode = 409;
    throw err;
  }
  if (!isPositiveDispatchQty(dispatch.dispatchedQty)) {
    const err = new Error("Dispatch quantity must be positive to finalize billing.");
    err.statusCode = 409;
    throw err;
  }
  return dispatch;
}

/**
 * NO_QTY SO list: sum unbilled LOCKED forward dispatch qty per SO (current cycle only).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number[]} soIds
 * @param {Map<number, number>} currentCycleIdBySoId
 * @returns {Promise<Map<number, number>>}
 */
async function sumUnbilledLockedDispatchQtyBySoIdForNoQty(prisma, soIds, currentCycleIdBySoId) {
  /** @type {Map<number, number>} */
  const out = new Map();
  const ids = (soIds || []).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return out;

  const lockedForward = await prisma.dispatch.findMany({
    where: {
      soId: { in: ids },
      ...BILLABLE_FORWARD_DISPATCH_WHERE,
    },
    select: { id: true, soId: true, dispatchedQty: true, cycleId: true },
  });

  const candidates = lockedForward.filter((d) => isPositiveDispatchQty(d.dispatchedQty));
  const activeBilledSet = await loadActiveBillDispatchIdSet(
    prisma,
    candidates.map((d) => d.id),
  );

  for (const d of candidates) {
    if (activeBilledSet.has(d.id)) continue;
    const currentCycleId = currentCycleIdBySoId.get(d.soId) ?? 0;
    if (!currentCycleId || Number(d.cycleId) !== Number(currentCycleId)) continue;
    const q = Number(d.dispatchedQty ?? 0);
    out.set(d.soId, (out.get(d.soId) ?? 0) + q);
  }
  return out;
}

/**
 * `${salesOrderId}:${cycleId}` → true when cycle has LOCKED forward dispatch without FINALIZED bill.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ salesOrderId: number; cycleId: number }[]} salesOrderCyclePairs
 */
async function loadNoQtyCycleBillingPendingBySoCycle(prisma, salesOrderCyclePairs) {
  const pairs = (salesOrderCyclePairs || []).filter((p) => p.salesOrderId != null && p.cycleId != null);
  /** @type {Map<string, boolean>} */
  const out = new Map();
  if (!pairs.length) return out;

  const dispatches = await prisma.dispatch.findMany({
    where: {
      OR: pairs.map((p) => ({ soId: p.salesOrderId, cycleId: p.cycleId })),
      ...BILLABLE_FORWARD_DISPATCH_WHERE,
    },
    select: { id: true, soId: true, cycleId: true, dispatchedQty: true },
  });
  const fwd = dispatches.filter((d) => isPositiveDispatchQty(d.dispatchedQty));
  if (!fwd.length) return out;

  const finalizedSet = await loadFinalizedBillDispatchIdSet(
    prisma,
    fwd.map((d) => d.id),
  );

  for (const d of fwd) {
    if (finalizedSet.has(d.id)) continue;
    const cyc = Number(d.cycleId);
    if (!Number.isFinite(cyc) || cyc <= 0) continue;
    out.set(`${d.soId}:${cyc}`, true);
  }
  return out;
}

module.exports = {
  BILLING_EPS,
  BILLABLE_FORWARD_DISPATCH_WHERE,
  BILLABLE_SALES_ORDER_WHERE,
  isPositiveDispatchQty,
  isActiveSalesBillRecord,
  activeBillDispatchKeyForBill,
  loadActiveBillDispatchIdSet,
  loadFinalizedBillDispatchIdSet,
  pickPrimaryBillForDispatch,
  loadPrimaryBillSummaryByDispatchId,
  assertDispatchEligibleForBillingFinalize,
  sumUnbilledLockedDispatchQtyBySoIdForNoQty,
  loadNoQtyCycleBillingPendingBySoCycle,
};
