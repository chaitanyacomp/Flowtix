/**
 * Store-side RM allowance Admin approval workflow (Planned Process Allowance above 5% through 10%).
 * Pure presentation/decision helpers — backend remains authoritative for all approvals and issue posting.
 */
import { formatAllowanceInput } from "./plannedProcessAllowance";

export type RmAllowanceApprovalStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED"
  | "ISSUED"
  | "CANCELLED";

/** Mirrors backend `serializeRequest` (rmAllowanceApprovalService.js). */
export type RmAllowanceApprovalRequest = {
  id: number;
  requestNo?: string | null;
  workOrderId: number | null;
  workOrderNo?: string | null;
  productionMaterialRequestId: number;
  pmrDocNo?: string | null;
  salesOrderId?: number | null;
  salesOrderNo?: string | null;
  pmrLineId: number;
  itemId?: number | null;
  itemName?: string | null;
  unit?: string | null;
  theoreticalBomQty?: number;
  applicableBomQty?: number;
  alreadyIssuedQty?: number;
  addQty: number;
  allowancePct?: number;
  issueQty: number;
  storeReason?: string | null;
  status: RmAllowanceApprovalStatus;
  requestedByUserId?: number | null;
  requestedByName?: string | null;
  requestedAt?: string | null;
  reviewedByUserId?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
};

/** Queue-level status shown on WO cards; "NONE" = no active/relevant request. */
export type PmrAllowanceQueueStatus = "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

const ACTIONABLE_APPROVAL_STATUSES = new Set<RmAllowanceApprovalStatus>([
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
]);

export type PmrAllowanceQueueInfo = {
  status: PmrAllowanceQueueStatus;
  approval: RmAllowanceApprovalRequest | null;
};

/** Latest actionable (PENDING/APPROVED/REJECTED) request for a PMR line — ignores SUPERSEDED/ISSUED. */
export function pickLatestApprovalForPmrLine(
  approvals: RmAllowanceApprovalRequest[],
  pmrLineId: number,
): RmAllowanceApprovalRequest | null {
  let best: RmAllowanceApprovalRequest | null = null;
  for (const a of approvals) {
    if (a.pmrLineId !== pmrLineId) continue;
    if (!ACTIONABLE_APPROVAL_STATUSES.has(a.status)) continue;
    if (!best || a.id > best.id) best = a;
  }
  return best;
}

/** Worst-case (most actionable) allowance status across a PMR's lines, for the queue card badge. */
export function resolvePmrAllowanceQueueInfo(
  approvals: RmAllowanceApprovalRequest[],
  productionMaterialRequestId: number,
): PmrAllowanceQueueInfo {
  const relevant = approvals.filter((a) => a.productionMaterialRequestId === productionMaterialRequestId);
  const pending = relevant.find((a) => a.status === "PENDING_APPROVAL");
  if (pending) return { status: "PENDING_APPROVAL", approval: pending };
  const approved = relevant.find((a) => a.status === "APPROVED");
  if (approved) return { status: "APPROVED", approval: approved };
  const rejected = relevant
    .filter((a) => a.status === "REJECTED")
    .sort((a, b) => b.id - a.id)[0];
  if (rejected) return { status: "REJECTED", approval: rejected };
  return { status: "NONE", approval: null };
}

/** Adds queue-level allowance fields to a pending-PMR summary list (additive; safe to merge every load). */
export function mergeAllowanceQueueInfoIntoPmrs<T extends { id: number }>(
  pmrs: T[],
  approvals: RmAllowanceApprovalRequest[],
): Array<
  T & {
    allowanceStatus: PmrAllowanceQueueStatus;
    allowancePct: number | null;
    allowanceRejectionReason: string | null;
  }
> {
  return pmrs.map((p) => {
    const info = resolvePmrAllowanceQueueInfo(approvals, p.id);
    return {
      ...p,
      allowanceStatus: info.status,
      allowancePct: info.approval?.allowancePct ?? null,
      allowanceRejectionReason: info.approval?.rejectionReason ?? null,
    };
  });
}

export type MaterialIssueLineAllowanceBand =
  | "NORMAL"
  | "NEEDS_REASON"
  | "READY_TO_SEND"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "BLOCKED";

/**
 * Per-line band driving field locking + the row's Issue Status pill.
 * Admin can issue directly once a reason is entered (bypasses the Store→Admin request workflow),
 * mirroring backend `validatePlannedProcessAllowance` (mode ISSUE, role ADMIN).
 */
export function resolveLineAllowanceBand(input: {
  blocked: boolean;
  requiresAdminApproval: boolean;
  hasReason: boolean;
  approvalStatus?: PmrAllowanceQueueStatus | null;
  isAdmin?: boolean;
}): MaterialIssueLineAllowanceBand {
  if (input.blocked) return "BLOCKED";
  if (!input.requiresAdminApproval) return "NORMAL";
  if (!input.hasReason) return "NEEDS_REASON";
  if (input.isAdmin) return "NORMAL";
  const status = input.approvalStatus ?? "NONE";
  if (status === "PENDING_APPROVAL") return "PENDING_APPROVAL";
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED") return "REJECTED";
  return "READY_TO_SEND";
}

export type MaterialIssuePrimaryActionKey =
  | "ISSUE"
  | "NEEDS_REASON"
  | "SEND_FOR_APPROVAL"
  | "AWAITING_APPROVAL"
  | "REVISE_RESUBMIT"
  | "BLOCKED";

export type MaterialIssuePrimaryAction = {
  key: MaterialIssuePrimaryActionKey;
  label: string;
  /** Whole form (all RM lines) should be read-only — e.g. while awaiting Admin review. */
  readOnly: boolean;
};

/** Worst-first: whichever band below appears in the active lines wins the primary action. */
const BAND_PRIORITY: MaterialIssueLineAllowanceBand[] = [
  "BLOCKED",
  "PENDING_APPROVAL",
  "NEEDS_REASON",
  "REJECTED",
  "READY_TO_SEND",
  "APPROVED",
  "NORMAL",
];

export function resolveMaterialIssuePrimaryAction(
  activeLineBands: MaterialIssueLineAllowanceBand[],
  opts: { isAdmin?: boolean } = {},
): MaterialIssuePrimaryAction {
  let worst: MaterialIssueLineAllowanceBand = "NORMAL";
  for (const candidate of BAND_PRIORITY) {
    if (activeLineBands.includes(candidate)) {
      worst = candidate;
      break;
    }
  }
  switch (worst) {
    case "BLOCKED":
      return { key: "BLOCKED", label: "Blocked", readOnly: false };
    case "PENDING_APPROVAL":
      return { key: "AWAITING_APPROVAL", label: "Awaiting Admin Approval", readOnly: true };
    case "NEEDS_REASON":
      return {
        key: "NEEDS_REASON",
        label: opts.isAdmin ? "Enter Reason to Issue" : "Enter Reason to Request Approval",
        readOnly: false,
      };
    case "REJECTED":
      return { key: "REVISE_RESUBMIT", label: "Revise & Resubmit", readOnly: false };
    case "READY_TO_SEND":
      return { key: "SEND_FOR_APPROVAL", label: "Send for Admin Approval", readOnly: false };
    case "APPROVED":
    case "NORMAL":
    default:
      return { key: "ISSUE", label: "Issue Material", readOnly: false };
  }
}

type HydratableIssueLine = {
  pmrLineId?: number;
  plannedAllowanceQty?: string;
  issueQty: string;
  issueQtyTouched: boolean;
  allowanceReason?: string;
  allowanceApprovalId?: number | null;
  allowanceApprovalStatus?: PmrAllowanceQueueStatus | null;
  allowanceApprovalRejectionReason?: string | null;
};

/**
 * Loads a single line's exact submitted/approved quantities from the latest matching request.
 * PENDING_APPROVAL / APPROVED are locked snapshots (fields are read-only in the row while active);
 * REJECTED only backfills once, leaving the operator free to revise before resubmitting.
 */
export function hydrateIssueLineWithAllowanceApproval<T extends HydratableIssueLine>(
  line: T,
  approvals: RmAllowanceApprovalRequest[],
): T {
  if (!line.pmrLineId) return line;
  const latest = pickLatestApprovalForPmrLine(approvals, line.pmrLineId);
  if (!latest) {
    if (line.allowanceApprovalId == null && (line.allowanceApprovalStatus ?? "NONE") === "NONE") return line;
    return {
      ...line,
      allowanceApprovalId: null,
      allowanceApprovalStatus: "NONE",
      allowanceApprovalRejectionReason: null,
    };
  }
  const next: T = {
    ...line,
    allowanceApprovalId: latest.id,
    allowanceApprovalStatus: latest.status as PmrAllowanceQueueStatus,
    allowanceApprovalRejectionReason: latest.rejectionReason ?? null,
  };
  if (latest.status === "PENDING_APPROVAL" || latest.status === "APPROVED") {
    next.plannedAllowanceQty = formatAllowanceInput(latest.addQty);
    next.issueQty = formatAllowanceInput(latest.issueQty);
    next.issueQtyTouched = true;
    next.allowanceReason = latest.storeReason ?? line.allowanceReason;
  } else if (latest.status === "REJECTED" && !line.issueQtyTouched) {
    next.plannedAllowanceQty = formatAllowanceInput(latest.addQty);
    next.issueQty = formatAllowanceInput(latest.issueQty);
    next.allowanceReason = latest.storeReason ?? line.allowanceReason;
  } else if (latest.status === "REJECTED" && line.issueQtyTouched) {
    // Operator revised quantities after rejection — do not keep a false REJECTED band
    // when the draft no longer matches the rejected snapshot (fresh approval may be needed).
    const draftAdd = String(line.plannedAllowanceQty ?? "").trim();
    const rejectedAdd = formatAllowanceInput(latest.addQty);
    if (draftAdd !== "" && draftAdd !== rejectedAdd) {
      next.allowanceApprovalId = null;
      next.allowanceApprovalStatus = "NONE";
      next.allowanceApprovalRejectionReason = null;
    }
  }
  return next;
}

export function hydrateIssueLinesWithAllowanceApprovals<T extends HydratableIssueLine>(
  lines: T[],
  approvals: RmAllowanceApprovalRequest[],
): T[] {
  return lines.map((ln) => hydrateIssueLineWithAllowanceApproval(ln, approvals));
}
