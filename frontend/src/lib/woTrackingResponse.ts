/**
 * Normalizes GET /api/reports/work-order-tracking payloads.
 * Current contract: { rows, summary, reportMetricHints? }.
 * Legacy: bare array (pre–shape change) — summary is recomputed with the same rollups as the backend helper.
 */

export type WoTrackingRow = {
  workOrderLineId: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderDate: string;
  customerName: string;
  workOrderId: number;
  workOrderNo: string;
  workOrderDate: string;
  workOrderStatus: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  /** SO-required qty on the WO line (legacy name: same value) */
  workOrderQty: number;
  /** SO-required qty (explicit) */
  requiredQty?: number;
  producedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  dispatchedQty: number;
  productionPendingQty: number;
  qcPendingQty: number;
  dispatchPendingQty: number;
  status: string;
  quantityContexts?: {
    so: { orderedTotalForFgOnSalesOrder: number; metricContext: string };
    wo: Record<string, unknown> & { metricContext: string };
    dispatchAllocation: string;
  };
};

export type WoTrackingSummary = {
  openWoLines: number;
  pendingProductionQtySum: number;
  pendingQcQtySum: number;
  pendingDispatchQtySum: number;
};

export type WoTrackingApiResponse = {
  rows: WoTrackingRow[];
  summary: WoTrackingSummary | null;
  reportMetricHints?: unknown;
};

/** Mirrors backend `computeWorkOrderTrackingSummaryPendingDispatchQtySum`. */
export function computeWorkOrderTrackingSummaryPendingDispatchQtySum(rows: WoTrackingRow[]): number {
  if (!rows.length) return 0;
  const groups = new Map<string, { orderedQty: number; totalAccepted: number; netDispatched: number }>();
  for (const r of rows) {
    const { salesOrderId, itemId, orderedQty } = r;
    if (salesOrderId == null || itemId == null || orderedQty == null) {
      return rows.reduce((s, row) => s + Number(row.dispatchPendingQty ?? 0), 0);
    }
    const key = `${salesOrderId}-${itemId}`;
    if (!groups.has(key)) {
      groups.set(key, { orderedQty: Number(orderedQty), totalAccepted: 0, netDispatched: 0 });
    }
    const g = groups.get(key)!;
    g.totalAccepted += Number(r.acceptedQty ?? 0);
    g.netDispatched += Number(r.dispatchedQty ?? 0);
  }
  let sum = 0;
  for (const g of groups.values()) {
    const soRemainder = Math.max(0, g.orderedQty - g.netDispatched);
    const acceptedRemainder = Math.max(0, g.totalAccepted - g.netDispatched);
    sum += Math.min(soRemainder, acceptedRemainder);
  }
  return sum;
}

/**
 * Mirrors backend `computeWorkOrderTrackingSummaryFromRows` and
 * `normalizeWorkOrderTrackingApiPayloadForVerification` (keep in sync — see regression tests).
 */
export function computeWorkOrderTrackingSummaryFromRows(rows: WoTrackingRow[]): WoTrackingSummary {
  const openWoLines = rows.filter((r) => r.status !== "COMPLETED").length;
  const pendingProductionQtySum = rows.reduce((s, r) => s + Number(r.productionPendingQty ?? 0), 0);
  const pendingQcQtySum = rows.reduce((s, r) => s + Number(r.qcPendingQty ?? 0), 0);
  const pendingDispatchQtySum = computeWorkOrderTrackingSummaryPendingDispatchQtySum(rows);
  return { openWoLines, pendingProductionQtySum, pendingQcQtySum, pendingDispatchQtySum };
}

export function normalizeWoTrackingApiResponse(data: unknown): WoTrackingApiResponse {
  if (Array.isArray(data)) {
    const rows = data as WoTrackingRow[];
    return {
      rows,
      summary: computeWorkOrderTrackingSummaryFromRows(rows),
    };
  }
  const o = data as Partial<WoTrackingApiResponse>;
  const rows = Array.isArray(o.rows) ? o.rows : [];
  return {
    rows,
    summary: o.summary ?? (rows.length ? computeWorkOrderTrackingSummaryFromRows(rows) : null),
    reportMetricHints: o.reportMetricHints,
  };
}
