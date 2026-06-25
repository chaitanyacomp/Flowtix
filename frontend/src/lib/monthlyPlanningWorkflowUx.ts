/**
 * Monthly Planning plan-document workflow — UI rules (P4A).
 * Pure helpers for edit gates, action visibility, and legacy detection.
 */

import {
  formatReleaseSuccessSummaryMessage,
  purchasePlanningOperationalStatusMessage,
  purchasePlanningReductionMessageText,
  type MpPlanKind,
} from "./monthlyPlanningProcurementLabels";

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
  discardDraft: boolean;
};

/** User-facing label for migrated lock/revision records (P7F-A). */
export const LEGACY_PLAN_BADGE_LABEL = "Legacy plan";

/** Section title for legacy-only workflow surfaces. */
export const LEGACY_REVISION_WORKFLOW_LABEL = "Legacy revision workflow";

export const APPROVED_PLAN_GUIDANCE =
  "This plan is finalized and retained for audit history. Additional demand must be raised through a new Monthly Plan for the same period.";

export type ProductionPlanReadOnlyContext = {
  periodPlans?: MonthlyPlanHeader[];
  canCreateAdditionalPlan?: boolean;
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

export function canLoadLiveRmEstimate(status: MonthlyPlanStatus | undefined): boolean {
  return status === "DRAFT" || status === "AWAITING_PURCHASE_REVIEW";
}

export function canLoadRmPlanningTab(status: MonthlyPlanStatus | undefined): boolean {
  return canLoadRmPurchaseTabs(status) || canLoadLiveRmEstimate(status);
}

export function resolveRmPlanningTabLabel(status: MonthlyPlanStatus | undefined): string {
  return canLoadLiveRmEstimate(status) ? LIVE_RM_ESTIMATE_TAB_LABEL : RM_REQUIREMENT_SNAPSHOT_TAB_LABEL;
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

export function resolvePlanSequenceNo(plan: MonthlyPlanHeader): number {
  return plan.planSequenceNo && plan.planSequenceNo > 0 ? plan.planSequenceNo : 1;
}

export function hasLaterPlanDocumentsInPeriod(
  plan: MonthlyPlanHeader,
  periodPlans: MonthlyPlanHeader[],
): boolean {
  const seq = resolvePlanSequenceNo(plan);
  return periodPlans.some((p) => p.id !== plan.id && resolvePlanSequenceNo(p) > seq);
}

export function listLaterPlanLabels(plan: MonthlyPlanHeader, periodPlans: MonthlyPlanHeader[]): string[] {
  const seq = resolvePlanSequenceNo(plan);
  return periodPlans
    .filter((p) => p.id !== plan.id && resolvePlanSequenceNo(p) > seq)
    .sort((a, b) => resolvePlanSequenceNo(a) - resolvePlanSequenceNo(b))
    .map(resolvePlanDisplayLabel);
}

/** True when viewing an earlier plan document in a period that already has Plan N+1. */
export function isHistoricalPlanDocument(
  plan: MonthlyPlanHeader,
  periodPlans: MonthlyPlanHeader[],
): boolean {
  if (!usesPlanDocumentProcurementUx(plan)) return false;
  if (plan.status !== "APPROVED") return false;
  return hasLaterPlanDocumentsInPeriod(plan, periodPlans);
}

export function approvedPlanGuidanceMessage(options?: { canCreateAdditionalPlan?: boolean }): string {
  let msg = APPROVED_PLAN_GUIDANCE;
  if (options?.canCreateAdditionalPlan) {
    msg += " Use Create Additional Plan in the header to start the next plan document.";
  }
  return msg;
}

export function historicalApprovedPlanBannerMessage(
  plan: MonthlyPlanHeader,
  periodPlans: MonthlyPlanHeader[],
): string | null {
  if (!isHistoricalPlanDocument(plan, periodPlans)) return null;
  const later = listLaterPlanLabels(plan, periodPlans);
  const laterText =
    later.length > 0 ? later.join(", ") : "a later plan document in this period";
  return `Historical plan document (${resolvePlanDisplayLabel(plan)}). Later plan${
    later.length === 1 ? "" : "s"
  } in this period: ${laterText}. This document is not modified by later plans and remains an audit record.`;
}

export function legacyPlanWorkflowBannerMessage(): string {
  return `${LEGACY_PLAN_BADGE_LABEL} — this record uses the older lock-and-revision workflow from before plan documents (Plan 1, Plan 2, …). For new planning, use Draft → Awaiting Purchase Review → Approved → Create Additional Plan. The actions below apply only to this legacy record.`;
}

/** Tooltip copy when the full-width legacy banner is omitted (P7F-CA1). */
export const LEGACY_PLAN_INFO_TOOLTIP = legacyPlanWorkflowBannerMessage();

/** Shown when a legacy plan is reopened and editing the next lock snapshot (P7F-CA3). */
export const LEGACY_REOPEN_DRAFT_PRODUCTION_GUIDANCE =
  "Requirement Sheet updates do not automatically change the Production Plan. Review suggested production, update planned quantities, save changes, then lock.";

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
    return `${resolvePlanDisplayLabel(plan)} · ${lineCount} RM lines (audit snapshot)`;
  }
  return `Legacy lock snapshot ${snapshotRevision ?? "—"} · ${lineCount} RM lines (read-only)`;
}

export function formatPurchasePlanningContextLabel(params: {
  plan: MonthlyPlanHeader | null | undefined;
  snapshotRevision: number | null | undefined;
  lineCount: number;
}): string {
  const { plan, snapshotRevision, lineCount } = params;
  if (plan && usesPlanDocumentProcurementUx(plan)) {
    return `${resolvePlanDisplayLabel(plan)} · ${lineCount} RM lines (audit snapshot)`;
  }
  return `Legacy lock snapshot ${snapshotRevision ?? "—"} · ${lineCount} RM lines (read-only)`;
}

export function formatReleaseSuccessSummary(params: {
  plan: MonthlyPlanHeader | null | undefined;
  releaseRevision: number;
  materialRequirementDocNo?: string | null;
  releasedLineCount: number;
  totalDeltaQty: number;
  skippedLineCount: number;
  surplusLineCount: number;
  executionWorkOrders?: { workOrderId?: number | null }[] | null;
  executionPmrs?: { pmrId?: number | null }[] | null;
}): string {
  const {
    plan,
    releaseRevision,
    materialRequirementDocNo,
    releasedLineCount,
    totalDeltaQty,
    skippedLineCount,
    surplusLineCount,
    executionWorkOrders,
    executionPmrs,
  } = params;
  const planLabel =
    plan && usesPlanDocumentProcurementUx(plan)
      ? resolvePlanDisplayLabel(plan)
      : `legacy lock snapshot ${releaseRevision}`;
  return formatReleaseSuccessSummaryMessage({
    planLabel,
    materialRequirementDocNo,
    releasedLineCount,
    totalDeltaQty,
    skippedLineCount,
    surplusLineCount,
    executionWorkOrderCount: executionWorkOrders?.length ?? 0,
    executionPmrCount: executionPmrs?.filter((p) => p.pmrId != null).length ?? 0,
  });
}

export function purchasePlanningOperationalStatus(
  additionalRequirementTotal: number,
  demandReleasedTotal = 0,
  planKind: MpPlanKind = null,
): string {
  return purchasePlanningOperationalStatusMessage(
    additionalRequirementTotal,
    demandReleasedTotal,
    planKind,
  );
}

export function purchasePlanningIntroMessage(_plan: MonthlyPlanHeader | null | undefined): string {
  return purchasePlanningOperationalStatus(0, 0);
}

export function purchasePlanningReductionMessage(_plan: MonthlyPlanHeader | null | undefined): string {
  return purchasePlanningReductionMessageText();
}

export function productionPlanReadOnlyMessage(
  plan: MonthlyPlanHeader | null | undefined,
  ctx?: ProductionPlanReadOnlyContext,
): string | null {
  if (!plan || plan.status === "DRAFT") return null;
  if (plan.status === "AWAITING_PURCHASE_REVIEW") {
    return "This plan is awaiting Purchase review. FG lines are read-only until Purchase approves or rejects.";
  }
  if (plan.status === "APPROVED") {
    const parts: string[] = [];
    const periodPlans = ctx?.periodPlans ?? [];
    if (periodPlans.length > 0) {
      const historical = historicalApprovedPlanBannerMessage(plan, periodPlans);
      if (historical) parts.push(historical);
    }
    parts.push(
      approvedPlanGuidanceMessage({ canCreateAdditionalPlan: ctx?.canCreateAdditionalPlan }),
    );
    return parts.join(" ");
  }
  if (plan.status === "LOCKED" && isLegacyPlanDocument(plan)) {
    return `${LEGACY_PLAN_BADGE_LABEL}: this plan is locked under the legacy revision workflow. Reopen Plan (legacy only) prepares the next lock snapshot — use Create Additional Plan on modern plan documents instead.`;
  }
  if (plan.status === "DRAFT" && isLegacyPlanDocument(plan)) {
    return `${LEGACY_REVISION_WORKFLOW_LABEL}: editing draft for the next legacy lock snapshot. Use Cancel Reopen (legacy only) to restore the locked plan.`;
  }
  return "This plan is read-only.";
}

export function rmPlanningEmptyTableMessage(plan: MonthlyPlanHeader | null | undefined): string {
  if (plan && usesPlanDocumentProcurementUx(plan)) {
    return "No RM procurement requirement for this approved plan.";
  }
  return "No RM procurement requirement for this locked plan.";
}

export const MONTHLY_PLAN_DISCARD_DRAFT_CONFIRM_MESSAGE =
  "Discard this draft monthly plan? Suggested items can be recreated from locked Requirement Sheets.";

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
    discardDraft: false,
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
    discardDraft: editable && !legacy && canMutatePeriod,
  };
}

export const MONTHLY_PLAN_NO_WRITE_PERMISSION_MESSAGE =
  "You do not have permission to change monthly plans.";
export const MONTHLY_PLAN_NO_REVIEW_PERMISSION_MESSAGE =
  "You do not have permission to review monthly plans.";
export const MONTHLY_PLAN_PAST_PERIOD_READ_ONLY_MESSAGE =
  "Monthly planning for past periods is read-only. Contact Admin if correction is required.";

export type PlanActionBlockedReason = "no_permission" | "past_period_read_only";

/** Store/Admin monthly-plan write actions (save, submit, release, …). */
export function planMutationActionBlockedReason(params: {
  canMutatePeriod: boolean;
  periodIsPast: boolean;
}): PlanActionBlockedReason | null {
  if (params.canMutatePeriod) return null;
  return params.periodIsPast ? "past_period_read_only" : "no_permission";
}

export function planMutationActionBlockedMessage(reason: PlanActionBlockedReason): string {
  return reason === "past_period_read_only"
    ? MONTHLY_PLAN_PAST_PERIOD_READ_ONLY_MESSAGE
    : MONTHLY_PLAN_NO_WRITE_PERMISSION_MESSAGE;
}

/** Purchase approve/reject — separate from Store write gate (P8F-A1). */
export function purchaseReviewActionBlockedReason(params: {
  canPurchaseReview: boolean;
  periodIsPast: boolean;
  isAdmin: boolean;
}): PlanActionBlockedReason | null {
  if (!params.canPurchaseReview) return "no_permission";
  if (params.periodIsPast && !params.isAdmin) return "past_period_read_only";
  return null;
}

export function purchaseReviewActionBlockedMessage(reason: PlanActionBlockedReason): string {
  return reason === "past_period_read_only"
    ? MONTHLY_PLAN_PAST_PERIOD_READ_ONLY_MESSAGE
    : MONTHLY_PLAN_NO_REVIEW_PERMISSION_MESSAGE;
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
      ? "Plan RM Snapshot is not available yet for this approved plan."
      : "Purchase Planning is not available yet for this approved plan.";
  }
  if (status === "AWAITING_PURCHASE_REVIEW") {
    return tab === "rm"
      ? "Live RM Estimate is available on the RM tab while awaiting Purchase review."
      : "Purchase Planning unlocks after Purchase approval.";
  }
  if (status === "DRAFT") {
    return tab === "rm"
      ? "Add planned FG quantities to view the live RM estimate."
      : "Submit the plan for Purchase review and approval to review purchase planning.";
  }
  return tab === "rm"
    ? "Lock the production plan to view the Plan RM Snapshot for this period."
    : "Lock the production plan to review purchase planning.";
}

/** P7F-B — RM tab and snapshot presentation (copy only). */
export const RM_REQUIREMENT_SNAPSHOT_TAB_LABEL = "Plan RM Snapshot";
export const LIVE_RM_ESTIMATE_TAB_LABEL = "Live RM Estimate";

export const RM_SNAPSHOT_BANNER = {
  title: "Approved Plan RM Snapshot",
  body: "Frozen when this plan was approved and retained for planning audit. Values in this section do not change after purchase orders or goods receipts.",
} as const;

export const LIVE_RM_ESTIMATE_BANNER = {
  title: "Estimated RM Requirement",
  body: "Live estimate only — frozen RM snapshot is created after Purchase approval.",
} as const;

export const PURCHASE_FROZEN_SNAPSHOT_SECTION = {
  title: "Frozen Snapshot",
  subtitle: "Planning baseline captured at approval.",
} as const;

export const PURCHASE_LIVE_PROCUREMENT_SECTION = {
  title: "Live Procurement",
  subtitle: "Updated from PO and GRN activity.",
} as const;

export const PURCHASE_LINE_TABLE_NOTE =
  "Frozen columns = approval snapshot. Live columns = procurement execution.";
