/**
 * OPEN shift overdue guidance from Shift Master start/end times.
 * Mirrors backend shiftOverdueGuidance.js. Does not close the shift or run.
 */

import { normalizeTimeOfDay, timeToMinutes } from "./shiftDuration";

export const SHIFT_OVERDUE_MESSAGE = "Shift is overdue — Production Manager action required";

const IST_OFFSET = "+05:30";

function nYmd(value: string | Date | null | undefined): string | null {
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return s.length >= 10 ? s.slice(0, 10) : null;
}

export function addCalendarDay(ymd: string): string {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function istWallClockMs(ymd: string, hhmm: string): number {
  const t = normalizeTimeOfDay(hhmm);
  if (!ymd || !t) return Number.NaN;
  return Date.parse(`${ymd}T${t}:00${IST_OFFSET}`);
}

export type OpenShiftOverdueResult = {
  overdue: boolean;
  isOvernight: boolean;
  expectedEndAt: string | null;
  message: string | null;
};

export function evaluateOpenShiftOverdue(
  input: {
    status?: string | null;
    sessionDate?: string | Date | null;
    startTime?: string | null;
    endTime?: string | null;
  } = {},
  now: Date | number = new Date(),
): OpenShiftOverdueResult {
  const empty: OpenShiftOverdueResult = {
    overdue: false,
    isOvernight: false,
    expectedEndAt: null,
    message: null,
  };
  if (String(input.status ?? "").trim().toUpperCase() !== "OPEN") return empty;

  const sessionDate = nYmd(input.sessionDate);
  const startTime = normalizeTimeOfDay(input.startTime);
  const endTime = normalizeTimeOfDay(input.endTime);
  if (!sessionDate || !startTime || !endTime) return empty;
  if (timeToMinutes(startTime) === timeToMinutes(endTime)) return empty;

  const isOvernight = timeToMinutes(endTime) < timeToMinutes(startTime);
  const endYmd = isOvernight ? addCalendarDay(sessionDate) : sessionDate;
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
