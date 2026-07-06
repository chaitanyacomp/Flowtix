/**
 * Store dispatch pending-action triggers — inventory-only FG after partial dispatch is not mandatory work.
 * Pending dispatch pressure applies only when an unlocked draft exists or customer delivery is due.
 */

const EPS = 1e-6;
const DISPATCH_ACTIONABLE_SO_STATUSES = ["APPROVED", "IN_PROCESS"];

const STORE_DISPATCH_DRAFT_PREFIX = "Finalize Dispatch Draft";
const STORE_DISPATCH_DELIVERY_DUE_PREFIX = "Delivery Due — Dispatch";

function startOfUtcDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isCustomerDeliveryDue(requiredDate, now = new Date()) {
  if (!requiredDate) return false;
  const due = requiredDate instanceof Date ? requiredDate : new Date(requiredDate);
  if (Number.isNaN(due.getTime())) return false;
  return startOfUtcDay(due).getTime() <= startOfUtcDay(now).getTime();
}

async function loadUnlockedDraftQtyBySoId(db) {
  const rows = await db.dispatch.findMany({
    where: {
      reversalOfId: null,
      workflowStatus: "UNLOCKED",
    },
    select: {
      soId: true,
      dispatchedQty: true,
    },
  });
  /** @type {Map<number, number>} */
  const map = new Map();
  for (const row of rows) {
    const qty = Number(row.dispatchedQty);
    if (!(qty > EPS)) continue;
    const soId = Number(row.soId);
    if (!Number.isFinite(soId) || soId <= 0) continue;
    map.set(soId, (map.get(soId) ?? 0) + qty);
  }
  return map;
}

async function loadSalesOrderTriggerMetaBySoId(db, soIds) {
  if (!soIds.length) return new Map();
  const rows = await db.salesOrder.findMany({
    where: { id: { in: soIds } },
    select: {
      id: true,
      internalStatus: true,
      orderType: true,
      docNo: true,
      createdAt: true,
      po: { select: { requiredDate: true } },
      customer: { select: { name: true } },
    },
  });
  /** @type {Map<number, object>} */
  const map = new Map();
  for (const so of rows) {
    if (!DISPATCH_ACTIONABLE_SO_STATUSES.includes(String(so.internalStatus ?? ""))) continue;
    map.set(so.id, {
      deliveryDue: isCustomerDeliveryDue(so.po?.requiredDate),
      orderType: so.orderType,
      docNo: so.docNo,
      createdAt: so.createdAt,
      customerName: so.customer?.name ?? null,
    });
  }
  return map;
}

async function resolveBacklogRows(backlogRows) {
  if (backlogRows != null) return backlogRows;
  const { getDispatchBacklogRows } = require("./dashboardQueueSnapshots");
  return getDispatchBacklogRows();
}

/**
 * SO groups that warrant store dispatch pending actions.
 * @returns {Promise<Array<{ salesOrderId: number; salesOrderNo: string; salesOrderDocNo: string | null; customerName: string | null; totalQty: number; salesOrderDate: string | null; trigger: 'DRAFT' | 'DELIVERY_DUE'; orderType: string | null }>>}
 */
async function resolveStoreDispatchPendingActionGroups(db, backlogRows = null) {
  const rows = await resolveBacklogRows(backlogRows);
  const draftBySo = await loadUnlockedDraftQtyBySoId(db);

  /** @type {Map<number, number>} */
  const dispatchableBySo = new Map();
  /** @type {Map<number, object>} */
  const backlogMetaBySo = new Map();
  for (const row of rows) {
    const soId = Number(row.salesOrderId);
    if (!Number.isFinite(soId) || soId <= 0) continue;
    const dispatchable = Number(row.dispatchableNow ?? 0);
    if (dispatchable > EPS) {
      dispatchableBySo.set(soId, (dispatchableBySo.get(soId) ?? 0) + dispatchable);
    }
    if (!backlogMetaBySo.has(soId)) {
      backlogMetaBySo.set(soId, {
        salesOrderNo: row.salesOrderNo,
        salesOrderDocNo: row.salesOrderDocNo,
        customerName: row.customerName,
        salesOrderDate: row.salesOrderDate,
        orderType: row.orderType,
      });
    }
  }

  const candidateSoIds = [...new Set([...draftBySo.keys(), ...dispatchableBySo.keys()])];
  const soMetaById = await loadSalesOrderTriggerMetaBySoId(db, candidateSoIds);

  /** @type {Array<object>} */
  const groups = [];
  for (const soId of candidateSoIds) {
    const soMeta = soMetaById.get(soId);
    if (!soMeta) continue;

    const draftQty = draftBySo.get(soId) ?? 0;
    const dispatchable = dispatchableBySo.get(soId) ?? 0;
    const backlogMeta = backlogMetaBySo.get(soId) ?? {};

    let trigger = null;
    let totalQty = 0;
    if (draftQty > EPS) {
      trigger = "DRAFT";
      totalQty = draftQty;
    } else if (soMeta.deliveryDue && dispatchable > EPS) {
      trigger = "DELIVERY_DUE";
      totalQty = dispatchable;
    }
    if (!trigger) continue;

    groups.push({
      salesOrderId: soId,
      salesOrderNo: backlogMeta.salesOrderNo ?? `SO-${soId}`,
      salesOrderDocNo: backlogMeta.salesOrderDocNo ?? soMeta.docNo ?? null,
      customerName: backlogMeta.customerName ?? soMeta.customerName ?? null,
      totalQty,
      salesOrderDate:
        backlogMeta.salesOrderDate ??
        (soMeta.createdAt instanceof Date ? soMeta.createdAt.toISOString() : null),
      trigger,
      orderType: soMeta.orderType ?? backlogMeta.orderType ?? null,
    });
  }

  return groups;
}

/** @returns {Promise<Map<number, 'DRAFT' | 'DELIVERY_DUE'>>} */
async function loadStoreDispatchWorkflowTriggerSet(db, backlogRows = null) {
  const groups = await resolveStoreDispatchPendingActionGroups(db, backlogRows);
  const set = new Map();
  for (const group of groups) {
    set.set(group.salesOrderId, group.trigger);
  }
  return set;
}

function buildStoreDispatchPendingActionLabel(soDoc, totalQty, trigger) {
  const doc = String(soDoc ?? "").trim() || "Sales Order";
  const qty = String(totalQty);
  if (trigger === "DRAFT") {
    return `${STORE_DISPATCH_DRAFT_PREFIX} — ${doc} — Qty ${qty}`;
  }
  return `${STORE_DISPATCH_DELIVERY_DUE_PREFIX} — ${doc} — Qty ${qty}`;
}

function isStoreDispatchWorkflowTriggerAction(actionLabel) {
  const label = String(actionLabel ?? "").trim();
  return (
    label.startsWith(STORE_DISPATCH_DRAFT_PREFIX) || label.startsWith(STORE_DISPATCH_DELIVERY_DUE_PREFIX)
  );
}

module.exports = {
  EPS,
  STORE_DISPATCH_DRAFT_PREFIX,
  STORE_DISPATCH_DELIVERY_DUE_PREFIX,
  isCustomerDeliveryDue,
  resolveStoreDispatchPendingActionGroups,
  loadStoreDispatchWorkflowTriggerSet,
  buildStoreDispatchPendingActionLabel,
  isStoreDispatchWorkflowTriggerAction,
};
