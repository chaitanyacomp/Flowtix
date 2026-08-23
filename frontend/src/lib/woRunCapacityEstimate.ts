/**
 * Multi-shift capacity context for a retained production run.
 * One continuous run may span shifts/days without counting each shift as a new setup/purge.
 */

export type ShiftDurationInput = {
  startTime?: string | null;
  endTime?: string | null;
  plannedBreakMinutes?: number | null;
};

export type RunCapacityEstimateInput = {
  plannedQty?: number | null;
  cycleTimeSeconds?: number | null;
  piecesPerCycle?: number | null;
  standardEfficiencyPercent?: number | null;
  shift?: ShiftDurationInput | null;
  plannedDate?: string | null;
};

export type RunCapacityEstimate = {
  estimatedSeconds: number | null;
  estimatedHours: number | null;
  estimatedDurationLabel: string | null;
  shiftDurationMinutes: number | null;
  shiftDurationHours: number | null;
  estimatedShiftsRequired: number | null;
  exceedsOneShift: boolean;
  expectedCompletionLabel: string | null;
  warning: string | null;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

/** Parse HH:mm (or HH:mm:ss) to minutes from midnight. */
export function parseHhMmToMinutes(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
  return hh * 60 + mm;
}

/** Net productive minutes in a shift (handles overnight). */
export function shiftNetDurationMinutes(shift: ShiftDurationInput | null | undefined): number | null {
  if (!shift) return null;
  const start = parseHhMmToMinutes(shift.startTime);
  const end = parseHhMmToMinutes(shift.endTime);
  if (start == null || end == null) return null;
  let span = end - start;
  if (span <= 0) span += 24 * 60; // overnight
  const brk = Math.max(0, n(shift.plannedBreakMinutes) || 0);
  const net = span - brk;
  return net > 0 ? net : null;
}

export function formatDurationHoursMinutes(totalSeconds: number): string {
  const minutes = Math.ceil(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

/** Compact duration for dense tables: `37h 17m`. */
export function formatCompactDurationHoursMinutes(totalSeconds: number): string {
  const minutes = Math.ceil(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Primary capacity cell: `37h 17m · ~4 shifts`. */
export function formatCompactCapacitySummary(estimate: Pick<
  RunCapacityEstimate,
  "estimatedSeconds" | "estimatedShiftsRequired" | "estimatedDurationLabel"
>): string | null {
  if (estimate.estimatedSeconds == null) {
    return estimate.estimatedDurationLabel;
  }
  const duration = formatCompactDurationHoursMinutes(estimate.estimatedSeconds);
  if (estimate.estimatedShiftsRequired != null && estimate.estimatedShiftsRequired > 0) {
    return `${duration} · ~${estimate.estimatedShiftsRequired} shifts`;
  }
  return duration;
}

/** Concise multi-shift badge (replaces long warning paragraph). */
export function formatExceedsOneShiftBadge(
  estimate: Pick<RunCapacityEstimate, "exceedsOneShift" | "estimatedShiftsRequired">,
): string | null {
  if (!estimate.exceedsOneShift) return null;
  const shifts = estimate.estimatedShiftsRequired;
  if (shifts != null && shifts > 0) {
    return `Exceeds one shift · continues across ~${shifts} shifts`;
  }
  return "Exceeds one shift · continues across shifts";
}

export const MULTI_SHIFT_CAPACITY_HELP =
  "Shift changes do not add setup/purge — one continuous run may span multiple shifts.";

export function estimateRunSeconds(input: {
  plannedQty?: number | null;
  cycleTimeSeconds?: number | null;
  piecesPerCycle?: number | null;
  standardEfficiencyPercent?: number | null;
}): number | null {
  const qty = n(input.plannedQty);
  const cycle = n(input.cycleTimeSeconds);
  const pieces = n(input.piecesPerCycle);
  const eff = n(input.standardEfficiencyPercent);
  if (!(qty > 0) || !(cycle > 0) || !(pieces >= 1) || !(eff > 0)) return null;
  const effectivePiecesPerSecond = (pieces / cycle) * (eff / 100);
  if (!(effectivePiecesPerSecond > 0)) return null;
  return qty / effectivePiecesPerSecond;
}

/**
 * Capacity presentation for a continuous multi-shift run.
 * Does not reject qty that exceeds one shift — warns only.
 */
export function estimateRunCapacityContext(input: RunCapacityEstimateInput): RunCapacityEstimate {
  const estimatedSeconds = estimateRunSeconds(input);
  const shiftMinutes = shiftNetDurationMinutes(input.shift);
  const estimatedHours =
    estimatedSeconds != null ? Math.round((estimatedSeconds / 3600) * 100) / 100 : null;
  const shiftDurationHours =
    shiftMinutes != null ? Math.round((shiftMinutes / 60) * 100) / 100 : null;
  const estimatedShiftsRequired =
    estimatedSeconds != null && shiftMinutes != null && shiftMinutes > 0
      ? Math.ceil(estimatedSeconds / (shiftMinutes * 60))
      : null;
  const exceedsOneShift =
    estimatedSeconds != null && shiftMinutes != null && estimatedSeconds > shiftMinutes * 60 + 1e-6;

  let expectedCompletionLabel: string | null = null;
  const plannedDate = String(input.plannedDate ?? "").trim();
  const startMin = parseHhMmToMinutes(input.shift?.startTime);
  if (estimatedSeconds != null && plannedDate && startMin != null && /^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) {
    const [y, mo, d] = plannedDate.split("-").map(Number);
    const startMs = Date.UTC(y, mo - 1, d, Math.floor(startMin / 60), startMin % 60, 0);
    const end = new Date(startMs + estimatedSeconds * 1000);
    const pad = (x: number) => String(x).padStart(2, "0");
    expectedCompletionLabel = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())} ${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())} (UTC calendar; shift-local)`;
  }

  let warning: string | null = null;
  if (exceedsOneShift && estimatedShiftsRequired != null) {
    warning = `Planned qty exceeds one shift (~${shiftDurationHours} h). Continuous run needs ~${estimatedShiftsRequired} shift(s); shift changes alone do not add setup/purge.`;
  }

  return {
    estimatedSeconds,
    estimatedHours,
    estimatedDurationLabel: estimatedSeconds != null ? formatDurationHoursMinutes(estimatedSeconds) : null,
    shiftDurationMinutes: shiftMinutes,
    shiftDurationHours,
    estimatedShiftsRequired,
    exceedsOneShift,
    expectedCompletionLabel,
    warning,
  };
}
