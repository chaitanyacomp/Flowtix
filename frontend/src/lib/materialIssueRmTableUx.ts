/**
 * Material Issue RM table — compact status badges and sticky action summary (display only).
 */
import {
  calculatePlannedAllowance,
  issueStatusPresentation,
  type PlannedAllowanceCalculation,
} from "./plannedProcessAllowance";
import { assessMaterialIssueQty } from "./materialIssueUx";

export type MaterialIssueCompactStatus =
  | "Ready"
  | "Approval Required"
  | "Approval Pending"
  | "Insufficient Stock"
  | "Invalid Qty";

export type MaterialIssueCompactStatusResult = {
  label: MaterialIssueCompactStatus;
  tone: "ready" | "warning" | "danger";
  /** Longer explanation for tooltip / expanded row. */
  detail: string | null;
};

export type MaterialIssueRmSummaryLine = {
  pmrLineId?: number;
  unit?: string;
  issueQty: string;
  theoreticalQty: number;
  issuedQty: number;
  pendingQty: number;
  stillRequiredQty?: number;
  issueCapQty?: number;
  maxAllowedIssueQty?: number;
  plannedAllowanceQty?: string;
  allowanceReason?: string;
  availableQty: number | null;
  approvalStatus?: "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  approvalRejectionReason?: string | null;
  disabled?: boolean;
};

function fmtQty(n: number, maxFractionDigits = 3): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

export function resolveCompactLineStatus(input: {
  calculation: PlannedAllowanceCalculation;
  availableQty: number | null;
  issueQty: string;
  allowanceReason?: string;
  actorRole?: string | null;
  approvalStatus?: "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  approvalRejectionReason?: string | null;
  pendingQty: number;
  stillRequiredQty?: number;
  maxAllowedIssueQty?: number;
}): MaterialIssueCompactStatusResult {
  const approvalStatus = input.approvalStatus ?? "NONE";
  if (approvalStatus === "PENDING_APPROVAL") {
    return {
      label: "Approval Pending",
      tone: "warning",
      detail: "Sent to Admin for review — this line is locked until decided.",
    };
  }
  if (approvalStatus === "REJECTED") {
    return {
      label: "Approval Required",
      tone: "danger",
      detail:
        input.approvalRejectionReason?.trim() ||
        "Revise Add Qty or reason and resubmit for approval.",
    };
  }

  const issueNum = Number(input.issueQty || 0);
  const assessment = assessMaterialIssueQty(input.issueQty, input.pendingQty, {
    woStillRequiredQty: input.stillRequiredQty,
    maxAllowedIssueQty: input.maxAllowedIssueQty,
  });
  if (issueNum > 1e-6 && !assessment.allowed) {
    return {
      label: "Invalid Qty",
      tone: "danger",
      detail: "Issue quantity exceeds allowed tolerance or still-required balance.",
    };
  }
  if (!input.calculation.valid) {
    return {
      label: "Invalid Qty",
      tone: "danger",
      detail: input.calculation.error ?? "Enter a valid Add Qty.",
    };
  }

  const presentation = issueStatusPresentation({
    calculation: input.calculation,
    availableQty: input.availableQty,
    issueQty: input.issueQty,
    reason: input.allowanceReason,
    actorRole: input.actorRole,
  });

  if (presentation.issueLabel.toLowerCase().includes("insufficient stock")) {
    return {
      label: "Insufficient Stock",
      tone: "danger",
      detail: presentation.issueMessage,
    };
  }
  if (input.calculation.blocked) {
    return {
      label: "Invalid Qty",
      tone: "danger",
      detail: presentation.issueMessage,
    };
  }
  if (
    approvalStatus === "APPROVED" ||
    (input.calculation.requiresAdminApproval && presentation.tone === "ready")
  ) {
    return {
      label: "Ready",
      tone: "ready",
      detail: presentation.issueMessage,
    };
  }
  if (input.calculation.requiresAdminApproval || presentation.tone === "warning") {
    return {
      label: "Approval Required",
      tone: "warning",
      detail: presentation.issueMessage,
    };
  }
  return {
    label: "Ready",
    tone: "ready",
    detail: null,
  };
}

export function buildMaterialIssueActionSummary(
  lines: MaterialIssueRmSummaryLine[],
  actorRole?: string | null,
): string {
  const pmrLines = lines.filter((ln) => ln.pmrLineId);
  const lineCount = pmrLines.length;
  if (lineCount === 0) return "No RM lines loaded";

  const primaryUnit = pmrLines.find((ln) => ln.unit?.trim())?.unit?.trim();
  const totalIssue = pmrLines.reduce((sum, ln) => sum + Math.max(0, Number(ln.issueQty) || 0), 0);

  let ready = 0;
  let approvalPending = 0;
  for (const ln of pmrLines) {
    const calculation = calculatePlannedAllowance({
      theoreticalQty: ln.theoreticalQty,
      quantityRaw: ln.plannedAllowanceQty ?? "0",
      alreadyIssuedQty: ln.issuedQty,
    });
    const status = resolveCompactLineStatus({
      calculation,
      availableQty: ln.availableQty,
      issueQty: ln.issueQty,
      allowanceReason: ln.allowanceReason,
      actorRole,
      approvalStatus: ln.approvalStatus,
      approvalRejectionReason: ln.approvalRejectionReason,
      pendingQty: ln.pendingQty,
      stillRequiredQty: ln.stillRequiredQty ?? ln.issueCapQty,
      maxAllowedIssueQty: ln.maxAllowedIssueQty,
    });
    if (status.label === "Approval Pending") approvalPending += 1;
    if (status.label === "Ready") ready += 1;
  }

  const issuePart = primaryUnit
    ? `Issue ${fmtQty(totalIssue)} ${primaryUnit}`
    : `Issue ${fmtQty(totalIssue)}`;
  return `${lineCount} RM line${lineCount === 1 ? "" : "s"} · ${issuePart} · ${ready} Ready · ${approvalPending} Approval Pending`;
}

export const MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS =
  "grid min-w-0 grid-cols-2 gap-x-2 gap-y-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 sm:grid-cols-[minmax(5.5rem,1.15fr)_repeat(3,minmax(3.5rem,.65fr))_minmax(4rem,.7fr)_minmax(3rem,.45fr)_minmax(4rem,.7fr)_minmax(4rem,.72fr)_minmax(3.25rem,.55fr)]";

export const MATERIAL_ISSUE_RM_TABLE_ROW_CLASS =
  "grid min-w-0 grid-cols-2 gap-x-2 gap-y-1 border-b border-slate-100 px-2 py-1.5 text-sm sm:grid-cols-[minmax(5.5rem,1.15fr)_repeat(3,minmax(3.5rem,.65fr))_minmax(4rem,.7fr)_minmax(3rem,.45fr)_minmax(4rem,.7fr)_minmax(4rem,.72fr)_minmax(3.25rem,.55fr)] sm:items-center sm:gap-y-0 min-h-[52px] sm:min-h-[56px]";

/**
 * Kg rounding desktop one-row layout.
 * Columns: RM | Planned Requirement | Rounding Rule | Issue Target | Already Issued | Remaining | Rounding Excess | Issue Now | Available | Status
 */
export const MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS_KG =
  "hidden min-w-0 gap-x-2 border-b border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] font-semibold tracking-wide text-slate-600 lg:grid lg:grid-cols-[minmax(7rem,1.25fr)_minmax(5.75rem,0.9fr)_minmax(7rem,1fr)_minmax(5.25rem,0.85fr)_minmax(5.25rem,0.85fr)_minmax(5rem,0.8fr)_minmax(5.75rem,0.9fr)_minmax(5.5rem,0.9fr)_minmax(5rem,0.8fr)_minmax(4.75rem,0.75fr)] lg:items-center";

export const MATERIAL_ISSUE_RM_TABLE_ROW_CLASS_KG =
  "hidden min-w-0 gap-x-2 border-b border-slate-100 px-2.5 py-2 text-sm lg:grid lg:grid-cols-[minmax(7rem,1.25fr)_minmax(5.75rem,0.9fr)_minmax(7rem,1fr)_minmax(5.25rem,0.85fr)_minmax(5.25rem,0.85fr)_minmax(5rem,0.8fr)_minmax(5.75rem,0.9fr)_minmax(5.5rem,0.9fr)_minmax(5rem,0.8fr)_minmax(4.75rem,0.75fr)] lg:items-center";

/** Compact two-line card for Kg RM below lg breakpoint. */
export const MATERIAL_ISSUE_RM_CARD_CLASS_KG =
  "grid gap-2 border-b border-slate-100 px-2.5 py-2.5 lg:hidden";
