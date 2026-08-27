/**
 * OPEN shift overdue guidance from Shift Master start/end times.
 * Does not close the session or production run.
 */

const { normalizeTimeOfDay, timeToMinutes, computeShiftDurations } = require("./shiftDuration");

const SHIFT_OVERDUE_MESSAGE = "Shift is overdue — Production Manager action required";

/** India has no DST; Shift Master times are wall-clock IST. */
const IST_OFFSET = "+05:30";

function nYmd(value) {
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value ?? "");
  return raw.length >= 10 ? raw.slice(0, 10) : null;
}

function addCalendarDay(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function istWallClockMs(ymd, hhmm) {
  const t = normalizeTimeOfDay(hhmm);
  if (!ymd || !t) return NaN;
  return Date.parse(`${ymd}T${t}:00${IST_OFFSET}`);
}

/**
 * @param {{
 *   status?: string | null;
 *   sessionDate?: string | Date | null;
 *   startTime?: string | null;
 *   endTime?: string | null;
 * }} input
 * @param {Date} [now]
 */
function evaluateOpenShiftOverdue(input = {}, now = new Date()) {
  const status = String(input.status ?? "").trim().toUpperCase();
  const empty = {
    overdue: false,
    isOvernight: false,
    expectedEndAt: null,
    message: null,
  };
  if (status !== "OPEN") return empty;

  const sessionDate = nYmd(input.sessionDate);
  let startTime;
  let endTime;
  let isOvernight = false;
  try {
    startTime = normalizeTimeOfDay(input.startTime);
    endTime = normalizeTimeOfDay(input.endTime);
    if (!startTime || !endTime || !sessionDate) return empty;
    const durations = computeShiftDurations(startTime, endTime, 0);
    isOvernight = Boolean(durations.isOvernight);
  } catch {
    return empty;
  }

  const endYmd =
    timeToMinutes(endTime) < timeToMinutes(startTime) ? addCalendarDay(sessionDate) : sessionDate;
  const expectedEndMs = istWallClockMs(endYmd, endTime);
  if (!Number.isFinite(expectedEndMs)) return empty;

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const overdue = Number.isFinite(nowMs) && nowMs > expectedEndMs;
  return {
    overdue,
    isOvernight,
    expectedEndAt: new Date(expectedEndMs).toISOString(),
    message: overdue ? SHIFT_OVERDUE_MESSAGE : null,
  };
}

module.exports = {
  SHIFT_OVERDUE_MESSAGE,
  addCalendarDay,
  evaluateOpenShiftOverdue,
  istWallClockMs,
};
