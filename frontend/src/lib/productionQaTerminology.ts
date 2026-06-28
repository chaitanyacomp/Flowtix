/**
 * Production-embedded QA presentation (Phase 1).
 * Labels and navigation copy only — internal keys (QC_PENDING, /qc-entry) unchanged.
 */

export const PRODUCTION_QA_TERMS = {
  WORKSPACE_TITLE: "Quality Inspection Workspace",
  WORKSPACE_NAV: "Quality Inspection",
  REPORT_BACK: "Back to Quality Inspection Workspace",
  DASHBOARD_TITLE: "Quality Inspection Dashboard",
  PRODUCTION_DASHBOARD_TITLE: "Production Dashboard",
  PRODUCTION_WORKSPACE_TITLE: "Production Workspace",
  QA_OPERATOR_DASHBOARD_SUBTITLE: "Inspection · rework · disposition (production workflow)",
  PRODUCTION_DASHBOARD_SUBTITLE: "Shop floor · production · embedded QA",

  COMPLETE_QA: "Complete QA",
  OPEN_PRODUCTION_QA: "Open Quality Inspection Workspace",
  CONTINUE_QA: "Continue QA",
  VIEW_QA_ENTRIES: "View QA entries",

  QA_IN_PROGRESS: "QA in progress",
  QA_IN_PROGRESS_LABEL: "Pending QC",
  AWAITING_QA: "Pending QC",
  WAITING_FOR_QA: "Waiting for QA",
  QA_PENDING_STRIP: "QA in progress",
  NEXT_STEP_COMPLETE_QA: "Next step: complete QA for this batch",
  NEXT_STEP_COMPLETE_QA_NO_QTY: "Production is approved — complete QA for eligible batches.",

  QUALITY_QUEUE: "Quality Queue",
  PENDING_QC: "Pending QC",
  REWORK_PENDING_QA: "Rework Pending",
  REWORK_SUPERVISOR: "Supervisor Rework Approval",
  HOLD_DECISION: "Hold Decision",
  CUSTOMER_RETURN_INSPECTION: "Customer Return Inspection",
  PRODUCTION_QA_QUEUE: "Quality Queue",
  QA_BATCHES_KPI: "Pending QC batches",
  QA_QTY_PENDING_KPI: "Pending QC qty",

  QA_BLOCKED_HOLD: "Hold decisions pending",
  QA_BLOCKED_REWORK_APPROVAL: "Supervisor rework approval pending",
  QA_BLOCKED_BATCHES: "Pending QC in progress",
  QA_BLOCKED_RECHECK: "Rework pending QA review",

  REWORK_APPROVAL_SECTION: "Supervisor Rework Approval",
  REWORK_APPROVAL_PENDING: "Supervisor rework approval pending",
  APPROVE_REWORK: "Approve rework",
  SEND_FOR_REWORK: "Send for rework",
  REWORK_PENDING_QA_REVIEW: "Rework pending QA review",
  PRODUCTION_PENDING_EXECUTION: "Rework approved — pending production execution",
  SUPERVISOR_ONLY_LEGACY: "Production approval only",

  CLEARED_QA_SUBTITLE:
    "All batches on this line have cleared QA. Review entries in the Quality Inspection Workspace or return to the sales order.",
  HANDOFF_BANNER:
    "Quality checks are part of the production workflow. Complete accept/reject/hold/rework on the Quality Inspection Workspace.",
} as const;

/** User-facing label for process stage key QC_PENDING (enum unchanged). */
export function processStageLabelForKey(key: string | null | undefined): string | null {
  if (key === "QC_PENDING") return PRODUCTION_QA_TERMS.QA_IN_PROGRESS;
  return null;
}

/** Map legacy action labels to embedded QA copy. */
export function normalizeProductionQaActionLabel(label: string | null | undefined): string {
  const t = String(label ?? "").trim();
  if (t === "Go to QC" || t === "Open QC") return PRODUCTION_QA_TERMS.COMPLETE_QA;
  if (t === "Continue QC") return PRODUCTION_QA_TERMS.CONTINUE_QA;
  if (t === "Open QC Workspace") return PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA;
  if (t === "QC workspace" || t === "QC") return PRODUCTION_QA_TERMS.WORKSPACE_NAV;
  return t;
}
