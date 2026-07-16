/**

 * Normalizes GET /api/reports/work-order-tracking payloads.

 * Flow-aware: REGULAR vs NO_QTY (never mixed). See docs/WORK_ORDER_TRACKING_REPORT_STANDARD.md.

 */



export type WoTrackingFlow = "REGULAR" | "NO_QTY";



export type WoTrackingRow = {

  flow?: WoTrackingFlow;

  workOrderLineId: number;

  salesOrderId: number;

  salesOrderNo: string;

  salesOrderDate: string;

  salesOrderInternalStatus?: string | null;

  customerName: string;

  workOrderId: number;

  workOrderNo: string;

  workOrderDate: string;

  workOrderStatus: string;

  orderType?: string | null;

  itemId: number;

  itemName: string;

  /** REGULAR only — SO line qty. NO_QTY rows leave this null (use customerDemandQty). */

  orderedQty: number | null;

  orderedQtyBasis?: "SO_LINE_QTY" | "RS_CUSTOMER_DEMAND" | "NA" | string;

  /** NO_QTY — locked RS customer demand */

  customerDemandQty?: number | null;

  requirementSheetId?: number | null;

  requirementSheetNo?: string | null;

  requirementSheetStatus?: string | null;

  cycleId?: number | null;

  cycleNo?: number | null;

  cycleStatus?: string | null;

  workOrderQty: number;

  requiredQty?: number;

  plannedQty?: number;

  producedQty: number;

  acceptedQty: number;

  rejectedQty: number;

  dispatchedQty: number;

  /** REGULAR production pending; NO_QTY mirrors activeProductionPendingQty */

  productionPendingQty: number;

  activeProductionPendingQty?: number;

  qcPendingQty: number;

  /** REGULAR dispatch pending; NO_QTY mirrors activeDispatchPendingQty (SO+FG cycle) */

  dispatchPendingQty: number;

  activeDispatchPendingQty?: number;

  recoveryCarryForwardOutcome?: string | null;
  productionShortfallSourceQty?: number | null;
  recoverySourceStatus?: string | null;
  recoveryAllocatedQty?: number | null;

  executionStatus?: string | null;

  status: string;

  quantityContexts?: Record<string, unknown>;

};



export type WoTrackingSummary = {

  openWoLines: number;

  pendingProductionQtySum: number;

  pendingQcQtySum: number;

  pendingDispatchQtySum: number;

};



export type WoTrackingApiResponse = {

  flow: WoTrackingFlow;

  includeClosed: boolean;

  rows: WoTrackingRow[];

  summary: WoTrackingSummary | null;

  emptyMessage?: string;

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



export function computeWorkOrderTrackingSummaryFromRows(rows: WoTrackingRow[]): WoTrackingSummary {

  const openWoLines = rows.filter((r) => r.status !== "COMPLETED").length;

  const pendingProductionQtySum = rows.reduce((s, r) => s + Number(r.productionPendingQty ?? 0), 0);

  const pendingQcQtySum = rows.reduce((s, r) => s + Number(r.qcPendingQty ?? 0), 0);

  const pendingDispatchQtySum = computeWorkOrderTrackingSummaryPendingDispatchQtySum(rows);

  return { openWoLines, pendingProductionQtySum, pendingQcQtySum, pendingDispatchQtySum };

}



export function normalizeWoTrackingApiResponse(data: unknown, fallbackFlow: WoTrackingFlow = "REGULAR"): WoTrackingApiResponse {

  if (Array.isArray(data)) {

    const rows = data as WoTrackingRow[];

    return {

      flow: fallbackFlow,

      includeClosed: false,

      rows,

      summary: computeWorkOrderTrackingSummaryFromRows(rows),

      emptyMessage:

        fallbackFlow === "REGULAR"

          ? "No Regular Sales Order work orders found for the selected filters."

          : "No active NO_QTY work orders found for the selected filters.",

    };

  }

  const o = data as Partial<WoTrackingApiResponse>;

  const flow = o.flow === "NO_QTY" || o.flow === "REGULAR" ? o.flow : fallbackFlow;

  const rows = Array.isArray(o.rows) ? o.rows : [];

  return {

    flow,

    includeClosed: Boolean(o.includeClosed),

    rows,

    summary: o.summary ?? (rows.length ? computeWorkOrderTrackingSummaryFromRows(rows) : null),

    emptyMessage:

      o.emptyMessage ??

      (flow === "REGULAR"

        ? "No Regular Sales Order work orders found for the selected filters."

        : "No active NO_QTY work orders found for the selected filters."),

    reportMetricHints: o.reportMetricHints,

  };

}



export function buildWorkOrderTrackingQuery(flow: WoTrackingFlow, includeClosed: boolean): string {

  const qs = new URLSearchParams();

  qs.set("flow", flow);

  if (includeClosed) qs.set("includeClosed", "true");

  return qs.toString();

}



