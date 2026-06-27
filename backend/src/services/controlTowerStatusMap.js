/**
 * Control Tower normalized currentStatus vocabulary (Prompt 3).
 * Collapses mixed dashboard queue aliases into one stable enum.
 */

const CONTROL_TOWER_STATUSES = Object.freeze({
  PLANNING_PENDING: "PLANNING_PENDING",
  WO_PLANNING_PENDING: "WO_PLANNING_PENDING",
  WAITING_RM: "WAITING_RM",
  PROCUREMENT_IN_PROGRESS: "PROCUREMENT_IN_PROGRESS",
  RM_READY_FOR_ISSUE: "RM_READY_FOR_ISSUE",
  WO_RELEASE_READY: "WO_RELEASE_READY",

  PRODUCTION_PENDING: "PRODUCTION_PENDING",
  PRODUCTION_ON_HOLD: "PRODUCTION_ON_HOLD",
  QA_PENDING: "QA_PENDING",
  QA_REWORK_PENDING: "QA_REWORK_PENDING",
  DISPATCH_PENDING: "DISPATCH_PENDING",
  DISPATCH_DRAFT_PENDING: "DISPATCH_DRAFT_PENDING",

  BILLING_PENDING: "BILLING_PENDING",
  EXPORT_PENDING: "EXPORT_PENDING",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  NEXT_RS_READY: "NEXT_RS_READY",

  COMPLETED: "COMPLETED",
  CLOSED: "CLOSED",
  UNKNOWN: "UNKNOWN",
});

const PROCUREMENT_QUEUE_TYPES = new Set([
  "WAITING_PURCHASE_ACTION",
  "PROCUREMENT_PENDING",
  "PROCUREMENT_IN_PROGRESS",
  "PO_WAITING_GRN",
  "SHORTAGE_COVERED_BY_INCOMING",
  "WAITING_GRN",
  "PARTIAL_RM_RECEIVED",
  "APPROVAL_PENDING",
]);

const RM_READY_QUEUE_TYPES = new Set([
  "RM_READY_FOR_ISSUE",
  "STORE_ISSUE_PENDING",
  "PMR_WAITING_ISSUE",
]);

const WO_RELEASE_QUEUE_TYPES = new Set(["READY_TO_RELEASE_WO"]);

function normToken(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

/**
 * @param {{
 *   rowType?: string;
 *   sourceStatus?: string | null;
 *   sourceStageKey?: string | null;
 *   sourceQueueType?: string | null;
 *   sourceNextAction?: string | null;
 *   orderType?: string | null;
 * }} input
 * @returns {string} CONTROL_TOWER_STATUSES value
 */
function mapSourceToCurrentStatus(input = {}) {
  const rowType = normToken(input.rowType);
  const sourceStatus = normToken(input.sourceStatus);
  const sourceStageKey = normToken(input.sourceStageKey);
  const sourceQueueType = normToken(input.sourceQueueType);
  const sourceNextAction = normToken(input.sourceNextAction);

  if (sourceQueueType && RM_READY_QUEUE_TYPES.has(sourceQueueType)) {
    return CONTROL_TOWER_STATUSES.RM_READY_FOR_ISSUE;
  }
  if (sourceQueueType && WO_RELEASE_QUEUE_TYPES.has(sourceQueueType)) {
    return CONTROL_TOWER_STATUSES.WO_RELEASE_READY;
  }
  if (
    sourceQueueType &&
    (PROCUREMENT_QUEUE_TYPES.has(sourceQueueType) ||
      sourceQueueType.startsWith("PROCUREMENT"))
  ) {
    return CONTROL_TOWER_STATUSES.PROCUREMENT_IN_PROGRESS;
  }

  if (sourceStageKey === "QC") return CONTROL_TOWER_STATUSES.QA_PENDING;
  if (sourceStageKey === "DISPATCH") return CONTROL_TOWER_STATUSES.DISPATCH_PENDING;
  if (sourceStageKey === "SALES_BILL") return CONTROL_TOWER_STATUSES.BILLING_PENDING;
  if (sourceStageKey === "NEXT_RS") return CONTROL_TOWER_STATUSES.NEXT_RS_READY;
  if (sourceStageKey === "PRODUCTION") return CONTROL_TOWER_STATUSES.PRODUCTION_PENDING;

  if (sourceNextAction === "NEXT_RS_REQUIRED" || sourceStatus === "NEXT_RS_REQUIRED") {
    return CONTROL_TOWER_STATUSES.NEXT_RS_READY;
  }
  if (sourceNextAction === "ON_HOLD" || sourceStatus === "ON_HOLD") {
    return CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD;
  }
  if (
    sourceNextAction === "PRODUCTION_EXECUTION_BLOCKED" ||
    sourceStatus === "PRODUCTION_EXECUTION_BLOCKED"
  ) {
    return CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD;
  }
  if (
    sourceNextAction === "PRODUCTION_SHORTFALL_DECISION" ||
    sourceStatus === "PRODUCTION_SHORTFALL_DECISION"
  ) {
    return CONTROL_TOWER_STATUSES.PRODUCTION_ON_HOLD;
  }
  if (
    sourceNextAction === "QC_PENDING" ||
    sourceStatus === "QC_PENDING" ||
    sourceStatus === "PENDING_QC" ||
    sourceStatus === "PARTIAL_QC" ||
    sourceStatus === "QA_PENDING"
  ) {
    return CONTROL_TOWER_STATUSES.QA_PENDING;
  }
  if (sourceNextAction === "DISPATCH_PENDING" || sourceStatus === "DISPATCH_PENDING") {
    return CONTROL_TOWER_STATUSES.DISPATCH_PENDING;
  }
  if (sourceNextAction === "PRODUCTION_PENDING" || sourceStatus === "PRODUCTION_PENDING") {
    return CONTROL_TOWER_STATUSES.PRODUCTION_PENDING;
  }
  if (sourceStatus === "SALES_BILL_PENDING" || sourceNextAction === "SALES_BILL_PENDING") {
    return CONTROL_TOWER_STATUSES.BILLING_PENDING;
  }

  if (rowType === "RM_RISK") {
    if (sourceStatus === "CRITICAL" || sourceStatus === "LOW_BUFFER" || sourceStatus === "WAITING_RM") {
      return CONTROL_TOWER_STATUSES.WAITING_RM;
    }
    if (sourceStatus === "RM_LOW_BUFFER") {
      return CONTROL_TOWER_STATUSES.WAITING_RM;
    }
    return CONTROL_TOWER_STATUSES.WAITING_RM;
  }

  if (rowType === "DISPATCH_BACKLOG") {
    return CONTROL_TOWER_STATUSES.DISPATCH_PENDING;
  }

  if (rowType === "QA_QUEUE") {
    return CONTROL_TOWER_STATUSES.QA_PENDING;
  }

  if (rowType === "NO_QTY_PLANNING") {
    return CONTROL_TOWER_STATUSES.PLANNING_PENDING;
  }

  if (rowType === "WO_PLANNING") {
    return CONTROL_TOWER_STATUSES.WO_PLANNING_PENDING;
  }

  if (rowType === "QA_REWORK") {
    return CONTROL_TOWER_STATUSES.QA_REWORK_PENDING;
  }

  if (sourceStatus === "REWORK_READY_FOR_QC" || sourceNextAction === "REWORK_QC_PENDING") {
    return CONTROL_TOWER_STATUSES.QA_REWORK_PENDING;
  }

  return CONTROL_TOWER_STATUSES.UNKNOWN;
}

/**
 * Raw lineage fields for metadata (Prompt 3).
 * @param {object} raw
 * @param {{ sourceStatus?: string, sourceStageKey?: string, sourceQueueType?: string, sourceNextAction?: string }} picks
 */
function buildSourceLineageMetadata(raw, picks = {}) {
  const out = {};
  if (picks.sourceStatus != null && String(picks.sourceStatus).trim() !== "") {
    out.sourceStatus = String(picks.sourceStatus);
  } else if (raw?.status != null && String(raw.status).trim() !== "") {
    out.sourceStatus = String(raw.status);
  }
  if (picks.sourceStageKey != null && String(picks.sourceStageKey).trim() !== "") {
    out.sourceStageKey = String(picks.sourceStageKey);
  } else if (raw?.stageKey != null && String(raw.stageKey).trim() !== "") {
    out.sourceStageKey = String(raw.stageKey);
  }
  if (picks.sourceQueueType != null && String(picks.sourceQueueType).trim() !== "") {
    out.sourceQueueType = String(picks.sourceQueueType);
  } else if (raw?.queueType != null && String(raw.queueType).trim() !== "") {
    out.sourceQueueType = String(raw.queueType);
  }
  const nextAct =
    picks.sourceNextAction != null
      ? picks.sourceNextAction
      : raw?.nextAction != null
        ? raw.nextAction
        : raw?.nextStep != null
          ? raw.nextStep
          : null;
  if (nextAct != null && String(nextAct).trim() !== "") {
    out.sourceNextAction = String(nextAct);
  }
  return out;
}

module.exports = {
  CONTROL_TOWER_STATUSES,
  mapSourceToCurrentStatus,
  buildSourceLineageMetadata,
};
