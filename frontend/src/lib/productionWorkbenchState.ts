/**
 * Canonical Production Workbench state — single classifier for Dashboard,
 * Pending Actions, Workbench tabs/cards, and the Production process screen.
 *
 * Production Entry Pending QC is orthogonal to WO execution: a finalized partial
 * batch may be Pending QC while the same WO remains CONTINUE_PRODUCTION with
 * an executable remaining balance.
 */

import {
  assessProductionEntryEligibility,
  type ProductionEligibilitySource,
} from "./productionActiveEligibility";
import type { ProductionWorkspaceSectionId } from "./productionWorkspaceSections";

const EPS = 1e-6;

export type ProductionWorkbenchState =
  | "READY_TO_START"
  | "DRAFT_PENDING"
  | "CONTINUE_PRODUCTION"
  | "PAUSED_PRODUCTION"
  | "PRODUCTION_REPORT_PENDING"
  | "QC_PENDING_ONLY"
  | "BLOCKED"
  | "COMPLETED_OR_CLOSED";

export type ProductionWorkbenchStateSource = ProductionEligibilitySource & {
  productionWorkState?: "READY_TO_START" | "CONTINUE_PRODUCTION" | "PAUSED_PRODUCTION" | "DRAFT_PENDING" | null;
  hasOpenDraft?: boolean | null;
  nextAction?: string | null;
  actionLabel?: string | null;
  productionReportConfirmed?: boolean | null;
  activeShiftRun?: {
    primaryActionLabel?: string | null;
    confirmationPending?: boolean | null;
  } | null;
};

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/**
 * True when a prior finalized batch may be Pending QC while the WO still has
 * an executable remaining balance (Continue Production disposition).
 */
export function hasExecutableBalanceWithPendingEntryQc(row: ProductionWorkbenchStateSource): boolean {
  const eligibility = assessProductionEntryEligibility(row);
  if (!eligibility.canAcceptNewProductionEntry) return false;
  if (eligibility.isPausedProduction || eligibility.isPendingQaOnly) return false;
  const remaining = Math.max(0, n(row.balanceQty));
  if (remaining <= EPS) return false;
  return Boolean(row.hasPendingQc) || upper(row.nextAction) === "QC_PENDING";
}

/** Prefer Continue / Ready production UI over a dead Waiting-for-QA page. */
export function shouldPreferContinueOverEntryQc(row: ProductionWorkbenchStateSource): boolean {
  const state = classifyProductionWorkbenchState(row);
  return state === "CONTINUE_PRODUCTION" || state === "READY_TO_START" || state === "DRAFT_PENDING";
}

export function classifyProductionWorkbenchState(
  row: ProductionWorkbenchStateSource,
): ProductionWorkbenchState {
  const eligibility = assessProductionEntryEligibility(row);
  const next = upper(row.nextAction);
  const produced = n(row.producedQty);
  const backendState = String(row.productionWorkState ?? "").trim().toUpperCase();

  // Mutually exclusive priority (REGULAR + NO_QTY):
  // Report Pending → Draft Awaiting → Paused → Continue → Ready → QC-only → …
  if (
    !row.productionReportConfirmed &&
    (
      next === "PRODUCTION_SHORTFALL_DECISION" ||
      upper(row.productionExecutionStatus) === "SHORTFALL_PENDING" ||
      backendState === "PRODUCTION_REPORT_PENDING"
    )
  ) {
    return "PRODUCTION_REPORT_PENDING";
  }

  if (
    row.hasOpenDraft ||
    next === "PRODUCTION_DRAFT_REVIEW" ||
    backendState === "DRAFT_PENDING"
  ) {
    return "DRAFT_PENDING";
  }

  if (eligibility.isPausedProduction || backendState === "PAUSED_PRODUCTION") {
    return "PAUSED_PRODUCTION";
  }

  if (backendState === "CONTINUE_PRODUCTION" && eligibility.canAcceptNewProductionEntry) {
    return "CONTINUE_PRODUCTION";
  }
  if (row.activeShiftRun && eligibility.canAcceptNewProductionEntry) {
    return "CONTINUE_PRODUCTION";
  }
  if (backendState === "READY_TO_START" && eligibility.canAcceptNewProductionEntry) {
    return "READY_TO_START";
  }

  if (eligibility.canAcceptNewProductionEntry) {
    return produced > EPS ? "CONTINUE_PRODUCTION" : "READY_TO_START";
  }

  if (eligibility.isPendingQaOnly || next === "QC_PENDING") {
    return "QC_PENDING_ONLY";
  }

  if (next === "ON_HOLD" || next === "NEXT_RS_REQUIRED") {
    return "BLOCKED";
  }

  if (eligibility.terminalForProduction) {
    return "COMPLETED_OR_CLOSED";
  }

  return "BLOCKED";
}

export function workbenchStateToSection(
  state: ProductionWorkbenchState,
): Exclude<ProductionWorkspaceSectionId, "awaitingStore" | "recent"> | null {
  switch (state) {
    case "READY_TO_START":
      return "ready";
    case "DRAFT_PENDING":
      return "draftPending";
    case "CONTINUE_PRODUCTION":
      return "active";
    case "PAUSED_PRODUCTION":
      return "paused";
    case "PRODUCTION_REPORT_PENDING":
      return "reportPending";
    case "QC_PENDING_ONLY":
      return "pendingQa";
    default:
      return null;
  }
}

/** Mutually exclusive workspace section from canonical workbench state. */
export function classifyProductionWorkspaceSectionFromState(
  row: ProductionWorkbenchStateSource,
): Exclude<ProductionWorkspaceSectionId, "awaitingStore" | "recent"> | null {
  return workbenchStateToSection(classifyProductionWorkbenchState(row));
}

export function workbenchStateStatusLabel(state: ProductionWorkbenchState): string {
  switch (state) {
    case "READY_TO_START":
      return "Ready";
    case "DRAFT_PENDING":
      return "Draft Pending";
    case "CONTINUE_PRODUCTION":
      return "Continue";
    case "PAUSED_PRODUCTION":
      return "Paused";
    case "PRODUCTION_REPORT_PENDING":
      return "Report Pending";
    case "QC_PENDING_ONLY":
      return "QC Pending";
    case "BLOCKED":
      return "Blocked";
    case "COMPLETED_OR_CLOSED":
      return "Closed";
  }
}

export function workbenchStatePrimaryActionLabel(state: ProductionWorkbenchState): string {
  switch (state) {
    case "READY_TO_START":
      return "Start Production";
    case "DRAFT_PENDING":
      return "Review & Finalize";
    case "CONTINUE_PRODUCTION":
      return "Continue Production";
    case "PAUSED_PRODUCTION":
      return "Resume Production";
    case "PRODUCTION_REPORT_PENDING":
      return "Open Production Report";
    case "QC_PENDING_ONLY":
      return "Open QA";
    case "BLOCKED":
      return "View details";
    case "COMPLETED_OR_CLOSED":
      return "View";
  }
}

/** Prefer active-shift guidance CTA over generic Start / Continue labels. */
export function workbenchRowPrimaryActionLabel(
  row: ProductionWorkbenchStateSource,
  state: ProductionWorkbenchState = classifyProductionWorkbenchState(row),
): string {
  const shift = row.activeShiftRun;
  if (shift) {
    const label = String(shift.primaryActionLabel ?? "").trim();
    if (label === "Confirm Machine Start" || label === "Record Production") return label;
    if (shift.confirmationPending) return "Confirm Machine Start";
    return "Record Production";
  }
  const backendLabel = String(row.actionLabel ?? "").trim();
  if (backendLabel === "Confirm Machine Start" || backendLabel === "Record Production") {
    return backendLabel;
  }
  return workbenchStatePrimaryActionLabel(state);
}

export function productionBucketForWorkbenchState(
  state: ProductionWorkbenchState,
): "readyToStart" | "inProgress" | "draftPending" | null {
  if (state === "READY_TO_START") return "readyToStart";
  if (state === "DRAFT_PENDING") return "draftPending";
  if (state === "CONTINUE_PRODUCTION") return "inProgress";
  return null;
}

export function pwSectionForProductionBucket(
  bucket: "readyToStart" | "inProgress" | string | null | undefined,
): "ready" | "active" | null {
  if (bucket === "readyToStart") return "ready";
  if (bucket === "inProgress") return "active";
  return null;
}

/** Operator-facing note when entry QC coexists with executable remaining qty. */
export function entryQcWithBalanceHint(row: ProductionWorkbenchStateSource): string | null {
  if (!hasExecutableBalanceWithPendingEntryQc(row)) return null;
  const pendingQty = n((row as { pendingQcQty?: number | null }).pendingQcQty);
  const unit = String((row as { itemUnit?: string | null }).itemUnit ?? "").trim();
  const qtyPart =
    pendingQty > EPS ? `${pendingQty}${unit ? ` ${unit}` : ""} finalized batch` : "prior finalized batch";
  return `${qtyPart} is Pending QC — remaining quantity stays available for a new production entry.`;
}
