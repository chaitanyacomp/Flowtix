/**
 * Production-embedded QA presentation (Phase 1).
 * Labels and navigation copy only — internal keys (QC_PENDING, /qc-entry) unchanged.
 */

export const PRODUCTION_QA_TERMS = {
  WORKSPACE_TITLE: "Production QA",
  WORKSPACE_NAV: "Production QA",
  REPORT_BACK: "Back to Production QA",
  DESK_TITLE: "Production desk",
  DESK_SUBTITLE: "Shop floor · production · embedded QA",
  QA_OPERATOR_DESK_TITLE: "Production QA desk",
  QA_OPERATOR_DESK_SUBTITLE: "Inspection · rework · disposition (production workflow)",

  COMPLETE_QA: "Complete QA",
  OPEN_PRODUCTION_QA: "Open Production QA",
  CONTINUE_QA: "Continue QA",
  VIEW_QA_ENTRIES: "View QA entries",

  QA_IN_PROGRESS: "QA in progress",
  QA_IN_PROGRESS_LABEL: "QA in progress",
  AWAITING_QA: "Awaiting QA",
  WAITING_FOR_QA: "Waiting for QA",
  QA_PENDING_STRIP: "QA in progress",
  NEXT_STEP_COMPLETE_QA: "Next step: complete QA for this batch",
  NEXT_STEP_COMPLETE_QA_NO_QTY: "Production is approved — complete QA for eligible batches.",

  PRODUCTION_QA_QUEUE: "Production QA queue",
  QA_BATCHES_KPI: "QA batches",
  QA_QTY_PENDING_KPI: "QA qty pending",

  QA_BLOCKED_HOLD: "Production QA — hold decisions pending",
  QA_BLOCKED_REWORK_APPROVAL: "Production QA — rework approval pending",
  QA_BLOCKED_BATCHES: "Production QA in progress",
  QA_BLOCKED_RECHECK: "Rework pending QA review",

  REWORK_APPROVAL_SECTION: "Rework approval (production)",
  REWORK_APPROVAL_PENDING: "Rework approval pending",
  APPROVE_REWORK: "Approve rework",
  SEND_FOR_REWORK: "Send for rework",
  REWORK_PENDING_QA_REVIEW: "Rework pending QA review",
  PRODUCTION_PENDING_EXECUTION: "Rework approved — pending production execution",
  SUPERVISOR_ONLY_LEGACY: "Production approval only",

  CLEARED_QA_SUBTITLE:
    "All batches on this line have cleared QA. Review entries in Production QA or return to the sales order.",
  HANDOFF_BANNER:
    "Quality checks are part of the production workflow. Complete accept/reject/hold/rework on the Production QA workspace.",
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
