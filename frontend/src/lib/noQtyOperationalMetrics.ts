/**
 * Operator-facing NO_QTY dispatch metrics (no FIFO / pool / entitlement jargon).
 * Uses the same fields returned by GET /api/dispatch/sales-orders.
 */

export type DispatchLineStatLike = {
  itemId: number;
  cycleQcAcceptedQty?: number;
  qcAccepted?: number;
  cycleRecheckAcceptedQty?: number;
  postCycleApprovalQty?: number;
  operationalNetDispatchedQty?: number;
  cycleDispatchedQty?: number;
  dispatched?: number;
  dispatchable?: number;
  dispatchableQty?: number;
  onHand?: number;
  totalStock?: number;
  usableQcPassedStock?: number;
};

export type DispatchSoLike = {
  id?: number;
  orderType?: string | null;
  lineStats?: DispatchLineStatLike[];
};

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Per-cycle customer pending (QC approved in cycle − already dispatched in cycle). */
export function noQtyCustomerPendingForLine(ls: DispatchLineStatLike): number {
  const net = safeNum(ls.operationalNetDispatchedQty ?? ls.cycleDispatchedQty ?? ls.dispatched ?? 0);
  const qc = safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted ?? 0);
  const recheck = safeNum(ls.cycleRecheckAcceptedQty ?? 0);
  const post = safeNum(ls.postCycleApprovalQty ?? 0);
  return Math.max(0, qc + recheck + post - net);
}

export function usableStockForLine(ls: DispatchLineStatLike): number {
  return safeNum(ls.usableQcPassedStock ?? ls.totalStock ?? ls.onHand);
}

export type OperationalDispatchMetrics = {
  customerPending: number;
  producedApproved: number;
  totalDispatched: number;
  usableStockNow: number;
  canDispatchNow: number;
};

/**
 * Build operator snapshot for one FG item on a NO_QTY sales order.
 * `totalDispatchedOverride` — e.g. from trace report SO summary dispatchQty.
 */
export function buildNoQtyOperationalMetrics(
  so: DispatchSoLike,
  itemId: number,
  opts?: { totalDispatchedOverride?: number; canDispatchNowOverride?: number },
): OperationalDispatchMetrics | null {
  if (so.orderType !== "NO_QTY" || !itemId) return null;
  const lines = (so.lineStats ?? []).filter((l) => Number(l.itemId) === Number(itemId));
  if (!lines.length) return null;

  let customerPending = 0;
  let producedApproved = 0;
  let usableStockNow = 0;
  for (const ls of lines) {
    customerPending += noQtyCustomerPendingForLine(ls);
    producedApproved += safeNum(ls.cycleQcAcceptedQty ?? ls.qcAccepted);
    usableStockNow = Math.max(usableStockNow, usableStockForLine(ls));
  }

  const totalDispatched =
    opts?.totalDispatchedOverride != null && Number.isFinite(opts.totalDispatchedOverride)
      ? opts.totalDispatchedOverride
      : lines.reduce(
          (s, ls) => s + safeNum(ls.operationalNetDispatchedQty ?? ls.cycleDispatchedQty ?? ls.dispatched),
          0,
        );

  const canDispatchNow =
    opts?.canDispatchNowOverride != null && Number.isFinite(opts.canDispatchNowOverride)
      ? opts.canDispatchNowOverride
      : Math.min(customerPending, usableStockNow);

  return {
    customerPending,
    producedApproved,
    totalDispatched,
    usableStockNow,
    canDispatchNow: Math.max(0, canDispatchNow),
  };
}
