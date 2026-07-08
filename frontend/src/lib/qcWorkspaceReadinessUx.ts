/**
 * M1.8 — QA Workspace readiness consumption (presentation only).
 * Maps backend qc-queue, production-entry rollups, fg-work-order-balance, and no-qty/next-action
 * to labels, badges, and navigation. QC save/reverse POST APIs remain the authority.
 */

import { buildNoQtyGuidedHref } from "./noQtyFlowState";
import { buildRegularDispatchGuidedHref } from "./manufacturingNavigationContinuity";

const EPS = 1e-6;

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function roundQty(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** GET /api/dashboard/qc-queue row shape. */
export type QcDashboardQueueRow = {
  qcRef?: string | null;
  workOrderId?: number | null;
  workOrderNo?: string | null;
  salesOrderId?: number | null;
  salesOrderNo?: string | null;
  itemName?: string | null;
  producedQty?: number | null;
  acceptedQty?: number | null;
  rejectedQty?: number | null;
  pendingQcQty?: number | null;
  status?: string | null;
  orderType?: string | null;
  cycleId?: number | null;
  cycleNo?: number | null;
  actionHref?: string | null;
  actionLabel?: string | null;
};

/** GET /api/production/sales-orders/{id}/fg-work-order-balance item. */
export type FgWorkOrderBalanceItem = {
  itemId: number;
  pendingSoQty?: number | null;
  dispatchableQty?: number | null;
  shortageQty?: number | null;
};

export type RegularPostQcDispatchPresentation =
  | {
      kind: "DISPATCH_ONLY";
      workOrderId: number | null;
      qtyPendingToDeliver: number;
      dispatchableNow: number;
      qcAcceptedQty: number;
      rejectedQty: number;
    }
  | {
      kind: "DECISION";
      workOrderId: number | null;
      qtyPendingToDeliver: number;
      dispatchableNow: number;
      qcAcceptedQty: number;
      rejectedQty: number;
      workOrderShortfall: number;
    }
  | {
      kind: "SHORTFALL_WO";
      workOrderId: number | null;
      qtyPendingToDeliver: number;
      dispatchableNow: number;
      qcAcceptedQty: number;
      rejectedQty: number;
      workOrderShortfall: number;
    };

/** GET /api/no-qty/next-action — fields used for post-QC handoff presentation. */
export type NoQtyQcNextActionSource = {
  nextAction?: string | null;
  primaryAction?: string | null;
  dispatchableQty?: number | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  primaryActionForCurrentUser?: string | null;
};

export function parseProductionIdFromQcRef(qcRef: string | null | undefined): number | null {
  const m = String(qcRef ?? "").trim().match(/^PE-(\d+)$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** M1.2 — QC entry href from dashboard qc-queue row (backend fields only). */
export function qcQueueRowHref(row: QcDashboardQueueRow): string {
  if (row.actionHref?.trim()) return row.actionHref.trim();
  const prodId = parseProductionIdFromQcRef(row.qcRef);
  const params = new URLSearchParams();
  params.set("source", "dashboard");
  const soId = Number(row.salesOrderId ?? 0);
  if (soId > 0) params.set("salesOrderId", String(soId));
  if (prodId) params.set("productionId", String(prodId));
  const woId = Number(row.workOrderId ?? 0);
  if (woId > 0) params.set("workOrderId", String(woId));
  if (row.orderType === "NO_QTY") {
    const cycleId = Number(row.cycleId ?? 0);
    if (cycleId > 0) params.set("cycleId", String(cycleId));
  }
  return `/qc-entry?${params.toString()}`;
}

export function qcQueueRowLabel(row: QcDashboardQueueRow): string {
  return row.itemName?.trim() || row.workOrderNo?.trim() || "Batch";
}

export function qcQueueRowSubtitle(row: QcDashboardQueueRow): string {
  return [row.salesOrderNo, row.workOrderNo].filter(Boolean).join(" · ") || "—";
}

/**
 * REGULAR post-QC dispatch handoff from fg-work-order-balance backend fields.
 * Does not re-derive dispatchable qty locally.
 */
export function mapRegularPostQcDispatchHandoff(input: {
  balanceItem: FgWorkOrderBalanceItem | null | undefined;
  batchAcceptedQty: number;
  batchRejectedQty: number;
  workOrderId: number | null;
}): RegularPostQcDispatchPresentation | null {
  const bal = input.balanceItem;
  if (!bal) return null;

  const qtyPendingToDeliver = n(bal.pendingSoQty);
  const dispatchableNow = n(bal.dispatchableQty);
  const shortageQty = n(bal.shortageQty);
  if (!(qtyPendingToDeliver > EPS)) return null;

  const base = {
    workOrderId: input.workOrderId,
    qtyPendingToDeliver: roundQty(qtyPendingToDeliver),
    dispatchableNow: roundQty(dispatchableNow),
    qcAcceptedQty: roundQty(input.batchAcceptedQty),
    rejectedQty: roundQty(input.batchRejectedQty),
  };

  if (dispatchableNow >= qtyPendingToDeliver - EPS) {
    return { kind: "DISPATCH_ONLY", ...base };
  }
  if (dispatchableNow <= EPS) {
    return {
      kind: "SHORTFALL_WO",
      ...base,
      workOrderShortfall: roundQty(shortageQty > EPS ? shortageQty : qtyPendingToDeliver),
    };
  }
  return {
    kind: "DECISION",
    ...base,
    workOrderShortfall: roundQty(
      shortageQty > EPS ? shortageQty : Math.max(0, qtyPendingToDeliver - input.batchAcceptedQty),
    ),
  };
}

/** NO_QTY: backend says dispatch handoff is ready (queue clear + positive dispatchable). */
export function isNoQtyDispatchReadyFromNextAction(
  payload: NoQtyQcNextActionSource | null | undefined,
): boolean {
  if (!payload) return false;
  const dispatchable = n(payload.dispatchableQty);
  if (!(dispatchable > EPS)) return false;
  const primary = upper(payload.primaryAction);
  const next = upper(payload.nextAction);
  return primary === "DISPATCH" || next === "DISPATCH" || next === "STORE";
}

export function resolveNoQtyPostQcActionLabel(
  payload: NoQtyQcNextActionSource | null | undefined,
): string | null {
  if (!payload) return null;
  if (payload.actionLabel?.trim()) return payload.actionLabel.trim();
  const primary = upper(payload.primaryAction);
  const next = upper(payload.nextAction);
  if (primary === "NEXT_RS" || next === "NEXT_RS") return "Create Next RS";
  if (primary === "DISPATCH" || next === "DISPATCH" || next === "STORE") return "Go to Dispatch";
  if (primary === "PRODUCTION" || next === "PRODUCTION") return "Go to Production";
  if (next === "DONE") return null;
  return null;
}

export function resolveNoQtyPostQcActionHref(
  payload: NoQtyQcNextActionSource | null | undefined,
  salesOrderId: number,
  cycleId: number | null,
): string | null {
  if (!payload) return null;
  if (payload.actionHref?.trim()) return payload.actionHref.trim();
  const primary = upper(payload.primaryAction);
  const next = upper(payload.nextAction);
  if (primary === "NEXT_RS" || next === "NEXT_RS") {
    return buildNoQtyGuidedHref({
      to: "/requirement-sheets",
      salesOrderId,
      cycleId,
      fromStep: "qc",
    });
  }
  if (primary === "DISPATCH" || next === "DISPATCH" || next === "STORE") {
    return buildNoQtyGuidedHref({
      to: "/dispatch",
      salesOrderId,
      cycleId,
      fromStep: "qc",
    });
  }
  if (primary === "PRODUCTION" || next === "PRODUCTION") {
    return buildNoQtyGuidedHref({
      to: "/production",
      salesOrderId,
      cycleId,
      fromStep: "work_order",
    });
  }
  return null;
}

export function resolveRegularPostQcDispatchHref(salesOrderId: number, partial: boolean): string {
  const base = buildRegularDispatchGuidedHref({ to: "/dispatch", salesOrderId });
  if (!partial) return `${base}&from=qc-entry`;
  return `${base}&mode=partial&from=qc-entry`;
}

export type QcBatchStatus = "AWAITING_QC" | "PARTIAL_QC" | "COMPLETED_QC";

export function qcStatusFromRollups(roll: {
  accepted: number;
  rejected: number;
  pending: number;
}): QcBatchStatus {
  const done = n(roll.accepted) + n(roll.rejected);
  if (n(roll.pending) <= EPS) return "COMPLETED_QC";
  if (done <= EPS) return "AWAITING_QC";
  return "PARTIAL_QC";
}

export function isQcProductionQueueClear(pendingCount: number): boolean {
  return pendingCount <= EPS;
}
