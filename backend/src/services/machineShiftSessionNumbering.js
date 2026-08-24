/**
 * Human-readable shift session numbers: SS-YY-####
 * Uses existing session rows (no DocType / DocSequence schema change).
 */

const { formatDocNo, year2FromDate } = require("./docNoService");
const { domainError } = require("./machineShiftSessionErrors");

const SHIFT_SESSION_PREFIX = "SS";
const MAX_ALLOCATE_ATTEMPTS = 5;

/**
 * @param {import('@prisma/client').PrismaClient} tx
 * @param {{ date?: Date }} [input]
 * @returns {Promise<string>}
 */
async function peekNextShiftSessionNo(tx, { date } = {}) {
  const y2 = year2FromDate(date ?? new Date());
  const prefix = `${SHIFT_SESSION_PREFIX}-${String(y2).padStart(2, "0")}-`;
  const latest = await tx.machineShiftSession.findFirst({
    where: { shiftSessionNo: { startsWith: prefix } },
    orderBy: { shiftSessionNo: "desc" },
    select: { shiftSessionNo: true },
  });
  let next = 1;
  if (latest?.shiftSessionNo) {
    const m = String(latest.shiftSessionNo).match(/SS-(\d{2})-(\d+)$/i);
    if (m) next = Number(m[2]) + 1;
  }
  if (!Number.isFinite(next) || next < 1) next = 1;
  return formatDocNo(SHIFT_SESSION_PREFIX, y2, next);
}

/**
 * Allocate a candidate shiftSessionNo. Caller must create the session and retry on unique conflict.
 * @param {import('@prisma/client').PrismaClient} tx
 * @param {{ date?: Date, attemptOffset?: number }} [input]
 */
async function allocateShiftSessionNo(tx, { date, attemptOffset = 0 } = {}) {
  const base = await peekNextShiftSessionNo(tx, { date });
  if (!attemptOffset) return base;
  const m = String(base).match(/SS-(\d{2})-(\d+)$/i);
  if (!m) {
    throw domainError(500, "SHIFT_SESSION_NO_INVALID", "Could not build a shift session number.");
  }
  return formatDocNo(SHIFT_SESSION_PREFIX, Number(m[1]), Number(m[2]) + attemptOffset);
}

module.exports = {
  SHIFT_SESSION_PREFIX,
  MAX_ALLOCATE_ATTEMPTS,
  peekNextShiftSessionNo,
  allocateShiftSessionNo,
};
