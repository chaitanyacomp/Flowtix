/**
 * Authoritative shift start/end window, live cutoff, and HANDOVER_PENDING expiry.
 * IST wall clock +05:30 (India has no DST). UI timers are display-only.
 */

const { domainError } = require("./machineShiftSessionErrors");
const { normalizeTimeOfDay, timeToMinutes } = require("./shiftDuration");
const { addCalendarDay, istWallClockMs } = require("./shiftOverdueGuidance");

const DEFAULT_SHIFT_GRACE_MINUTES = 15;

const SESSION_STATUS = Object.freeze({
  OPEN: "OPEN",
  SHIFT_OVER: "SHIFT_OVER",
  CANCELLED: "CANCELLED",
  HANDOVER_PENDING: "HANDOVER_PENDING",
});

const START_OUTSIDE_WINDOW_REASONS = Object.freeze({
  EARLY_START: "EARLY_START",
  LATE_ARRIVAL: "LATE_ARRIVAL",
  PREVIOUS_SHIFT_DELAY: "PREVIOUS_SHIFT_DELAY",
  EMERGENCY: "EMERGENCY",
  OTHER: "OTHER",
});

const START_OUTSIDE_WINDOW_REASON_SET = Object.freeze(
  new Set(Object.values(START_OUTSIDE_WINDOW_REASONS)),
);

/** Diagnostic side of the start window — not a stored reason code. */
const START_WINDOW_SIDE = Object.freeze({
  EARLY: "EARLY",
  LATE: "LATE",
});

const GUIDANCE = Object.freeze({
  HANDOVER_PENDING: "Time ended — handover needed.",
  HANDOVER_PENDING_CONFIRM_ACTUAL_END:
    "Time ended — handover needed. Confirm the actual end time before Shift Report end variance or starting the next shift.",
  END_GRACE:
    "Shift is in end grace. A Production Manager can end this shift or continue overtime.",
  LIVE_WINDOW_ENDED:
    "Live production for this shift has ended. A Production Manager must handle handover or late entry.",
  HANDOVER_BLOCKS_START:
    "This machine has an unresolved shift handover. Start the next shift from handover, or ask a Production Manager.",
  START_OUTSIDE_WINDOW:
    "Start is outside the allowed window. A Production Manager or Admin must start with a reason and remarks.",
});

const NEXT_ACTION_MANAGER_HANDOVER_OR_LATE_ENTRY = "MANAGER_HANDOVER_OR_LATE_ENTRY";

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (value == null || value === "") return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function sessionDateYmd(sessionDate) {
  if (sessionDate == null || sessionDate === "") return null;
  const s = String(sessionDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (sessionDate instanceof Date && Number.isFinite(sessionDate.getTime())) {
    return sessionDate.toISOString().slice(0, 10);
  }
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function addMinutes(date, minutes) {
  const d = asDate(date);
  const n = Number(minutes);
  if (!d || !Number.isFinite(n)) return null;
  return new Date(d.getTime() + n * 60 * 1000);
}

function normalizeGraceMinutes(value, fallback = DEFAULT_SHIFT_GRACE_MINUTES) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

/**
 * Frozen scheduled occurrence from session starting date + Shift Master HH:mm.
 * Overnight (end < start): end is the next calendar date. Stored as UTC Date.
 *
 * @param {{ sessionDate: string|Date, startTime: string, endTime: string }} input
 * @returns {{
 *   scheduledStartAt: Date,
 *   scheduledEndAt: Date,
 *   isOvernight: boolean,
 *   startYmd: string,
 *   endYmd: string,
 * } | null}
 */
function buildScheduledWindow(input = {}) {
  const ymd = sessionDateYmd(input.sessionDate);
  let startTime;
  let endTime;
  try {
    startTime = normalizeTimeOfDay(input.startTime);
    endTime = normalizeTimeOfDay(input.endTime);
  } catch {
    return null;
  }
  if (!ymd || !startTime || !endTime) return null;
  if (timeToMinutes(startTime) === timeToMinutes(endTime)) return null;

  const isOvernight = timeToMinutes(endTime) < timeToMinutes(startTime);
  const endYmd = isOvernight ? addCalendarDay(ymd) : ymd;
  const startMs = istWallClockMs(ymd, startTime);
  const endMs = istWallClockMs(endYmd, endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return {
    scheduledStartAt: new Date(startMs),
    scheduledEndAt: new Date(endMs),
    isOvernight,
    startYmd: ymd,
    endYmd,
  };
}

/**
 * Start window: scheduledStartAt ± graceMinutes (inclusive).
 * @param {Date|string|null} scheduledStartAt
 * @param {number} graceMinutes
 */
function buildStartWindow(scheduledStartAt, graceMinutes) {
  const start = asDate(scheduledStartAt);
  const grace = normalizeGraceMinutes(graceMinutes);
  if (!start) return { windowStartAt: null, windowEndAt: null, graceMinutes: grace };
  return {
    windowStartAt: addMinutes(start, -grace),
    windowEndAt: addMinutes(start, grace),
    graceMinutes: grace,
  };
}

function isWithinInclusiveRange(now, start, end) {
  const t = asDate(now);
  const a = asDate(start);
  const b = asDate(end);
  if (!t || !a || !b) return false;
  return t.getTime() >= a.getTime() && t.getTime() <= b.getTime();
}

function evaluateStartWindow(scheduledStartAt, graceMinutes, now = new Date()) {
  const { windowStartAt, windowEndAt, graceMinutes: grace } = buildStartWindow(
    scheduledStartAt,
    graceMinutes,
  );
  const t = asDate(now);
  if (!t || !windowStartAt || !windowEndAt) {
    return {
      windowStartAt,
      windowEndAt,
      graceMinutes: grace,
      withinStartWindow: false,
      withinStartGrace: false,
      side: null,
    };
  }
  const withinStartWindow = isWithinInclusiveRange(t, windowStartAt, windowEndAt);
  const start = asDate(scheduledStartAt);
  let side = null;
  if (t.getTime() < windowStartAt.getTime()) side = START_WINDOW_SIDE.EARLY;
  else if (t.getTime() > windowEndAt.getTime()) side = START_WINDOW_SIDE.LATE;
  return {
    windowStartAt,
    windowEndAt,
    graceMinutes: grace,
    withinStartWindow,
    withinStartGrace: withinStartWindow,
    side,
    scheduledStartAt: start,
  };
}

/**
 * Normal live cutoff = scheduledEndAt + graceMinutesSnapshot.
 * overtimeApprovedUntil is used when it is later than that normal cutoff.
 * @param {{
 *   scheduledEndAt?: Date|string|null,
 *   graceMinutesSnapshot?: number|null,
 *   overtimeApprovedUntil?: Date|string|null,
 * }} session
 */
function resolveNormalCutoff(session = {}) {
  const end = asDate(session.scheduledEndAt);
  const grace = normalizeGraceMinutes(session.graceMinutesSnapshot);
  if (!end) return null;
  return addMinutes(end, grace);
}

function isOvertimeUntilValid(overtimeApprovedUntil, normalCutoff) {
  const until = asDate(overtimeApprovedUntil);
  const cutoff = asDate(normalCutoff);
  if (!until || !cutoff) return false;
  return until.getTime() > cutoff.getTime();
}

function resolveLiveCutoff(session = {}) {
  const normalCutoff = resolveNormalCutoff(session);
  if (isOvertimeUntilValid(session.overtimeApprovedUntil, normalCutoff)) {
    return asDate(session.overtimeApprovedUntil);
  }
  return normalCutoff;
}

function evaluateLiveWindow(session = {}, now = new Date()) {
  const scheduledStartAt = asDate(session.scheduledStartAt);
  const scheduledEndAt = asDate(session.scheduledEndAt);
  const grace = normalizeGraceMinutes(session.graceMinutesSnapshot);
  const normalCutoff = resolveNormalCutoff(session);
  const liveCutoffAt = resolveLiveCutoff(session);
  const t = asDate(now) || new Date();
  const overtimeUntil = asDate(session.overtimeApprovedUntil);
  const overtimeActive =
    isOvertimeUntilValid(overtimeUntil, normalCutoff) &&
    t.getTime() <= overtimeUntil.getTime() &&
    normalCutoff != null &&
    t.getTime() > normalCutoff.getTime();
  const withinEndGrace =
    scheduledEndAt != null &&
    normalCutoff != null &&
    t.getTime() >= scheduledEndAt.getTime() &&
    t.getTime() <= normalCutoff.getTime();
  const liveOpen = liveCutoffAt != null && t.getTime() <= liveCutoffAt.getTime();
  return {
    scheduledStartAt,
    scheduledEndAt,
    graceMinutesSnapshot: session.graceMinutesSnapshot == null ? grace : Number(session.graceMinutesSnapshot),
    normalCutoffAt: normalCutoff,
    liveCutoffAt,
    overtimeApprovedUntil: overtimeUntil,
    overtimeActive,
    withinEndGrace,
    liveOpen,
    now: t,
  };
}

function isLiveProductionAllowed(session = {}, now = new Date()) {
  const status = String(session?.status || "").trim().toUpperCase();
  if (status !== SESSION_STATUS.OPEN) return false;
  const liveEval = evaluateLiveWindow(session, now);
  if (!liveEval.liveCutoffAt) return true;
  return Boolean(liveEval.liveOpen);
}

function buildStatusGuidance(session = {}, windowEval = {}, now = new Date()) {
  const status = String(session.status || "").trim().toUpperCase();
  const actualEnd = asDate(session.actualOperationalEndAt);
  const actualEndConfirmationPending = status === SESSION_STATUS.HANDOVER_PENDING && !actualEnd;
  if (status === SESSION_STATUS.HANDOVER_PENDING) {
    return {
      statusGuidanceCode: actualEndConfirmationPending
        ? "HANDOVER_PENDING_CONFIRM_ACTUAL_END"
        : "HANDOVER_PENDING",
      statusGuidance: actualEndConfirmationPending
        ? GUIDANCE.HANDOVER_PENDING_CONFIRM_ACTUAL_END
        : GUIDANCE.HANDOVER_PENDING,
      actualEndConfirmationPending,
    };
  }
  if (status === SESSION_STATUS.OPEN && windowEval.withinEndGrace) {
    return {
      statusGuidanceCode: "END_GRACE",
      statusGuidance: GUIDANCE.END_GRACE,
      actualEndConfirmationPending: false,
    };
  }
  if (status === SESSION_STATUS.OPEN && windowEval.overtimeActive) {
    return {
      statusGuidanceCode: "OVERTIME",
      statusGuidance: "Overtime is approved. Live production continues until the approved cutoff.",
      actualEndConfirmationPending: false,
    };
  }
  void now;
  return {
    statusGuidanceCode: status || null,
    statusGuidance: null,
    actualEndConfirmationPending: false,
  };
}

function mapShiftTimeWindowDto(session = {}, now = new Date()) {
  const startEval = evaluateStartWindow(session.scheduledStartAt, session.graceMinutesSnapshot, now);
  const liveEval = evaluateLiveWindow(session, now);
  const guidance = buildStatusGuidance(session, liveEval, now);
  return {
    scheduledStartAt: liveEval.scheduledStartAt ? liveEval.scheduledStartAt.toISOString() : null,
    scheduledEndAt: liveEval.scheduledEndAt ? liveEval.scheduledEndAt.toISOString() : null,
    graceMinutesSnapshot:
      session.graceMinutesSnapshot == null ? null : Number(session.graceMinutesSnapshot),
    startWindowStartAt: startEval.windowStartAt ? startEval.windowStartAt.toISOString() : null,
    startWindowEndAt: startEval.windowEndAt ? startEval.windowEndAt.toISOString() : null,
    withinStartWindow: startEval.withinStartWindow,
    withinStartGrace: startEval.withinStartGrace,
    liveCutoffAt: liveEval.liveCutoffAt ? liveEval.liveCutoffAt.toISOString() : null,
    withinEndGrace: liveEval.withinEndGrace,
    overtimeApprovedUntil: liveEval.overtimeApprovedUntil
      ? liveEval.overtimeApprovedUntil.toISOString()
      : null,
    overtimeApprovedAt: asDate(session.overtimeApprovedAt)
      ? asDate(session.overtimeApprovedAt).toISOString()
      : null,
    overtimeApprovedByUserId: session.overtimeApprovedByUserId ?? null,
    overtimeReason: session.overtimeReason ?? null,
    overtimeActive: liveEval.overtimeActive,
    liveProductionStoppedAt: asDate(session.liveProductionStoppedAt)
      ? asDate(session.liveProductionStoppedAt).toISOString()
      : null,
    timeEndDetectedAt: asDate(session.timeEndDetectedAt)
      ? asDate(session.timeEndDetectedAt).toISOString()
      : null,
    actualOperationalEndAt: asDate(session.actualOperationalEndAt)
      ? asDate(session.actualOperationalEndAt).toISOString()
      : null,
    startedOutsideWindow: Boolean(session.startedOutsideWindow),
    startedOutsideWindowReason: session.startedOutsideWindowReason ?? null,
    startedOutsideWindowRemarks: session.startedOutsideWindowRemarks ?? null,
    actualEndConfirmationPending: guidance.actualEndConfirmationPending,
    statusGuidanceCode: guidance.statusGuidanceCode,
    statusGuidance: guidance.statusGuidance,
    isLiveProductionAllowed: isLiveProductionAllowed(session, now),
  };
}

async function readShiftGraceMinutes(tx) {
  if (!tx || typeof tx.appSetting?.findUnique !== "function") {
    return DEFAULT_SHIFT_GRACE_MINUTES;
  }
  const row = await tx.appSetting.findUnique({
    where: { id: 1 },
    select: { shiftGraceMinutes: true },
  });
  return normalizeGraceMinutes(row?.shiftGraceMinutes, DEFAULT_SHIFT_GRACE_MINUTES);
}

/**
 * Unresolved handover: HANDOVER_PENDING on this machine with no successor
 * session pointing at it via previousSessionId.
 */
async function findUnresolvedHandoverSession(tx, machineId) {
  const mid = Number(machineId);
  if (!Number.isInteger(mid) || mid <= 0) return null;
  const pending = await tx.machineShiftSession.findFirst({
    where: { machineId: mid, status: SESSION_STATUS.HANDOVER_PENDING },
    orderBy: { id: "desc" },
  });
  if (!pending) return null;
  const successor = await tx.machineShiftSession.findFirst({
    where: { previousSessionId: pending.id },
    select: { id: true },
  });
  if (successor) return null;
  return pending;
}

function throwHandoverPending(session) {
  throw domainError(
    409,
    "SHIFT_HANDOVER_PENDING",
    GUIDANCE.HANDOVER_BLOCKS_START,
    {
      sessionId: session?.id ?? null,
      shiftSessionNo: session?.shiftSessionNo ?? null,
      nextAction: "START_NEXT_SHIFT_HANDOVER",
    },
  );
}

function throwLiveWindowEnded(session, extra = {}) {
  throw domainError(409, "SHIFT_LIVE_WINDOW_ENDED", GUIDANCE.LIVE_WINDOW_ENDED, {
    sessionId: session?.id ?? null,
    shiftSessionNo: session?.shiftSessionNo ?? null,
    nextAction: NEXT_ACTION_MANAGER_HANDOVER_OR_LATE_ENTRY,
    ...extra,
  });
}

/**
 * OPEN + now past live cutoff → HANDOVER_PENDING.
 * liveProductionStoppedAt = effective cutoff (not detection time).
 * timeEndDetectedAt = first detection time only.
 * actualOperationalEndAt unchanged (null on auto-expiry).
 * Idempotent under repeated and concurrent calls (updateMany status=OPEN).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} session
 * @param {Date} [now]
 */
async function reconcileSessionExpiry(tx, session, now = new Date()) {
  if (!session || !session.id) return session;
  const status = String(session.status || "").trim().toUpperCase();
  if (status === SESSION_STATUS.HANDOVER_PENDING) {
    return session;
  }
  if (status !== SESSION_STATUS.OPEN) {
    return session;
  }

  const liveEval = evaluateLiveWindow(session, now);
  if (!liveEval.liveCutoffAt) {
    return session;
  }
  if (liveEval.now.getTime() <= liveEval.liveCutoffAt.getTime()) {
    return session;
  }

  const cutoff = liveEval.liveCutoffAt;
  const detectedAt = asDate(session.timeEndDetectedAt) || liveEval.now;
  const stoppedAt = asDate(session.liveProductionStoppedAt) || cutoff;

  const result = await tx.machineShiftSession.updateMany({
    where: { id: session.id, status: SESSION_STATUS.OPEN },
    data: {
      status: SESSION_STATUS.HANDOVER_PENDING,
      liveProductionStoppedAt: stoppedAt,
      timeEndDetectedAt: detectedAt,
    },
  });

  if (!result || Number(result.count) === 0) {
    const latest = await tx.machineShiftSession.findUnique({ where: { id: session.id } });
    return latest || session;
  }

  const latest = await tx.machineShiftSession.findUnique({ where: { id: session.id } });
  return latest || {
    ...session,
    status: SESSION_STATUS.HANDOVER_PENDING,
    liveProductionStoppedAt: stoppedAt,
    timeEndDetectedAt: detectedAt,
  };
}

/**
 * Optional process-start sweep — same evaluator as API reconciliation.
 * Intentionally unwired in this phase: do not call from server bootstrap.
 * Restarting the API must not mutate long-lived OPEN sessions (including live SS-26-0004).
 * Until the complete UI/handover flow is ready, API-path reconcileSessionExpiry remains
 * the authoritative transition to HANDOVER_PENDING.
 */
async function reconcileOpenShiftSessionsPastCutoff(db, now = new Date()) {
  if (!db?.machineShiftSession?.findMany) return { evaluated: 0, transitioned: 0 };
  const openRows = await db.machineShiftSession.findMany({
    where: { status: SESSION_STATUS.OPEN },
  });
  let transitioned = 0;
  for (const row of openRows) {
    const before = String(row.status || "");
    const after = await reconcileSessionExpiry(db, row, now);
    if (before === SESSION_STATUS.OPEN && after?.status === SESSION_STATUS.HANDOVER_PENDING) {
      transitioned += 1;
    }
  }
  return { evaluated: openRows.length, transitioned };
}

function parseDateTimeRequired(value, code, message) {
  const d = asDate(value);
  if (!d) {
    throw domainError(400, code, message);
  }
  return d;
}

function assertActualEndInRange({ actualEnd, startedAt, upperBound, now }) {
  const actual = asDate(actualEnd);
  const started = asDate(startedAt);
  const upper = asDate(upperBound);
  const t = asDate(now) || new Date();
  if (!actual) {
    throw domainError(400, "ACTUAL_END_REQUIRED", "Confirm the actual operational end time.");
  }
  if (actual.getTime() > t.getTime()) {
    throw domainError(
      400,
      "ACTUAL_END_INVALID",
      "Actual end cannot be in the future.",
    );
  }
  if (started && actual.getTime() < started.getTime()) {
    throw domainError(
      400,
      "ACTUAL_END_INVALID",
      "Actual end cannot be before this shift started.",
    );
  }
  if (upper && actual.getTime() > upper.getTime()) {
    throw domainError(
      400,
      "ACTUAL_END_INVALID",
      "Actual end must be at or before the authorized live cutoff.",
    );
  }
  return actual;
}

module.exports = {
  DEFAULT_SHIFT_GRACE_MINUTES,
  SESSION_STATUS,
  START_OUTSIDE_WINDOW_REASONS,
  START_OUTSIDE_WINDOW_REASON_SET,
  START_WINDOW_SIDE,
  GUIDANCE,
  NEXT_ACTION_MANAGER_HANDOVER_OR_LATE_ENTRY,
  asDate,
  sessionDateYmd,
  addMinutes,
  normalizeGraceMinutes,
  buildScheduledWindow,
  buildStartWindow,
  evaluateStartWindow,
  resolveNormalCutoff,
  resolveLiveCutoff,
  isOvertimeUntilValid,
  evaluateLiveWindow,
  isLiveProductionAllowed,
  mapShiftTimeWindowDto,
  readShiftGraceMinutes,
  findUnresolvedHandoverSession,
  throwHandoverPending,
  throwLiveWindowEnded,
  reconcileSessionExpiry,
  reconcileOpenShiftSessionsPastCutoff,
  parseDateTimeRequired,
  assertActualEndInRange,
  buildStatusGuidance,
};
