import { cn } from "./utils";

export type DispatchBacklogRow = {
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemId: number;
  itemName: string;
  /** Prisma SalesOrderLine.id — matches REGULAR dispatch UI `lineId`; NO_QTY UI uses synthetic line ids + `itemId` deep link. */
  salesOrderLineId?: number;
  orderType?: string | null;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  dispatchableNow?: number;
  /** NO_QTY backlog row: SalesOrderCycle.id for per-cycle dashboard filters. */
  cycleId?: number | null;
  salesOrderDate: string;
  status: string;
  /** Backend label, e.g. SO_FIFO — see METRIC_CONTEXT /api */
  quantityMetricContext?: string;
};

export const ROW_NUM_EPS = 1e-6;

/**
 * Store Dashboard / Dispatch Backlog report: same rule as backend
 * `isDispatchBacklogActionableLine` — prepare headroom only (dispatchableNow > 0).
 * Excludes blocked "Cannot prepare now" rows and zero-qty stale entries.
 */
export function filterActionableDispatchBacklogRows(rows: DispatchBacklogRow[]): DispatchBacklogRow[] {
  return (rows ?? []).filter((r) => Number(r.dispatchableNow ?? 0) > ROW_NUM_EPS);
}

/** Store Dispatch Ready and Prepare Headroom must be projections of this same canonical queue. */
export function dispatchReadyRowsFromBacklog(rows: DispatchBacklogRow[]) {
  return filterActionableDispatchBacklogRows(rows).map((row) => ({
    key: `dispatch-backlog:${row.salesOrderId}:${row.salesOrderLineId ?? row.itemId}:${row.cycleId ?? 0}`,
    salesOrderId: row.salesOrderId,
    salesOrderDocNo: row.salesOrderDocNo ?? row.salesOrderNo,
    customerName: row.customerName,
    itemName: row.itemName,
    orderType: row.orderType,
    metricQty: Number(row.dispatchableNow ?? 0),
    href: `/dispatch?source=dashboard&soId=${row.salesOrderId}`,
  }));
}

export type DashboardBadgeTone = "critical" | "active" | "success" | "neutral";

export function dashboardToneToBadgeVariant(
  tone: DashboardBadgeTone,
): "default" | "success" | "warning" | "rejected" {
  switch (tone) {
    case "critical":
      return "rejected";
    case "active":
      return "warning";
    case "success":
      return "success";
    default:
      return "default";
  }
}

/** SO workflow: approved / in-process = attention; completed = done; draft = neutral */
export function dispatchBacklogStatusTone(status: string): DashboardBadgeTone {
  switch (status) {
    case "IN_PROCESS":
    case "APPROVED":
      return "active";
    case "COMPLETED":
      return "success";
    case "DRAFT":
      return "neutral";
    default:
      return "neutral";
  }
}

export function maxInSlice(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.max(...nums);
}

export function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 86400000;
}

export function dispatchBacklogRowEmphasis(
  r: DispatchBacklogRow,
  slice: DispatchBacklogRow[],
): "high" | "medium" | "low" {
  if (slice.length === 0) return "low";
  const maxP = maxInSlice(slice.map((x) => x.pendingQty));
  const highPending = maxP > ROW_NUM_EPS && r.pendingQty >= maxP * 0.6;
  const old = daysSince(r.salesOrderDate) >= 12 && r.pendingQty > ROW_NUM_EPS;
  if (highPending && old) return "high";
  if (highPending || old) return "medium";
  return "low";
}

/** Left accent on first column — matches dashboard dispatch backlog widget */
export function dispatchBacklogLeadCellClass(level: "high" | "medium" | "low"): string {
  if (level === "low") return "";
  const border =
    level === "high" ? "border-l-[3px] border-amber-600/90" : "border-l-2 border-amber-500/60";
  return cn(border, "border-y-0 border-r-0 border-solid pl-2");
}
