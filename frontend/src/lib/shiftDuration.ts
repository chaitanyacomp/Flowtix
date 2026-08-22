/**
 * Shift duration helpers — time-of-day strings only (HH:mm / HH:mm:ss).
 * No Date / timezone conversion. Mirrors backend shiftDuration.js.
 */

export function normalizeTimeOfDay(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] != null ? Number(m[3]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export type ShiftDurationResult = {
  startTime: string;
  endTime: string;
  plannedBreakMinutes: number;
  isOvernight: boolean;
  grossDurationMinutes: number;
  netProductionDurationMinutes: number;
  error?: string;
};

export function computeShiftDurationsPreview(
  startTimeRaw: unknown,
  endTimeRaw: unknown,
  plannedBreakMinutesRaw: unknown = 0,
): ShiftDurationResult | { error: string } {
  const startTime = normalizeTimeOfDay(startTimeRaw);
  const endTime = normalizeTimeOfDay(endTimeRaw);
  if (!startTime || !endTime) {
    return { error: "Start time and end time are required." };
  }
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  if (startMin === endMin) {
    return { error: "Start time and end time cannot be identical." };
  }
  const isOvernight = endMin < startMin;
  const grossDurationMinutes = isOvernight ? 24 * 60 - startMin + endMin : endMin - startMin;

  let plannedBreakMinutes = Number(plannedBreakMinutesRaw);
  if (!Number.isFinite(plannedBreakMinutes)) plannedBreakMinutes = 0;
  plannedBreakMinutes = Math.trunc(plannedBreakMinutes);
  if (plannedBreakMinutes < 0) {
    return { error: "Planned break minutes must be zero or positive." };
  }
  if (plannedBreakMinutes >= grossDurationMinutes) {
    return { error: "Planned break minutes must be less than gross shift duration." };
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

export function formatDurationMinutes(totalMinutes: number): string {
  const n = Math.max(0, Math.trunc(Number(totalMinutes) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${m}m`;
}
