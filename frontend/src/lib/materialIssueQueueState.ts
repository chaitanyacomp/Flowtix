/**
 * Material Issue workspace queue classification (PMR lifecycle × allowance approval).
 * Backend `issueQueueState` is authoritative when present; helpers here derive/merge for UI.
 */

import type { PendingPmrSummary } from "./materialIssueWorkspace";
import type { PmrAllowanceQueueStatus } from "./rmAllowanceApprovalUx";

const EPS = 1e-6;

/** Backend-derived PMR issue lifecycle for the Store side queue. */
export type PmrIssueQueueState =
  | "READY_TO_ISSUE"
  | "PARTIALLY_ISSUED"
  | "COMPLETE"
  | "SHORT_CLOSED";

/** Sidebar filter keys (orthogonal: approval buckets + partial lifecycle). */
export type MaterialIssueQueueFilterKey =
  | "READY"
  | "PARTIAL"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export function derivePmrIssueQueueState(input: {
  status?: string | null;
  totalIssued?: number | null;
  totalPending?: number | null;
}): PmrIssueQueueState {
  const status = String(input.status ?? "").toUpperCase();
  if (status === "SHORT_ISSUE_ACCEPTED") return "SHORT_CLOSED";
  if (status === "FULLY_ISSUED" || status === "CANCELLED") return "COMPLETE";
  if (status === "PARTIALLY_ISSUED") return "PARTIALLY_ISSUED";

  const issued = Number(input.totalIssued ?? 0);
  const pending = Number(input.totalPending ?? 0);
  if (status === "REQUESTED" || status === "DRAFT") {
    if (issued > EPS && pending > EPS) return "PARTIALLY_ISSUED";
    if (pending > EPS) return "READY_TO_ISSUE";
    return "COMPLETE";
  }
  if (issued > EPS && pending > EPS) return "PARTIALLY_ISSUED";
  if (pending > EPS) return "READY_TO_ISSUE";
  return "COMPLETE";
}

export function resolveIssueQueueState(pmr: PendingPmrSummary): PmrIssueQueueState {
  if (pmr.issueQueueState) return pmr.issueQueueState;
  return derivePmrIssueQueueState({
    status: pmr.status,
    totalIssued: pmr.totalIssued,
    totalPending: pmr.totalPending,
  });
}

/**
 * Primary sidebar tab for a WO/PMR group.
 * Approval states win over Ready/Partial so a pending request never appears in Ready.
 */
export function resolveMaterialIssueQueueFilter(input: {
  allowanceStatus?: PmrAllowanceQueueStatus | null;
  issueQueueState: PmrIssueQueueState;
}): MaterialIssueQueueFilterKey {
  const allowance = input.allowanceStatus ?? "NONE";
  if (allowance === "PENDING_APPROVAL") return "PENDING";
  if (allowance === "APPROVED") return "APPROVED";
  if (allowance === "REJECTED") return "REJECTED";
  if (input.issueQueueState === "PARTIALLY_ISSUED") return "PARTIAL";
  return "READY";
}

export function isReadyToIssueQueuePmr(pmr: PendingPmrSummary): boolean {
  const allowance = pmr.allowanceStatus ?? "NONE";
  if (allowance === "PENDING_APPROVAL" || allowance === "REJECTED") return false;
  if (allowance === "APPROVED") return true;
  return resolveIssueQueueState(pmr) === "READY_TO_ISSUE";
}

export function formatPartialIssueSuccessMessage(input: {
  issuedQty: number;
  remainingQty: number;
  unit?: string | null;
}): string {
  const unit = input.unit?.trim() ? ` ${input.unit.trim()}` : "";
  const issued = formatQty(input.issuedQty);
  const remaining = formatQty(input.remainingQty);
  if (input.remainingQty > EPS) {
    return `${issued}${unit} issued. Remaining ${remaining}${unit} moved to Partially Issued.`;
  }
  return `${issued}${unit} issued. Material request complete.`;
}

function formatQty(n: number): string {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
