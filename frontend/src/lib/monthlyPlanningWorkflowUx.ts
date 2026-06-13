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

/** New plan-document workflow uses approval, not lock/revision UX. */
export function usesPlanDocumentProcurementUx(plan: MonthlyPlanHeader | null | undefined): boolean {
  if (!plan) return false;
  return !isLegacyPlanDocument(plan);
}

export function formatRmSnapshotContextLabel(params: {
  plan: MonthlyPlanHeader | null | undefined;
  snapshotRevision: number | null | undefined;
  lineCount: number;
}): string {
  const { plan, snapshotRevision, lineCount } = params;
  if (plan && usesPlanDocumentProcurementUx(plan)) {
    return `${resolvePlanDisplayLabel(plan)} · ${lineCount} RM lines (read-only)`;
  }
  return `Snapshot revision ${snapshotRevision ?? "—"} · ${lineCount} RM lines (read-only)`;
}

export function formatPurchasePlanningContextLabel(params: {
  plan: MonthlyPlanHeader | null | undefined;
  snapshotRevision: number | null | undefined;
  lineCount: number;
}): string {
  const { plan, snapshotRevision, lineCount } = params;
  if (plan && usesPlanDocumentProcurementUx(plan)) {
    return `${resolvePlanDisplayLabel(plan)} · ${lineCount} RM lines (read-only)`;
  }
  return `Current revision ${snapshotRevision ?? "—"} · ${lineCount} RM lines (read-only)`;
}

export function formatReleaseSuccessSummary(params: {
  plan: MonthlyPlanHeader | null | undefined;
  releaseRevision: number;
  materialRequirementDocNo?: string | null;
  releasedLineCount: number;
  totalDeltaQty: number;
  skippedLineCount: number;
  surplusLineCount: number;
}): string {
  const {
    plan,
    releaseRevision,
    materialRequirementDocNo,
    releasedLineCount,
    totalDeltaQty,
    skippedLineCount,
    surplusLineCount,
  } = params;
  const source =
    plan && usesPlanDocumentProcurementUx(plan)
      ? resolvePlanDisplayLabel(plan)
      : `revision ${releaseRevision}`;
  const mrPart = materialRequirementDocNo ? ` → MR ${materialRequirementDocNo}` : "";
  return `Released ${source}${mrPart}: ${releasedLineCount} line(s) released (delta ${totalDeltaQty.toLocaleString()}), ${skippedLineCount} skipped, ${surplusLineCount} surplus.`;
}

export function purchasePlanningOperationalStatus(
  additionalRequirementTotal: number,
  previouslyReleasedTotal = 0,
): string {
  if (additionalRequirementTotal > 1e-9) {
    return "Additional procurement required. Release Delta to Procurement available.";
  }
  if (previouslyReleasedTotal > 1e-9) {
    return "Procurement released for current plan. No additional procurement required.";
  }
  return "Review RM requirements and release procurement when the plan is approved.";
}

export function purchasePlanningIntroMessage(_plan: MonthlyPlanHeader | null | undefined): string {
  return purchasePlanningOperationalStatus(0, 0);
}

export function purchasePlanningReductionMessage(_plan: MonthlyPlanHeader | null | undefined): string {
  return "Plan requires less RM than previously released. Open MR quantity will be reduced where possible.";
}

export function productionPlanReadOnlyMessage(plan: MonthlyPlanHeader | null | undefined): string | null {
  if (!plan || plan.status === "DRAFT") return null;
  if (plan.status === "AWAITING_PURCHASE_REVIEW") {
    return "This plan is awaiting Purchase review. FG lines are read-only until Purchase approves or rejects.";
  }
  if (plan.status === "APPROVED") {
    return "This approved plan document is frozen. Use Additional Plan if requirements increase in this period.";
  }
  if (plan.status === "LOCKED" && isLegacyPlanDocument(plan)) {
    return "This plan is locked. Use Reopen Plan in the header to edit the next revision draft.";
  }
  if (plan.status === "DRAFT" && isLegacyPlanDocument(plan)) {
    return "Editing draft for the next legacy revision. Use Cancel Reopen to restore the locked revision.";
  }
  return "This plan is read-only.";
}

export function rmPlanningEmptyTableMessage(plan: MonthlyPlanHeader | null | undefined): string {
  if (plan && usesPlanDocumentProcurementUx(plan)) {
    return "No RM procurement requirement for this approved plan.";
  }
  return "No RM procurement requirement for this locked plan.";
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
