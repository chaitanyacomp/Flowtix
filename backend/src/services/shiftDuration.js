/**
 * Shift duration helpers — time-of-day strings only (HH:mm / HH:mm:ss).
 * No Date / timezone conversion.
 */

/** @param {unknown} value */
function normalizeTimeOfDay(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) {
    const err = new Error("Invalid time. Use HH:mm (24-hour).");
    err.statusCode = 400;
    throw err;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] != null ? Number(m[3]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) {
    const err = new Error("Invalid time. Use HH:mm (24-hour).");
    err.statusCode = 400;
    throw err;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** @param {string} hhmm */
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * @param {string} startTime HH:mm
 * @param {string} endTime HH:mm
 * @param {number} [plannedBreakMinutes]
 * @returns {{
 *   startTime: string,
 *   endTime: string,
 *   plannedBreakMinutes: number,
 *   isOvernight: boolean,
 *   grossDurationMinutes: number,
 *   netProductionDurationMinutes: number,
 * }}
 */
function computeShiftDurations(startTimeRaw, endTimeRaw, plannedBreakMinutesRaw = 0) {
  const startTime = normalizeTimeOfDay(startTimeRaw);
  const endTime = normalizeTimeOfDay(endTimeRaw);
  if (!startTime || !endTime) {
    const err = new Error("Start time and end time are required.");
    err.statusCode = 400;
    throw err;
  }

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  if (startMin === endMin) {
    const err = new Error("Start time and end time cannot be identical.");
    err.statusCode = 400;
    throw err;
  }

  const isOvernight = endMin < startMin;
  const grossDurationMinutes = isOvernight ? 24 * 60 - startMin + endMin : endMin - startMin;

  let plannedBreakMinutes = Number(plannedBreakMinutesRaw);
  if (!Number.isFinite(plannedBreakMinutes)) plannedBreakMinutes = 0;
  plannedBreakMinutes = Math.trunc(plannedBreakMinutes);
  if (plannedBreakMinutes < 0) {
    const err = new Error("Planned break minutes must be zero or positive.");
    err.statusCode = 400;
    throw err;
  }
  if (plannedBreakMinutes >= grossDurationMinutes) {
    const err = new Error("Planned break minutes must be less than gross shift duration.");
    err.statusCode = 400;
    throw err;
  }

  return {
    startTime,
    endTime,
    plannedBreakMinutes,
    isOvernight,
    grossDurationMinutes,
    netProductionDurationMinutes: grossDurationMinutes - plannedBreakMinutes,
  };
}

/** Human-readable duration, e.g. 480 → "8h 0m". */
function formatDurationMinutes(totalMinutes) {
  const n = Math.max(0, Math.trunc(Number(totalMinutes) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${m}m`;
}

module.exports = {
  normalizeTimeOfDay,
  timeToMinutes,
  computeShiftDurations,
  formatDurationMinutes,
};
