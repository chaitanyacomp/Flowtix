/**
 * Admin RM Allowance Approval review — Pending Actions deep link.
 * Store submits (above 5% through 10%) → Admin approves/rejects here → Store issues after APPROVED.
 * Backend is authoritative for role checks; this client only mirrors them for UX gating.
 */
import { apiFetch } from "../services/api";
import type { PendingAction } from "./pendingActionsApi";

export type RmAllowanceApprovalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "ISSUED";

export type RmAllowanceApprovalDetail = {
  id: number;
  requestNo: string | null;
  workOrderId: number;
  workOrderNo: string | null;
  productionMaterialRequestId: number;
  pmrDocNo: string | null;
  salesOrderId: number | null;
  salesOrderNo: string | null;
  pmrLineId: number;
  itemId: number;
  itemName: string | null;
  unit: string | null;
  theoreticalBomQty: number;
  applicableBomQty: number;
  alreadyIssuedQty: number;
  addQty: number;
  allowancePct: number;
  issueQty: number;
  availableQtyAtRequest: number | null;
  storeReason: string | null;
  status: RmAllowanceApprovalStatus;
  requestedByUserId: number | null;
  requestedByName: string | null;
  requestedAt: string | null;
  reviewedByUserId: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  materialIssueNoteId: number | null;
  issuedAt: string | null;
  issuedByUserId: number | null;
};

export function fetchRmAllowanceApprovalDetail(id: number): Promise<RmAllowanceApprovalDetail> {
  return apiFetch<RmAllowanceApprovalDetail>(`/api/rm-allowance-approvals/${id}`);
}

export function approveRmAllowanceApproval(id: number): Promise<RmAllowanceApprovalDetail> {
  return apiFetch<RmAllowanceApprovalDetail>(`/api/rm-allowance-approvals/${id}/approve`, {
    method: "POST",
  });
}

export function rejectRmAllowanceApproval(
  id: number,
  rejectionReason: string,
): Promise<RmAllowanceApprovalDetail> {
  return apiFetch<RmAllowanceApprovalDetail>(`/api/rm-allowance-approvals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ rejectionReason }),
  });
}

/** Group key emitted by pendingActionsWorkBuckets for this action label (see backend pendingActionsService). */
export const RM_ALLOWANCE_APPROVAL_ACTION = "RM Allowance Approval";

/** Resolve the request id targeted by a Pending Action row — metadata first, href fallback. */
export function resolveAllowanceApprovalIdFromAction(
  action: Pick<PendingAction, "metadata" | "href"> | null | undefined,
): number | null {
  if (!action) return null;
  const metaId = Number((action.metadata as { allowanceApprovalId?: unknown } | null | undefined)?.allowanceApprovalId ?? NaN);
  if (Number.isFinite(metaId) && metaId > 0) return metaId;
  const href = String(action.href ?? "");
  const match = href.match(/allowanceApprovalId=(\d+)/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
