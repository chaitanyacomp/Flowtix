import { DRILL_QUERY } from "./drillDownRoutes";
import { buildNoQtyGuidedHref } from "./noQtyFlowState";

/** Production / WO list opened from left-menu Work Order Workspace (navigation only). */
export const FROM_WORK_ORDER_WORKSPACE = "work-order-workspace";

export function appendNavFrom(href: string, from: string): string {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = base.indexOf("?");
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const qs = new URLSearchParams(qIdx >= 0 ? base.slice(qIdx + 1) : "");
  qs.set("from", from);
  const q = qs.toString();
  return `${path}${q ? `?${q}` : ""}${hash}`;
}

export type ProductionQueueRowLink = {
  orderType?: string | null;
  salesOrderId?: number;
  workOrderId: number;
  workOrderLineId?: number;
  cycleId?: number | null;
  actionHref?: string;
};

/** Deep-link into scoped production (prefer server-built actionHref). */
export function productionHrefFromDashboardRow(row: ProductionQueueRowLink): string {
  if (row.actionHref) return row.actionHref;
  const sid = Number(row.salesOrderId ?? 0);
  if (row.orderType === "NO_QTY" && sid > 0) {
    return buildNoQtyGuidedHref({
      to: "/production",
      salesOrderId: sid,
      cycleId: row.cycleId ?? undefined,
      fromStep: "production",
    });
  }
  const qs = new URLSearchParams();
  if (sid > 0) qs.set("salesOrderId", String(sid));
  if (row.workOrderId > 0) qs.set("workOrderId", String(row.workOrderId));
  if (row.workOrderLineId != null && row.workOrderLineId > 0) {
    qs.set("workOrderLineId", String(row.workOrderLineId));
  }
  const q = qs.toString();
  return q ? `/production?${q}` : "/production";
}

/** Production deep-link from Work Order Workspace — preserves back navigation to `/work-orders`. */
export function productionHrefFromWorkOrderWorkspace(row: ProductionQueueRowLink): string {
  return appendNavFrom(productionHrefFromDashboardRow(row), FROM_WORK_ORDER_WORKSPACE);
}

export function workOrderHrefForRegularCreate(salesOrderId: number): string {
  return `/work-orders?salesOrderId=${encodeURIComponent(String(salesOrderId))}`;
}

export function workOrderHrefForOpenWo(row: {
  orderType?: string | null;
  salesOrderId?: number;
  workOrderId: number;
  cycleId?: number | null;
  requirementSheetId?: number | null;
}): string {
  const sid = Number(row.salesOrderId ?? 0);
  if (row.orderType === "NO_QTY" && sid > 0) {
    return buildNoQtyGuidedHref({
      to: "/work-orders",
      salesOrderId: sid,
      cycleId: row.cycleId ?? undefined,
      requirementSheetId: row.requirementSheetId ?? undefined,
      fromStep: "work_order",
    });
  }
  const qs = new URLSearchParams();
  if (sid > 0) qs.set("salesOrderId", String(sid));
  qs.set(DRILL_QUERY.workOrderId, String(row.workOrderId));
  return `/work-orders?${qs.toString()}`;
}

/** WO drill from Work Order Workspace (REGULAR) — same target as open WO with workspace back context. */
export function workOrderHrefFromWorkOrderWorkspace(row: {
  orderType?: string | null;
  salesOrderId?: number;
  workOrderId: number;
  cycleId?: number | null;
  requirementSheetId?: number | null;
}): string {
  return appendNavFrom(workOrderHrefForOpenWo(row), FROM_WORK_ORDER_WORKSPACE);
}
