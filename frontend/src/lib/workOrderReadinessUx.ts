/**
 * M1.6 — Work Order Workspace readiness consumption (presentation only).
 * Maps production-queue backend fields → labels / tones / CTAs.
 * Does not decide eligibility — lifecycle POST APIs remain the authority.
 */

import { holdReasonLabel } from "./workOrderLifecycle";

export type WorkOrderQueueReadinessSource = {
  nextAction?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  status?: string | null;
  holdReason?: string | null;
  productionExecutionStatus?: string | null;
  productionBlockReasonLabel?: string | null;
  productionBlockReason?: string | null;
  orderType?: string | null;
  rmReadinessGate?: string | null;
  rmReadyForProduction?: boolean | null;
  hasPendingQc?: boolean;
  producedQty?: number | null;
  balanceQty?: number | null;
};

export type WorkOrderOperationalPresentation = {
  label: string;
  tone: "running" | "qc" | "partial" | "carryForward" | "carriedForward" | "dispatch" | "idle";
  contextHint?: string;
  /** Prefer backend actionLabel when present. */
  actionLabel: string | null;
};

const EPS = 1e-6;

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

/** Presentation map: RM readiness gate → operator waiting label. */
export function mapRmReadinessGateToLabel(gate: string | null | undefined): string | null {
  switch (upper(gate)) {
    case "NO_PMR":
    case "PMR_DRAFT_ONLY":
      return "Waiting for Material";
    case "WAITING_STORE_ISSUE":
      return "Waiting for RM issue";
    case "WAITING_RELEASE_TO_PRODUCTION":
      return "Waiting for Production Release";
    case "READY_FOR_PRODUCTION":
      return "Ready for Production";
    default:
      return null;
  }
}

/**
 * Primary operational status from production-queue readiness fields.
 * Prefer nextAction + RM/hold/block fields; qty is display context only.
 */
export function mapQueueReadinessToOperationalPresentation(
  row: WorkOrderQueueReadinessSource,
): WorkOrderOperationalPresentation {
  const next = upper(row.nextAction);
  const woStatus = upper(row.status);
  const exec = upper(row.productionExecutionStatus);
  const produced = n(row.producedQty);
  const remaining = Math.max(0, n(row.balanceQty));
  const actionLabel = row.actionLabel?.trim() || null;

  if (exec === "BLOCKED" || next === "PRODUCTION_EXECUTION_BLOCKED") {
    const blocker =
      row.productionBlockReasonLabel?.trim() ||
      (row.productionBlockReason ? String(row.productionBlockReason).replace(/_/g, " ") : "Blocked");
    return { label: blocker, tone: "partial", actionLabel };
  }

  if (next === "PRODUCTION_SHORTFALL_DECISION" || exec === "SHORTFALL_PENDING") {
    return { label: "Resolve Shortfall", tone: "partial", actionLabel };
  }

  if (woStatus === "HOLD" || next === "ON_HOLD") {
    const hold = holdReasonLabel(row.holdReason);
    return {
      label: hold === "On hold" ? "On Hold" : `On Hold - ${hold}`,
      tone: "partial",
      actionLabel: actionLabel ?? "Review Hold",
    };
  }

  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    return { label: "Shortfall Closed", tone: "idle", actionLabel };
  }

  if (next === "QC_PENDING" || row.hasPendingQc) {
    return { label: "QA in progress", tone: "qc", actionLabel: actionLabel ?? "Complete QA" };
  }

  if (next === "DISPATCH_PENDING") {
    return {
      label: row.orderType === "NO_QTY" ? "Dispatch Pending" : "Waiting Dispatch",
      tone: "dispatch",
      actionLabel: actionLabel ?? "Go to Dispatch",
    };
  }

  if (next === "SALES_BILL_PENDING") {
    return { label: "Ready to Bill", tone: "dispatch", actionLabel: actionLabel ?? "Create Sales Bill" };
  }

  if (next === "NEXT_RS_REQUIRED") {
    return {
      label: "Next Cycle",
      tone: "carryForward",
      actionLabel: actionLabel ?? "Create Next RS",
    };
  }

  if (next === "PRODUCTION_PENDING") {
    const rmLabel = mapRmReadinessGateToLabel(row.rmReadinessGate);
    if (rmLabel && row.rmReadyForProduction !== true && produced <= EPS) {
      return { label: rmLabel, tone: "partial", actionLabel };
    }
    if (produced > EPS && remaining > EPS) {
      return {
        label: row.orderType === "NO_QTY" || upper(row.orderType) === "GREEN_LEVEL" ? "Continue Production" : "Partially Produced",
        tone: "running",
        actionLabel,
      };
    }
    if (produced <= EPS) {
      if (row.rmReadyForProduction === true || upper(row.rmReadinessGate) === "READY_FOR_PRODUCTION") {
        return { label: "Ready for Production", tone: "running", actionLabel };
      }
      if (woStatus === "IN_PROGRESS" || woStatus === "PENDING" || woStatus === "PAUSED") {
        return { label: "Ready for Production", tone: "running", actionLabel };
      }
      return { label: "Waiting for Production", tone: "running", actionLabel };
    }
    return { label: "In Production", tone: "running", actionLabel };
  }

  if (remaining <= EPS && produced > EPS) {
    return {
      label: row.orderType === "NO_QTY" ? "Production Complete" : "Completed",
      tone: "idle",
      actionLabel,
    };
  }

  if (actionLabel) {
    return { label: actionLabel, tone: "running", actionLabel };
  }

  return { label: "Production Pending", tone: "running", actionLabel };
}

/** Prefer backend actionLabel; href-inferred labels are presentation fallback only. */
export function resolveQueueActionLabel(
  row: Pick<WorkOrderQueueReadinessSource, "actionLabel" | "nextAction">,
  hrefInferredLabel?: string | null,
): string {
  if (row.actionLabel?.trim()) return row.actionLabel.trim();
  if (hrefInferredLabel?.trim()) return hrefInferredLabel.trim();
  const next = upper(row.nextAction);
  if (next === "QC_PENDING") return "Complete QA";
  if (next === "DISPATCH_PENDING") return "Go to Dispatch";
  if (next === "NEXT_RS_REQUIRED") return "Create Next RS";
  if (next === "SALES_BILL_PENDING") return "Create Sales Bill";
  if (next === "ON_HOLD") return "Review Hold";
  if (next === "PRODUCTION_PENDING") return "Go to Production";
  return "View WO";
}
