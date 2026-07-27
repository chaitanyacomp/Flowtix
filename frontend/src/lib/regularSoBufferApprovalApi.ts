/**
 * REGULAR_SO Prepare WO production buffer Admin approval (above 5% through 10%).
 * Store submits → Admin approves/rejects on Pending Actions → Store creates WO with approved buffer.
 */
import { apiFetch } from "../services/api";
import type { PendingAction } from "./pendingActionsApi";
import {
  clampRegularSoBufferPercent,
  computeProductionPlanningMetrics,
} from "./regularSoProductionPlanning";

export type RegularSoBufferApprovalStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "SUPERSEDED";

export type RegularSoBufferApprovalDetail = {
  id: number;
  requestNo: string | null;
  salesOrderId: number;
  salesOrderNo: string | null;
  orderType: string | null;
  fgItemId: number | null;
  fgItemName: string | null;
  fgUnit: string | null;
  bufferPercent: number;
  plannedProductionQty: number;
  storeReason: string;
  status: RegularSoBufferApprovalStatus;
  requestedByUserId: number | null;
  requestedByName: string | null;
  requestedAt: string | null;
  reviewedByUserId: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  adminRemarks: string | null;
  rejectionReason: string | null;
};

export type RegularSoBufferFingerprint = {
  bufferPercent: number;
  plannedProductionQty: number;
  storeReason: string;
};

const PCT_EPS = 0.0001;
const QTY_EPS = 0.000001;

/** Normalize fingerprint values the same way request/approve/load/compare must. */
export function normalizeRegularSoBufferFingerprint(input: {
  bufferPercent: number;
  plannedProductionQty: number;
  storeReason: string;
}): RegularSoBufferFingerprint {
  const planned = Number(input.plannedProductionQty);
  return {
    bufferPercent: clampRegularSoBufferPercent(input.bufferPercent),
    plannedProductionQty: Number.isFinite(planned)
      ? Math.round((planned + Number.EPSILON) * 1000) / 1000
      : 0,
    storeReason: String(input.storeReason ?? "").trim(),
  };
}

/**
 * SO-level planned WO qty (sum of FG lines) — must match backend computePlannedProductionQtyTotal.
 */
export function sumRegularSoPlannedProductionQtyForBuffer(
  lines: Array<{ customerCommittedQty?: number; orderQty?: number; note?: string | null }>,
  bufferPercent: number,
): number {
  const pct = clampRegularSoBufferPercent(bufferPercent);
  let total = 0;
  for (const line of lines) {
    if (line.note) continue;
    const customer = Number(line.customerCommittedQty ?? line.orderQty) || 0;
    total += computeProductionPlanningMetrics(customer, pct, 0).plannedProductionQty;
  }
  return total;
}

export function regularSoBufferApprovalFingerprintsMatch(
  approval:
    | Pick<RegularSoBufferApprovalDetail, "bufferPercent" | "plannedProductionQty" | "storeReason">
    | null
    | undefined,
  current: { bufferPercent: number; plannedProductionQty: number; storeReason: string },
): boolean {
  if (!approval) return false;
  const a = normalizeRegularSoBufferFingerprint({
    bufferPercent: Number(approval.bufferPercent),
    plannedProductionQty: Number(approval.plannedProductionQty),
    storeReason: String(approval.storeReason ?? ""),
  });
  const b = normalizeRegularSoBufferFingerprint(current);
  return (
    Math.abs(a.bufferPercent - b.bufferPercent) <= PCT_EPS &&
    Math.abs(a.plannedProductionQty - b.plannedProductionQty) <= QTY_EPS &&
    a.storeReason === b.storeReason
  );
}

/** UI status for Prepare WO — avoids marking APPROVED as stale before hydration restores reason. */
export function resolveRegularSoBufferApprovalUiStatus(input: {
  requiresAdmin: boolean;
  approval: RegularSoBufferApprovalDetail | null | undefined;
  fingerprintMatches: boolean;
  hydrated: boolean;
  userEdited: boolean;
}): "none" | "pending" | "approved" | "rejected" | "stale" {
  const { requiresAdmin, approval, fingerprintMatches, hydrated, userEdited } = input;
  if (!requiresAdmin) return "none";
  if (!approval) return "none";
  const status = String(approval.status);
  if (
    !userEdited &&
    !hydrated &&
    (status === "APPROVED" || status === "PENDING_APPROVAL" || status === "REJECTED")
  ) {
    // Still restoring approved buffer/reason — do not flash "changed".
    if (status === "APPROVED") return "approved";
    if (status === "PENDING_APPROVAL") return "pending";
    if (status === "REJECTED") return "rejected";
  }
  if (!fingerprintMatches) return "stale";
  if (status === "PENDING_APPROVAL") return "pending";
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  return "stale";
}

export function fetchLatestRegularSoBufferApproval(
  salesOrderId: number,
): Promise<RegularSoBufferApprovalDetail | null> {
  return apiFetch<RegularSoBufferApprovalDetail | null>(
    `/api/regular-so-buffer-approvals?latestForSalesOrderId=${salesOrderId}`,
  );
}

export function submitRegularSoBufferApproval(input: {
  salesOrderId: number;
  bufferPercent: number;
  storeReason: string;
  plannedProductionQty?: number;
}): Promise<RegularSoBufferApprovalDetail> {
  return apiFetch<RegularSoBufferApprovalDetail>("/api/regular-so-buffer-approvals", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      bufferPercent: clampRegularSoBufferPercent(input.bufferPercent),
      storeReason: String(input.storeReason ?? "").trim(),
    }),
  });
}

export function fetchRegularSoBufferApprovalDetail(id: number): Promise<RegularSoBufferApprovalDetail> {
  return apiFetch<RegularSoBufferApprovalDetail>(`/api/regular-so-buffer-approvals/${id}`);
}

export function approveRegularSoBufferApproval(
  id: number,
  adminRemarks?: string,
): Promise<RegularSoBufferApprovalDetail> {
  return apiFetch<RegularSoBufferApprovalDetail>(`/api/regular-so-buffer-approvals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ adminRemarks: adminRemarks?.trim() || null }),
  });
}

export function rejectRegularSoBufferApproval(
  id: number,
  adminRemarks: string,
): Promise<RegularSoBufferApprovalDetail> {
  return apiFetch<RegularSoBufferApprovalDetail>(`/api/regular-so-buffer-approvals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({
      adminRemarks: adminRemarks.trim(),
      rejectionReason: adminRemarks.trim(),
    }),
  });
}

export const REGULAR_SO_BUFFER_APPROVAL_ACTION = "Production Buffer Approval";
export const REGULAR_SO_BUFFER_APPROVAL_FOCUS = "regular-so-buffer-approval";

export function resolveBufferApprovalIdFromAction(
  action: Pick<PendingAction, "metadata" | "href"> | null | undefined,
): number | null {
  if (!action) return null;
  const metaId = Number(
    (action.metadata as { bufferApprovalId?: unknown } | null | undefined)?.bufferApprovalId ?? NaN,
  );
  if (Number.isFinite(metaId) && metaId > 0) return metaId;
  const href = String(action.href ?? "");
  const match = href.match(/bufferApprovalId=(\d+)/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
