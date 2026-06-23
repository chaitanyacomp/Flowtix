/**
 * Shared Monthly Planning period helpers — no imports from other planning modules.
 * Keeps leaf services (green level, RS suggestions, etc.) out of the
 * monthlyPlanningService ↔ plan-lifecycle circular dependency.
 */

const PERIOD_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

class MonthlyPlanningError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "MonthlyPlanningError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Validate a period key of the form YYYY-MM. Returns the normalized key or throws. */
function normalizePeriodKey(period) {
  const key = String(period ?? "").trim();
  if (!PERIOD_KEY_REGEX.test(key)) {
    throw new MonthlyPlanningError(
      "INVALID_PERIOD",
      "period must be in YYYY-MM format (e.g. 2026-06).",
      422,
    );
  }
  return key;
}

/** Current calendar month as YYYY-MM (local timezone, matches workspace UI). */
function getCurrentPeriodKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const PAST_PERIOD_PLANNING_MESSAGE =
  "Monthly planning for past periods is read-only. Contact Admin if correction is required.";

/** True when periodKey is strictly before the current calendar month. */
function isPastPlanningPeriod(periodKey, now = new Date()) {
  const key = normalizePeriodKey(periodKey);
  return key < getCurrentPeriodKey(now);
}

/** @deprecated Use isPastPlanningPeriod — kept for existing callers/tests. */
function isPastPeriod(periodKey, now = new Date()) {
  return isPastPlanningPeriod(periodKey, now);
}

/**
 * Enforce backdated-plan rules for write actions (create / edit / reopen).
 * Current and future months: allowed. Past months: STORE blocked; ADMIN needs confirmPastPeriod.
 */
function assertPeriodWriteAllowed({
  periodKey,
  actorRole = null,
  confirmPastPeriod = false,
  now = new Date(),
} = {}) {
  const key = normalizePeriodKey(periodKey);
  if (!isPastPlanningPeriod(key, now)) return key;

  const role = String(actorRole ?? "").trim().toUpperCase();
  if (role === "ADMIN") {
    if (confirmPastPeriod === true) return key;
    throw new MonthlyPlanningError(
      "PAST_PERIOD_CONFIRM_REQUIRED",
      `Period ${key} is in the past. Admin must confirm backdated planning (confirmPastPeriod: true).`,
      422,
    );
  }

  throw new MonthlyPlanningError("PAST_PERIOD_PLANNING_NOT_ALLOWED", PAST_PERIOD_PLANNING_MESSAGE, 403);
}

module.exports = {
  PERIOD_KEY_REGEX,
  MonthlyPlanningError,
  normalizePeriodKey,
  getCurrentPeriodKey,
  isPastPlanningPeriod,
  isPastPeriod,
  PAST_PERIOD_PLANNING_MESSAGE,
  assertPeriodWriteAllowed,
};
