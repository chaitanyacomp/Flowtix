/**
 * Monthly Planning plan-document workflow — UI rules (P4A).
 * Pure helpers for edit gates, action visibility, and legacy detection.
 */

export type MonthlyPlanStatus = "DRAFT" | "AWAITING_PURCHASE_REVIEW" | "APPROVED" | "LOCKED";
export type MonthlyPlanKind = "INITIAL" | "ADDITIONAL";

export type MonthlyPlanHeader = {
  id: number;
  status: MonthlyPlanStatus;
  currentRevision: number;
  planSequenceNo?: number;
  planKind?: MonthlyPlanKind;
  displayLabel?: string | null;
  reopenedAt?: string | null;
  purchaseRejectReason?: string | null;
};

export type WorkflowActionVisibility = {
  save: boolean;
  submitForReview: boolean;
  approve: boolean;
  reject: boolean;
  release: boolean;
  lock: boolean;
  reopen: boolean;
  cancelReopen: boolean;
};

/** Legacy revision / lock workflow — not used for new plan documents. */
export function isLegacyPlanDocument(plan: MonthlyPlanHeader): boolean {
  if (plan.status === "LOCKED") return true;
  if (plan.status === "DRAFT" && plan.currentRevision >= 1) return true;
  return false;
}

/** Only DRAFT plans are editable (server-aligned). */
export function isPlanEditable(
  plan: MonthlyPlanHeader | null | undefined,
  canMutatePeriod: boolean,
): boolean {
  if (!plan || !canMutatePeriod) return false;
  return plan.status === "DRAFT";
}

export function canLoadRmPurchaseTabs(status: MonthlyPlanStatus | undefined): boolean {
  return status === "APPROVED" || status === "LOCKED";
}

export function planStatusBadgeVariant(
  status: MonthlyPlanStatus | undefined,
): "info" | "warning" | "success" | "default" {
  switch (status) {
    case "DRAFT":
      return "info";
    case "AWAITING_PURCHASE_REVIEW":
      return "warning";
    case "APPROVED":
      return "success";
    case "LOCKED":
      return "warning";
    default:
      return "default";
  }
}

export function formatPlanStatusLabel(status: MonthlyPlanStatus | undefined): string {
  if (!status) return "—";
  if (status === "AWAITING_PURCHASE_REVIEW") return "Awaiting Purchase Review";
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export function formatPlanKindLabel(kind: MonthlyPlanKind | undefined): string {
  if (kind === "ADDITIONAL") return "Additional";
  if (kind === "INITIAL") return "Initial";
  return "—";
}

export function resolvePlanDisplayLabel(plan: MonthlyPlanHeader): string {
  if (plan.displayLabel?.trim()) return plan.displayLabel.trim();
  const seq = plan.planSequenceNo && plan.planSequenceNo > 0 ? plan.planSequenceNo : 1;
  return `Plan ${seq}`;
}

export function resolveWorkflowActionVisibility(params: {
  plan: MonthlyPlanHeader | null;
  planExists: boolean;
  canMutatePeriod: boolean;
  canPurchaseReview: boolean;
  hasSaveableLines: boolean;
}): WorkflowActionVisibility {
  const empty: WorkflowActionVisibility = {
    save: false,
    submitForReview: false,
    approve: false,
    reject: false,
    release: false,
    lock: false,
    reopen: false,
    cancelReopen: false,
  };
  const { plan, planExists, canMutatePeriod, canPurchaseReview, hasSaveableLines } = params;
  if (!planExists || !plan) return empty;

  const legacy = isLegacyPlanDocument(plan);
  const editable = isPlanEditable(plan, canMutatePeriod);
  const legacyReopenDraft =
    plan.status === "DRAFT" && plan.currentRevision >= 1 && Boolean(plan.reopenedAt);

  return {
    save: editable,
    submitForReview: editable && !legacy && hasSaveableLines,
    approve: plan.status === "AWAITING_PURCHASE_REVIEW" && canPurchaseReview,
    reject: plan.status === "AWAITING_PURCHASE_REVIEW" && canPurchaseReview,
    release:
      (plan.status === "APPROVED" || plan.status === "LOCKED") && canMutatePeriod,
    lock: editable && legacy && hasSaveableLines,
    reopen: plan.status === "LOCKED" && legacy && canMutatePeriod,
    cancelReopen: legacyReopenDraft && canMutatePeriod,
  };
}

export function canShowAdditionalPlanEntry(params: {
  canMutatePeriod: boolean;
  periodPlans: MonthlyPlanHeader[];
}): boolean {
  if (!params.canMutatePeriod) return false;
  return params.periodPlans.some((p) => p.status === "APPROVED");
}

export function shouldShowPlanSelector(periodPlans: MonthlyPlanHeader[]): boolean {
  return periodPlans.length >= 1;
}

export function rmPurchaseEmptyMessage(
  status: MonthlyPlanStatus | undefined,
  tab: "rm" | "purchase",
): string {
  if (status === "APPROVED") {
    return tab === "rm"
      ? "RM Planning snapshot is not available yet for this approved plan."
      : "Purchase Planning is not available yet for this approved plan.";
  }
  if (status === "AWAITING_PURCHASE_REVIEW") {
    return "Plan is awaiting Purchase review. RM and Purchase Planning unlock after approval.";
  }
  if (status === "DRAFT") {
    return tab === "rm"
      ? "Submit the plan for Purchase review and approval to generate RM Planning."
      : "Submit the plan for Purchase review and approval to review purchase planning.";
  }
  return tab === "rm"
    ? "Lock the production plan to view RM Planning for this period."
    : "Lock the production plan to review purchase planning.";
}
