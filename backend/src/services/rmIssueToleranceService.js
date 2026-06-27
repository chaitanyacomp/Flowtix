/**
 * Controlled RM over-issue tolerance for Store material issue (P15-C3).
 * Physical issue may exceed PMR pending within max(minKg, percent × pending).
 */

const { STOCK_EPS } = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");

const DEFAULT_MIN_KG = 0.5;
const DEFAULT_PERCENT = 0.05;

function n(v) {
  return qtyToNumber(v);
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function readToleranceMinKg() {
  const raw = process.env.RM_ISSUE_TOLERANCE_MIN_KG;
  if (raw == null || raw === "") return DEFAULT_MIN_KG;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_KG;
}

function readTolerancePercent() {
  const raw = process.env.RM_ISSUE_TOLERANCE_PERCENT;
  if (raw == null || raw === "") return DEFAULT_PERCENT;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_PERCENT;
}

/** Tolerance band: max(minKg, percent × pending). */
function computeRmIssueToleranceQty(pendingQty) {
  const pending = round3(Math.max(0, n(pendingQty)));
  if (pending <= STOCK_EPS) return 0;
  return round3(Math.max(readToleranceMinKg(), pending * readTolerancePercent()));
}

/** Maximum issue qty allowed for a PMR line pending balance. */
function computeMaxAllowedRmIssueQty(pendingQty, woStillRequiredQty = null) {
  const pending = round3(Math.max(0, n(pendingQty)));
  const maxFromPmr = round3(pending + computeRmIssueToleranceQty(pending));
  if (woStillRequiredQty == null) return maxFromPmr;
  const woPending = round3(Math.max(0, n(woStillRequiredQty)));
  const maxFromWo = round3(woPending + computeRmIssueToleranceQty(woPending));
  return round3(Math.min(maxFromPmr, maxFromWo));
}

/**
 * @returns {{
 *   allowed: boolean,
 *   withinTolerance: boolean,
 *   overIssueQty: number,
 *   maxAllowedQty: number,
 *   toleranceQty: number,
 *   pendingQty: number,
 * }}
 */
function assessRmIssueQty(issueQty, pendingQty, { woStillRequiredQty = null } = {}) {
  const qty = round3(n(issueQty));
  const pending = round3(Math.max(0, n(pendingQty)));
  const toleranceQty = computeRmIssueToleranceQty(pending);
  const maxAllowedQty = computeMaxAllowedRmIssueQty(pending, woStillRequiredQty);

  if (qty <= STOCK_EPS) {
    return {
      allowed: false,
      withinTolerance: false,
      overIssueQty: 0,
      maxAllowedQty,
      toleranceQty,
      pendingQty: pending,
    };
  }
  if (qty <= pending + STOCK_EPS) {
    return {
      allowed: true,
      withinTolerance: false,
      overIssueQty: 0,
      maxAllowedQty,
      toleranceQty,
      pendingQty: pending,
    };
  }

  const overIssueQty = round3(qty - pending);
  if (qty > maxAllowedQty + STOCK_EPS) {
    return {
      allowed: false,
      withinTolerance: false,
      overIssueQty,
      maxAllowedQty,
      toleranceQty,
      pendingQty: pending,
    };
  }

  return {
    allowed: true,
    withinTolerance: true,
    overIssueQty,
    maxAllowedQty,
    toleranceQty,
    pendingQty: pending,
  };
}

module.exports = {
  DEFAULT_MIN_KG,
  DEFAULT_PERCENT,
  readToleranceMinKg,
  readTolerancePercent,
  computeRmIssueToleranceQty,
  computeMaxAllowedRmIssueQty,
  assessRmIssueQty,
};
