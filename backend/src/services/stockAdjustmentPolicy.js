/**
 * Normalized stock adjustment policy + enforcement helpers (server is source of truth).
 *
 * Timezone note:
 * - `SAME_DAY` compares calendar date using the **JavaScript runtime’s local timezone**
 *   (`Date#getFullYear` / `getMonth` / `getDate`), i.e. the Node process default (often driven by
 *   the `TZ` environment variable or the host OS). Set `TZ` explicitly on the server if you need
 *   a fixed business timezone.
 * - `HOURS` and `DAYS` compare **elapsed milliseconds** between `original.date` and “now”; they do
 *   not re-interpret wall-clock in a separate zone—only the instant difference matters.
 */

const REVERSE_ROLES = {
  ADMIN_ONLY: "ADMIN_ONLY",
  ADMIN_AND_STORE: "ADMIN_AND_STORE",
};

const CREATE_ROLES = {
  ADMIN_ONLY: "ADMIN_ONLY",
  ADMIN_AND_STORE: "ADMIN_AND_STORE",
};

const WINDOW = {
  SAME_DAY: "SAME_DAY",
  HOURS: "HOURS",
  DAYS: "DAYS",
  NO_LIMIT: "NO_LIMIT",
};

const MSG = {
  reverseRole: "You are not allowed to reverse stock adjustments.",
  createRole: "You are not allowed to post stock adjustments.",
  sameDay: "Reversal allowed only on the same day.",
  hours: "Reversal not allowed after configured time limit.",
  days: "Reversal not allowed after configured day limit.",
};

/**
 * @param {unknown} v
 * @returns {keyof REVERSE_ROLES}
 */
function normalizeReverseRoles(v) {
  return v === REVERSE_ROLES.ADMIN_AND_STORE ? REVERSE_ROLES.ADMIN_AND_STORE : REVERSE_ROLES.ADMIN_ONLY;
}

/**
 * @param {unknown} v
 * @returns {keyof CREATE_ROLES}
 */
function normalizeCreateRoles(v) {
  return v === CREATE_ROLES.ADMIN_ONLY ? CREATE_ROLES.ADMIN_ONLY : CREATE_ROLES.ADMIN_AND_STORE;
}

/**
 * @param {unknown} v
 * @returns {keyof WINDOW}
 */
function normalizeWindowType(v) {
  if (v === WINDOW.SAME_DAY || v === WINDOW.HOURS || v === WINDOW.DAYS || v === WINDOW.NO_LIMIT) return v;
  return WINDOW.HOURS;
}

/**
 * @param {import('@prisma/client').AppSetting | null | undefined} row
 */
function normalizeStockAdjustmentPolicy(row) {
  const n = Number(row?.stockAdjustmentReverseWindowValue);
  const windowValue = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 24;
  return {
    stockAdjustmentReverseRoles: normalizeReverseRoles(row?.stockAdjustmentReverseRoles),
    stockAdjustmentReverseWindowType: normalizeWindowType(row?.stockAdjustmentReverseWindowType),
    stockAdjustmentReverseWindowValue: windowValue,
    stockAdjustmentCreateRoles: normalizeCreateRoles(row?.stockAdjustmentCreateRoles),
  };
}

/** Same calendar day in the process local timezone (see module header for `TZ`). */
function sameLocalCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * @param {string} role
 * @param {{ stockAdjustmentCreateRoles: string }} policy
 */
function assertUserCanCreateStockAdjustment(role, policy) {
  if (policy.stockAdjustmentCreateRoles === CREATE_ROLES.ADMIN_AND_STORE) {
    if (role === "ADMIN" || role === "STORE") return;
  } else {
    if (role === "ADMIN") return;
  }
  const err = new Error(MSG.createRole);
  err.statusCode = 403;
  throw err;
}

/**
 * @param {string} role
 * @param {{ stockAdjustmentReverseRoles: string }} policy
 */
function assertUserCanReverseStockAdjustment(role, policy) {
  if (policy.stockAdjustmentReverseRoles === REVERSE_ROLES.ADMIN_AND_STORE) {
    if (role === "ADMIN" || role === "STORE") return;
  } else {
    if (role === "ADMIN") return;
  }
  const err = new Error(MSG.reverseRole);
  err.statusCode = 403;
  throw err;
}

/**
 * @param {Date | string} originalDate
 * @param {Date} now
 * @param {ReturnType<typeof normalizeStockAdjustmentPolicy>} policy
 */
function assertReverseWithinPolicyWindow(originalDate, now, policy) {
  const type = policy.stockAdjustmentReverseWindowType;
  if (type === WINDOW.NO_LIMIT) return;

  const orig = originalDate instanceof Date ? originalDate : new Date(originalDate);
  const n = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(orig.getTime())) {
    const err = new Error("Invalid adjustment date");
    err.statusCode = 400;
    throw err;
  }

  if (type === WINDOW.SAME_DAY) {
    if (!sameLocalCalendarDay(orig, n)) {
      const err = new Error(MSG.sameDay);
      err.statusCode = 400;
      throw err;
    }
    return;
  }

  const hours = policy.stockAdjustmentReverseWindowValue;
  if (type === WINDOW.HOURS) {
    const msLimit = hours * 3600 * 1000;
    if (n.getTime() - orig.getTime() > msLimit) {
      const err = new Error(MSG.hours);
      err.statusCode = 400;
      throw err;
    }
    return;
  }

  if (type === WINDOW.DAYS) {
    const msLimit = hours * 24 * 3600 * 1000;
    if (n.getTime() - orig.getTime() > msLimit) {
      const err = new Error(MSG.days);
      err.statusCode = 400;
      throw err;
    }
  }
}

module.exports = {
  REVERSE_ROLES,
  CREATE_ROLES,
  WINDOW,
  MSG,
  normalizeStockAdjustmentPolicy,
  assertUserCanCreateStockAdjustment,
  assertUserCanReverseStockAdjustment,
  assertReverseWithinPolicyWindow,
  sameLocalCalendarDay,
};
