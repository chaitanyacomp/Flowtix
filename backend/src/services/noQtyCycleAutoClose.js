const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");

const EPS = 1e-6;

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Auto-close NO_QTY sales order current cycle when no pending dispatch quantity
 * remains against the locked requirement sheet cycle cap.
 *
 * This is strictly cycle-scoped (salesOrderId + currentCycleId).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ soId: number; cycleId: number }} input
 */
async function maybeAutoCloseNoQtyCycle(tx, { soId, cycleId }) {
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so) return { closed: false, reason: "SO_NOT_FOUND" };
  if (so.orderType !== "NO_QTY") return { closed: false, reason: "NOT_NO_QTY" };
  if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED_WITH_WAIVER" || so.internalStatus === "CLOSED") {
    return { closed: false, reason: "ALREADY_CLOSED" };
  }
  const currentCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : 0;
  if (!currentCycleId || currentCycleId !== Number(cycleId)) {
    return { closed: false, reason: "NOT_CURRENT_CYCLE" };
  }

  // Dispatches in current cycle (locked only; reversals included for net).
  const cycleDispatch = await tx.dispatch.findMany({
    where: { soId, cycleId: currentCycleId, workflowStatus: "LOCKED" },
    select: { id: true, itemId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true },
  });

  const forwardLocked = cycleDispatch.filter(
    (d) => d.reversalOfId == null && num(d.dispatchedQty) > EPS,
  );
  if (!forwardLocked.length) return { closed: false, reason: "NO_DISPATCHES" };

  // Pending dispatch qty check: compare cycle cap vs confirmed net dispatch.
  const sheet = await tx.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId: currentCycleId, status: "LOCKED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { lines: true },
  });
  if (!sheet) return { closed: false, reason: "NO_LOCKED_REQUIREMENT_SHEET" };

  const capByItemId = new Map();
  for (const ln of sheet.lines || []) {
    const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
    if (!(cap > EPS)) continue;
    capByItemId.set(ln.itemId, cap);
  }
  if (!capByItemId.size) return { closed: false, reason: "EMPTY_CYCLE_CAP" };

  const netConfirmed = netDispatchedByItemId(cycleDispatch, DISPATCH_ALLOC_MODE.CONFIRMED);
  for (const [itemId, cap] of capByItemId.entries()) {
    const disp = num(netConfirmed.get(itemId) ?? 0);
    const pending = Math.max(0, cap - disp);
    if (pending > EPS) return { closed: false, reason: "PENDING_DISPATCH_REMAINS" };
  }

  // Close the cycle only — NO_QTY SO stays open for the next requirement-sheet cycle.
  await tx.salesOrderCycle.updateMany({
    where: { id: currentCycleId, salesOrderId: soId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await tx.salesOrder.update({
    where: { id: soId },
    data: {
      // Never leave pointer on a CLOSED cycle — next RS creates/opens an ACTIVE cycle.
      currentCycleId: null,
    },
  });

  return { closed: true, reason: null };
}

/**
 * Close an ACTIVE cycle after a Decision-only / Recovery-only RS lock
 * (zero fulfillment: all carry-forward KEEP/WAIVE, no production required).
 *
 * Unlike maybeAutoCloseNoQtyCycle, this does not require LOCKED dispatches —
 * there is no RS cap to dispatch against.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ soId: number; cycleId: number; requirementSheetId?: number }} input
 */
async function closeDecisionOnlyNoQtyCycle(tx, { soId, cycleId, requirementSheetId = null }) {
  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so) return { closed: false, reason: "SO_NOT_FOUND" };
  if (so.orderType !== "NO_QTY") return { closed: false, reason: "NOT_NO_QTY" };
  if (
    so.internalStatus === "MANUALLY_CLOSED" ||
    so.internalStatus === "CLOSED_WITH_WAIVER" ||
    so.internalStatus === "CLOSED" ||
    so.internalStatus === "COMPLETED"
  ) {
    return { closed: false, reason: "ALREADY_CLOSED" };
  }

  const cid = Number(cycleId);
  if (!(cid > 0)) return { closed: false, reason: "INVALID_CYCLE" };

  const cycle = await tx.salesOrderCycle.findFirst({
    where: { id: cid, salesOrderId: soId },
    select: { id: true, status: true },
  });
  if (!cycle) return { closed: false, reason: "CYCLE_NOT_FOUND" };
  if (cycle.status === "CLOSED") return { closed: false, reason: "CYCLE_ALREADY_CLOSED" };

  const sheetWhere = {
    salesOrderId: soId,
    cycleId: cid,
    status: "LOCKED",
  };
  if (requirementSheetId != null && Number(requirementSheetId) > 0) {
    sheetWhere.id = Number(requirementSheetId);
  }
  const sheet = await tx.requirementSheet.findFirst({
    where: sheetWhere,
    include: { lines: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!sheet) return { closed: false, reason: "NO_LOCKED_REQUIREMENT_SHEET" };

  for (const ln of sheet.lines || []) {
    const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0), num(ln.totalRsQty ?? 0));
    if (cap > EPS) return { closed: false, reason: "NON_EMPTY_CYCLE_CAP" };
  }

  const woCount = await tx.workOrder.count({
    where: { salesOrderId: soId, cycleId: cid, status: { not: "REJECTED" } },
  });
  if (woCount > 0) return { closed: false, reason: "WO_EXISTS" };

  await tx.salesOrderCycle.updateMany({
    where: { id: cid, salesOrderId: soId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  const pointer = so.currentCycleId != null ? Number(so.currentCycleId) : 0;
  if (pointer === cid) {
    await tx.salesOrder.update({
      where: { id: soId },
      data: { currentCycleId: null },
    });
  }

  return { closed: true, reason: null, requirementSheetId: sheet.id };
}

/**
 * Diagnose the NO_QTY cycle close decision (no writes).
 * Returns exact evidence and which condition fails.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ soId: number }} input
 */
async function diagnoseNoQtyCycleAutoClose(tx, { soId }) {
  const out = {
    soId,
    orderType: null,
    internalStatus: null,
    currentCycleId: null,
    cycleStatus: null,
    canAttempt: false,
    failedReason: null,
    dispatch: {
      cycleDispatchRows: [],
      forwardLockedIds: [],
    },
    requirementSheet: {
      lockedSheetId: null,
      capByItemId: [],
    },
    confirmedNetDispatchedByItemId: [],
    pendingByItemId: [],
    wouldClose: false,
  };

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: {
      id: true,
      orderType: true,
      internalStatus: true,
      currentCycleId: true,
      currentCycle: { select: { id: true, status: true, cycleNo: true } },
    },
  });
  if (!so) {
    out.failedReason = "SO_NOT_FOUND";
    return out;
  }
  out.orderType = so.orderType ?? null;
  out.internalStatus = so.internalStatus ?? null;
  out.currentCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : null;
  out.cycleStatus = so.currentCycle?.status ?? null;

  if (so.orderType !== "NO_QTY") {
    out.failedReason = "NOT_NO_QTY";
    return out;
  }
  if (so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED_WITH_WAIVER" || so.internalStatus === "CLOSED") {
    out.failedReason = "ALREADY_CLOSED";
    return out;
  }
  const currentCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : 0;
  if (!currentCycleId) {
    out.failedReason = "NO_CURRENT_CYCLE";
    return out;
  }
  out.canAttempt = true;

  const cycleDispatch = await tx.dispatch.findMany({
    where: { soId, cycleId: currentCycleId, workflowStatus: "LOCKED" },
    select: { id: true, itemId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true },
  });
  out.dispatch.cycleDispatchRows = cycleDispatch.map((d) => ({
    id: d.id,
    itemId: d.itemId,
    dispatchedQty: Number(d.dispatchedQty ?? 0),
    reversalOfId: d.reversalOfId ?? null,
    workflowStatus: d.workflowStatus ?? null,
  }));

  const forwardLocked = cycleDispatch.filter((d) => d.reversalOfId == null && num(d.dispatchedQty) > EPS);
  const forwardIds = forwardLocked.map((d) => d.id);
  out.dispatch.forwardLockedIds = [...forwardIds];
  if (!forwardIds.length) {
    out.failedReason = "NO_DISPATCHES";
    return out;
  }

  const sheet = await tx.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId: currentCycleId, status: "LOCKED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { lines: true },
  });
  if (!sheet) {
    out.failedReason = "NO_LOCKED_REQUIREMENT_SHEET";
    return out;
  }
  out.requirementSheet.lockedSheetId = sheet.id;

  const capByItemId = new Map();
  for (const ln of sheet.lines || []) {
    const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
    if (!(cap > EPS)) continue;
    capByItemId.set(ln.itemId, cap);
  }
  out.requirementSheet.capByItemId = [...capByItemId.entries()].map(([itemId, cap]) => ({ itemId, cap }));
  if (!capByItemId.size) {
    out.failedReason = "EMPTY_CYCLE_CAP";
    return out;
  }

  const netConfirmed = netDispatchedByItemId(cycleDispatch, DISPATCH_ALLOC_MODE.CONFIRMED);
  out.confirmedNetDispatchedByItemId = [...netConfirmed.entries()].map(([itemId, dispatched]) => ({
    itemId,
    dispatched: num(dispatched),
  }));

  const pendingRows = [];
  for (const [itemId, cap] of capByItemId.entries()) {
    const disp = num(netConfirmed.get(itemId) ?? 0);
    const pending = Math.max(0, cap - disp);
    pendingRows.push({ itemId, cap, dispatched: disp, pending });
  }
  out.pendingByItemId = pendingRows;
  const anyPending = pendingRows.some((r) => r.pending > EPS);
  if (anyPending) {
    out.failedReason = "PENDING_DISPATCH_REMAINS";
    return out;
  }

  out.wouldClose = true;
  out.failedReason = null;
  return out;
}

module.exports = {
  maybeAutoCloseNoQtyCycle,
  closeDecisionOnlyNoQtyCycle,
  diagnoseNoQtyCycleAutoClose,
};
