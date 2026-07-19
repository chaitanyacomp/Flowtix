/**
 * Canonical Production Workspace eligibility: whether a WO line may accept a new production entry.
 *
 * Active Production must use this assessment — never plannedQty − producedQty alone.
 * Production Entry Pending QC is independent of WO execution: a partial entry may be Pending QC
 * while the WO remains In Progress / Paused with remaining quantity.
 */

const EPS = 1e-6;

const TERMINAL_WO_STATUSES = new Set([
  "CANCELLED",
  "REJECTED",
  "CLOSED",
  "COMPLETED",
  "CLOSED_WITH_SHORTFALL",
  "MANUALLY_CLOSED",
  "CLOSED_WITH_WAIVER",
]);

const PAUSED_NEXT_ACTIONS = new Set(["PRODUCTION_EXECUTION_BLOCKED", "PRODUCTION_PAUSED"]);

const NON_PRODUCTION_NEXT_ACTIONS = new Set([
  "QC_PENDING",
  "PRODUCTION_SHORTFALL_DECISION",
  "DISPATCH_PENDING",
  "SALES_BILL_PENDING",
  "NEXT_RS_REQUIRED",
  "ON_HOLD",
  "PRODUCTION_EXECUTION_BLOCKED",
  "PRODUCTION_PAUSED",
]);

/** Minimal queue-row shape for eligibility (avoids circular imports with dashboardProductionStatus). */
export type ProductionEligibilitySource = {
  workOrderId: number;
  status?: string | null;
  productionExecutionStatus?: string | null;
  nextAction?: string | null;
  hasPendingQc?: boolean | null;
  producedQty?: number | null;
  balanceQty?: number | null;
  rmReadinessGate?: string | null;
  rmReadyForProduction?: boolean | null;
  rmProductionAllowedNowQty?: number | null;
  /**
   * Backend canonical flag when present.
   * When omitted, this module derives the same rule from execution/nextAction fields.
   */
  canAcceptProductionEntry?: boolean | null;
  /** Set by caller when a later NO_QTY WO/cycle absorbed this line's shortfall. */
  absorbedByLaterWo?: boolean | null;
  productionBlockReason?: string | null;
  productionBlockReasonLabel?: string | null;
  productionBlockRemarks?: string | null;
  holdReason?: string | null;
  pausedAt?: string | null;
};

export type ProductionEntryEligibilityReason =
  | "READY_OR_IN_PROGRESS"
  | "EXECUTION_COMPLETED"
  | "EXECUTION_PAUSED"
  | "SHORTFALL_DECISION_PENDING"
  | "PENDING_QA_ONLY"
  | "CARRIED_FORWARD"
  | "TERMINAL_WO_STATUS"
  | "NON_PRODUCTION_NEXT_ACTION"
  | "NO_OPEN_PRODUCTION_CAPACITY"
  | "SERVER_FLAG_FALSE";

export type ProductionEntryEligibility = {
  /** True only when Active Production may list this line and Open may enter editable production. */
  canAcceptNewProductionEntry: boolean;
  /** Production execution is terminal for further entries (report finalized / closed path). */
  terminalForProduction: boolean;
  /** Resumable pause (WO PAUSED or execution BLOCKED) with remaining work. */
  isPausedProduction: boolean;
  /**
   * Entry-level QC awaits QA, and the WO has no further producible capacity
   * (or execution is already finalized). Does not mean the WO is "in QC".
   */
  isPendingQaOnly: boolean;
  reason: ProductionEntryEligibilityReason;
};

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function hasQueueRmReadinessFields(row: ProductionEligibilitySource): boolean {
  if (row.rmReadyForProduction != null) return true;
  return Boolean(String(row.rmReadinessGate ?? "").trim());
}

function isQueueRmGateBlocked(row: ProductionEligibilitySource): boolean {
  if (row.rmReadyForProduction === true) return false;
  if (row.rmReadyForProduction === false) return true;
  const gate = upper(row.rmReadinessGate);
  if (!gate) return false;
  return gate !== "READY_FOR_PRODUCTION";
}

function isReadyToStart(row: ProductionEligibilitySource): boolean {
  const next = upper(row.nextAction);
  const exec = upper(row.productionExecutionStatus);
  if (next !== "PRODUCTION_PENDING") return false;
  if (exec === "BLOCKED" || exec === "SHORTFALL_PENDING" || exec === "COMPLETED") return false;
  if (n(row.producedQty) > EPS) return false;
  if (hasQueueRmReadinessFields(row)) {
    return !isQueueRmGateBlocked(row) && n(row.rmProductionAllowedNowQty) > EPS;
  }
  return true;
}

function isInProgress(row: ProductionEligibilitySource): boolean {
  const exec = upper(row.productionExecutionStatus);
  const next = upper(row.nextAction);
  if (exec === "COMPLETED" || exec === "BLOCKED" || exec === "SHORTFALL_PENDING") return false;
  if (
    next === "QC_PENDING" ||
    next === "PRODUCTION_SHORTFALL_DECISION" ||
    next === "NEXT_RS_REQUIRED" ||
    next === "DISPATCH_PENDING" ||
    next === "SALES_BILL_PENDING" ||
    next === "ON_HOLD" ||
    next === "PRODUCTION_PAUSED" ||
    next === "PRODUCTION_EXECUTION_BLOCKED"
  ) {
    return false;
  }
  if (exec === "RUNNING") return true;
  const produced = n(row.producedQty);
  if (produced > EPS) {
    const remaining = Math.max(0, n(row.balanceQty));
    return remaining > EPS || next === "PRODUCTION_PENDING";
  }
  return false;
}

export function isPausedProductionRow(row: ProductionEligibilitySource): boolean {
  const woStatus = upper(row.status);
  const exec = upper(row.productionExecutionStatus);
  const next = upper(row.nextAction);
  if (woStatus === "PAUSED") return true;
  if (exec === "BLOCKED") return true;
  if (PAUSED_NEXT_ACTIONS.has(next)) return true;
  return false;
}

/**
 * Pending QA workspace bucket: entry QC remains and the WO is not currently
 * accepting / paused for further production (execution final or no remaining capacity).
 */
export function isPendingQaOnlyRow(row: ProductionEligibilitySource): boolean {
  if (!row.hasPendingQc && upper(row.nextAction) !== "QC_PENDING") return false;
  if (isPausedProductionRow(row)) return false;
  const exec = upper(row.productionExecutionStatus);
  const balance = Math.max(0, n(row.balanceQty));
  if (exec === "COMPLETED") return true;
  if (upper(row.nextAction) === "QC_PENDING") return true;
  return balance <= EPS;
}

/**
 * Single assessment for Active Production, Open guards, and workspace counters that
 * must agree on “can this WO accept another production entry?”.
 */
export function assessProductionEntryEligibility(row: ProductionEligibilitySource): ProductionEntryEligibility {
  const woStatus = upper(row.status);
  const exec = upper(row.productionExecutionStatus);
  const next = upper(row.nextAction);
  const paused = isPausedProductionRow(row);
  const pendingQaOnly = isPendingQaOnlyRow(row);

  if (row.canAcceptProductionEntry === false && !paused) {
    // Server may set false for QC-only or terminal; re-evaluate pause separately.
    if (pendingQaOnly) {
      return {
        canAcceptNewProductionEntry: false,
        terminalForProduction: true,
        isPausedProduction: false,
        isPendingQaOnly: true,
        reason: "PENDING_QA_ONLY",
      };
    }
  }

  if (TERMINAL_WO_STATUSES.has(woStatus)) {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: true,
      isPausedProduction: false,
      isPendingQaOnly: pendingQaOnly,
      reason: "TERMINAL_WO_STATUS",
    };
  }

  if (paused) {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: false,
      isPausedProduction: true,
      isPendingQaOnly: false,
      reason: "EXECUTION_PAUSED",
    };
  }

  if (exec === "COMPLETED") {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: true,
      isPausedProduction: false,
      isPendingQaOnly: pendingQaOnly,
      reason: "EXECUTION_COMPLETED",
    };
  }

  if (exec === "SHORTFALL_PENDING" || next === "PRODUCTION_SHORTFALL_DECISION") {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: true,
      isPausedProduction: false,
      isPendingQaOnly: false,
      reason: "SHORTFALL_DECISION_PENDING",
    };
  }

  // Entry QC alone must not remove Active Production when remaining capacity exists.
  if (next === "QC_PENDING" || (row.hasPendingQc && Math.max(0, n(row.balanceQty)) <= EPS)) {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: exec === "COMPLETED" || Math.max(0, n(row.balanceQty)) <= EPS,
      isPausedProduction: false,
      isPendingQaOnly: true,
      reason: "PENDING_QA_ONLY",
    };
  }

  if (NON_PRODUCTION_NEXT_ACTIONS.has(next) && next !== "QC_PENDING") {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: true,
      isPausedProduction: false,
      isPendingQaOnly: false,
      reason: "NON_PRODUCTION_NEXT_ACTION",
    };
  }

  if (row.absorbedByLaterWo) {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: true,
      isPausedProduction: false,
      isPendingQaOnly: false,
      reason: "CARRIED_FORWARD",
    };
  }

  if (row.canAcceptProductionEntry === true) {
    return {
      canAcceptNewProductionEntry: true,
      terminalForProduction: false,
      isPausedProduction: false,
      isPendingQaOnly: false,
      reason: "READY_OR_IN_PROGRESS",
    };
  }

  if (row.canAcceptProductionEntry === false) {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: true,
      isPausedProduction: false,
      isPendingQaOnly: pendingQaOnly,
      reason: "SERVER_FLAG_FALSE",
    };
  }

  const ready = isReadyToStart(row);
  const inProgress = isInProgress(row);
  if (!ready && !inProgress) {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: false,
      isPausedProduction: false,
      isPendingQaOnly: pendingQaOnly,
      reason: "NO_OPEN_PRODUCTION_CAPACITY",
    };
  }

  const balance = Math.max(0, n(row.balanceQty));
  if (!ready && inProgress && balance <= EPS && exec !== "RUNNING") {
    return {
      canAcceptNewProductionEntry: false,
      terminalForProduction: false,
      isPausedProduction: false,
      isPendingQaOnly: pendingQaOnly,
      reason: "NO_OPEN_PRODUCTION_CAPACITY",
    };
  }

  return {
    canAcceptNewProductionEntry: true,
    terminalForProduction: false,
    isPausedProduction: false,
    isPendingQaOnly: false,
    reason: "READY_OR_IN_PROGRESS",
  };
}

export function canAcceptNewProductionEntry(row: ProductionEligibilitySource): boolean {
  return assessProductionEntryEligibility(row).canAcceptNewProductionEntry;
}

/** True when Open must not navigate into editable production for this row. */
export function isProductionOpenLocked(row: ProductionEligibilitySource): boolean {
  return !canAcceptNewProductionEntry(row);
}
