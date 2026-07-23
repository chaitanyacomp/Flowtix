/**
 * Backend-authoritative Live Factory Status snapshot.
 * Single classifier for Control Tower panel, Store Production Monitor counts,
 * and any consumer of getProductionQueueRows().
 *
 * Presentation / classification only — does not change production, RM, QC, or recovery transactions.
 */

const EPS = 1e-6;

/** @typedef {'READY_TO_START'|'RUNNING'|'PAUSED'|'BLOCKED'|'AWAITING_REPORT'|'PENDING_QC'|'COMPLETED'} LiveFactoryBucket */

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function upper(v) {
  return String(v ?? "").trim().toUpperCase();
}

function isRmGateBlocked(row) {
  if (row.rmReadyForProduction === true) return false;
  if (row.rmReadyForProduction === false) return true;
  const gate = upper(row.rmReadinessGate);
  if (!gate) return false;
  return gate !== "READY_FOR_PRODUCTION" && gate !== "READY" && gate !== "OK";
}

/**
 * Canonical bucket for one production-queue line.
 * Ready ≠ Running ≠ Blocked. Pending QC on another batch does not block remaining capacity.
 *
 * @param {object} row — getProductionQueueRows() element
 * @returns {LiveFactoryBucket}
 */
function classifyLiveFactoryBucket(row) {
  if (!row || typeof row !== "object") return "BLOCKED";

  const workState = upper(row.productionWorkState);
  const next = upper(row.nextAction);
  const exec = upper(row.productionExecutionStatus);
  const woStatus = upper(row.status);
  const produced = n(row.producedQty);
  const balance = Math.max(0, n(row.balanceQty));
  const canAccept =
    row.canAcceptProductionEntry == null ? null : Boolean(row.canAcceptProductionEntry);

  if (woStatus === "COMPLETED" || woStatus === "CLOSED" || exec === "COMPLETED") {
    if (balance <= EPS && produced > EPS) return "COMPLETED";
  }

  if (
    workState === "PAUSED_PRODUCTION" ||
    next === "PRODUCTION_PAUSED" ||
    next === "ON_HOLD" ||
    woStatus === "PAUSED" ||
    woStatus === "HOLD"
  ) {
    return "PAUSED";
  }

  if (next === "PRODUCTION_SHORTFALL_DECISION" || exec === "SHORTFALL_PENDING") {
    return "AWAITING_REPORT";
  }

  // Blocking draft is not Ready — Review & Finalize first.
  if (workState === "DRAFT_PENDING" || next === "PRODUCTION_DRAFT_REVIEW" || row.hasOpenDraft) {
    return "BLOCKED";
  }

  // Pending QC only when no further executable capacity.
  if (
    (next === "QC_PENDING" || (row.hasPendingQc && balance <= EPS)) &&
    (canAccept === false || balance <= EPS)
  ) {
    return "PENDING_QC";
  }

  if (canAccept === true || workState === "READY_TO_START" || workState === "CONTINUE_PRODUCTION") {
    if (workState === "CONTINUE_PRODUCTION" || (produced > EPS && balance > EPS)) {
      if (isRmGateBlocked(row) && produced <= EPS) return "BLOCKED";
      return produced > EPS ? "RUNNING" : "READY_TO_START";
    }
    if (workState === "READY_TO_START" || (produced <= EPS && next === "PRODUCTION_PENDING")) {
      if (isRmGateBlocked(row)) return "BLOCKED";
      return "READY_TO_START";
    }
  }

  if (canAccept === false) {
    if (isRmGateBlocked(row) && produced <= EPS) return "BLOCKED";
    if (next === "NEXT_RS_REQUIRED") return "BLOCKED";
    if (produced > EPS && balance <= EPS && row.hasPendingQc) return "PENDING_QC";
    if (next === "PRODUCTION_SHORTFALL_DECISION") return "AWAITING_REPORT";
    return "BLOCKED";
  }

  if (produced > EPS && balance > EPS) return "RUNNING";
  if (produced <= EPS && next === "PRODUCTION_PENDING") {
    return isRmGateBlocked(row) ? "BLOCKED" : "READY_TO_START";
  }

  return "BLOCKED";
}

/**
 * One primary line per work order (highest remaining).
 * @param {object[]} rows
 */
function primaryRowPerWorkOrder(rows) {
  /** @type {Map<number, object>} */
  const byWo = new Map();
  for (const row of rows || []) {
    const woId = Number(row.workOrderId);
    if (!(woId > 0)) continue;
    const cur = byWo.get(woId);
    if (!cur) {
      byWo.set(woId, row);
      continue;
    }
    const rem = Math.max(0, n(row.balanceQty));
    const curRem = Math.max(0, n(cur.balanceQty));
    if (rem > curRem) byWo.set(woId, row);
  }
  return [...byWo.values()];
}

/**
 * @param {object[]} productionQueueRows
 */
function buildLiveFactorySnapshot(productionQueueRows) {
  const primaries = primaryRowPerWorkOrder(productionQueueRows || []);
  const enriched = primaries.map((row) => ({
    ...row,
    liveFactoryBucket: classifyLiveFactoryBucket(row),
  }));

  const counts = {
    readyToStart: 0,
    running: 0,
    paused: 0,
    blocked: 0,
    awaitingReport: 0,
    pendingQc: 0,
    activeWorkOrders: 0,
  };

  for (const row of enriched) {
    const b = row.liveFactoryBucket;
    if (b === "COMPLETED") continue;
    counts.activeWorkOrders += 1;
    if (b === "READY_TO_START") counts.readyToStart += 1;
    else if (b === "RUNNING") counts.running += 1;
    else if (b === "PAUSED") counts.paused += 1;
    else if (b === "BLOCKED") counts.blocked += 1;
    else if (b === "AWAITING_REPORT") counts.awaitingReport += 1;
    else if (b === "PENDING_QC") counts.pendingQc += 1;
  }

  return { counts, rows: enriched };
}

/** @type {ReadonlyArray<LiveFactoryBucket>} */
const HIGHLIGHT_PRIORITY = Object.freeze([
  "RUNNING",
  "PAUSED",
  "BLOCKED",
  "AWAITING_REPORT",
  "READY_TO_START",
]);

/**
 * @param {ReturnType<typeof buildLiveFactorySnapshot>['rows']} rows
 * @param {number} [limit=5]
 */
function pickLiveFactoryHighlights(rows, limit = 5) {
  const max = Math.min(5, Math.max(3, Number(limit) || 5));
  const ranked = [...(rows || [])]
    .filter((r) => r.liveFactoryBucket && r.liveFactoryBucket !== "COMPLETED")
    .sort((a, b) => {
      const pa = HIGHLIGHT_PRIORITY.indexOf(a.liveFactoryBucket);
      const pb = HIGHLIGHT_PRIORITY.indexOf(b.liveFactoryBucket);
      const ra = pa < 0 ? 99 : pa;
      const rb = pb < 0 ? 99 : pb;
      if (ra !== rb) return ra - rb;
      return Number(b.workOrderId) - Number(a.workOrderId);
    });
  return ranked.slice(0, max);
}

/**
 * True RM shortage row for Critical Exceptions — never READY_TO_RELEASE / Ready WOs.
 * @param {object} row — getRmRiskRows() element
 */
function isAuthoritativeRmShortageRiskRow(row) {
  if (!row || typeof row !== "object") return false;
  const queueType = upper(row.queueType);
  if (queueType === "READY_TO_RELEASE_WO") return false;
  const shortage = n(row.shortageAfterReservationQty ?? row.shortageQty);
  if (shortage <= EPS) return false;
  const status = upper(row.status);
  return status === "CRITICAL" || shortage > EPS;
}

module.exports = {
  EPS,
  classifyLiveFactoryBucket,
  buildLiveFactorySnapshot,
  pickLiveFactoryHighlights,
  isAuthoritativeRmShortageRiskRow,
  HIGHLIGHT_PRIORITY,
};
