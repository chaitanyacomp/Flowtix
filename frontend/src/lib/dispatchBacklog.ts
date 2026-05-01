import { cn } from "./utils";

export type DispatchBacklogRow = {
  salesOrderId: number;
  salesOrderNo: string;
  customerName: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  dispatchableNow?: number;
  salesOrderDate: string;
  status: string;
  /** Backend label, e.g. SO_FIFO — see METRIC_CONTEXT /api */
  quantityMetricContext?: string;
};

export const ROW_NUM_EPS = 1e-6;

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
