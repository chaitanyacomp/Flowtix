/**
 * Manager-only shift time controls: End This Shift, Continue Overtime, Confirm Actual End.
 * Does not close the run, verify a report, Shift Over, or start the next shift.
 */

const { prisma } = require("../utils/prisma");
const { domainError, mapShiftSessionPersistenceError } = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  normalizePositiveInt,
  normalizeOptionalUserId,
  normalizeChangeReason,
} = require("./machineShiftSessionService");
const {
  SESSION_STATUS,
  reconcileSessionExpiry,
  resolveLiveCutoff,
  resolveNormalCutoff,
  parseDateTimeRequired,
  assertActualEndInRange,
  asDate,
} = require("./shiftSessionTimeWindowService");

function isManagerRole(role) {
  const r = String(role || "").trim().toUpperCase();
  return r === "ADMIN" || r === "PRODUCTION_MANAGER";
}

function assertManagerTimeRole(actorRole) {
  if (!isManagerRole(actorRole)) {
    throw domainError(
      403,
      "PRODUCTION_MANAGER_ACTION_REQUIRED",
      "A Production Manager or Admin must perform this action.",
    );
  }
}

/**
 * OPEN → HANDOVER_PENDING at manager action time.
 * liveProductionStoppedAt = action time.
 * actualOperationalEndAt = manager-confirmed time (not detection time).
 */
async function endShiftForHandover(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(input?.endedByUserId ?? input?.actorUserId);
  const actorRole = input?.actorRole;
  const now = asDate(input?.now) || new Date();
  assertManagerTimeRole(actorRole);

  const actualEnd = parseDateTimeRequired(
    input?.actualOperationalEndAt,
    "ACTUAL_END_REQUIRED",
    "Confirm the actual operational end time.",
  );

  try {
    return await withShiftSessionTx(db, async (tx) => {
      let session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
      }
      session = await reconcileSessionExpiry(tx, session, now);

      if (session.status === SESSION_STATUS.HANDOVER_PENDING) {
        throw domainError(
          409,
          "SHIFT_END_NOT_ALLOWED",
          "This shift has already ended for live production. Confirm the actual end time if it is still pending.",
          { status: session.status },
        );
      }
      if (session.status !== SESSION_STATUS.OPEN) {
        throw domainError(
          409,
          "SHIFT_SESSION_NOT_OPEN",
          "Only an open shift can be ended by a Production Manager.",
          { status: session.status },
        );
      }

      const cutoff = resolveLiveCutoff(session);
      assertActualEndInRange({
        actualEnd,
        startedAt: session.startedAt,
        upperBound: cutoff,
        now,
      });

      const updated = await tx.machineShiftSession.update({
        where: { id: sessionId },
        data: {
          status: SESSION_STATUS.HANDOVER_PENDING,
          liveProductionStoppedAt: now,
          actualOperationalEndAt: actualEnd,
        },
      });

      return { session: updated, ended: true };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "endShiftForHandover" });
  }
}

/**
 * Extend live cutoff while remaining OPEN. approvedUntil must be future and after normal cutoff.
 */
async function continueShiftOvertime(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(input?.overtimeApprovedByUserId ?? input?.actorUserId);
  const actorRole = input?.actorRole;
  const now = asDate(input?.now) || new Date();
  assertManagerTimeRole(actorRole);

  const approvedUntil = parseDateTimeRequired(
    input?.approvedUntil ?? input?.overtimeApprovedUntil,
    "OVERTIME_UNTIL_REQUIRED",
    "Enter the overtime cutoff time.",
  );
  const overtimeReason = normalizeChangeReason(input?.reason ?? input?.overtimeReason, {
    required: true,
    message: "A reason is required to continue overtime.",
  });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      let session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
      }
      session = await reconcileSessionExpiry(tx, session, now);

      if (session.status !== SESSION_STATUS.OPEN) {
        throw domainError(
          409,
          "SHIFT_OVERTIME_NOT_ALLOWED",
          "Overtime can only be approved while the shift is still open.",
          { status: session.status },
        );
      }

      const normalCutoff = resolveNormalCutoff(session);
      if (!normalCutoff) {
        throw domainError(
          409,
          "OVERTIME_UNTIL_INVALID",
          "This shift has no scheduled end snapshot, so overtime cannot be approved.",
        );
      }
      if (approvedUntil.getTime() <= now.getTime()) {
        throw domainError(
          400,
          "OVERTIME_UNTIL_INVALID",
          "Overtime cutoff must be in the future.",
        );
      }
      if (approvedUntil.getTime() <= normalCutoff.getTime()) {
        throw domainError(
          400,
          "OVERTIME_UNTIL_INVALID",
          "Overtime cutoff must be later than the normal live cutoff.",
        );
      }

      const updated = await tx.machineShiftSession.update({
        where: { id: sessionId },
        data: {
          overtimeApprovedUntil: approvedUntil,
          overtimeApprovedAt: now,
          overtimeApprovedByUserId: actorUserId,
          overtimeReason,
        },
      });

      return { session: updated, overtimeApproved: true };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "continueShiftOvertime" });
  }
}

/**
 * Confirm actual operational end on HANDOVER_PENDING only.
 * Must lie between startedAt and liveProductionStoppedAt. Never copies timeEndDetectedAt.
 */
async function confirmShiftActualEnd(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(input?.actorUserId);
  const actorRole = input?.actorRole;
  const now = asDate(input?.now) || new Date();
  assertManagerTimeRole(actorRole);
  void actorUserId;

  const actualEnd = parseDateTimeRequired(
    input?.actualOperationalEndAt,
    "ACTUAL_END_REQUIRED",
    "Confirm the actual operational end time.",
  );

  try {
    return await withShiftSessionTx(db, async (tx) => {
      let session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
      }
      session = await reconcileSessionExpiry(tx, session, now);

      if (session.status !== SESSION_STATUS.HANDOVER_PENDING) {
        throw domainError(
          409,
          "CONFIRM_ACTUAL_END_NOT_ALLOWED",
          "Actual end can be confirmed only after live production has ended and handover is pending.",
          { status: session.status },
        );
      }

      if (asDate(session.actualOperationalEndAt)) {
        throw domainError(
          409,
          "ACTUAL_END_ALREADY_CONFIRMED",
          "Actual operational end is already confirmed for this shift.",
        );
      }

      const upper = asDate(session.liveProductionStoppedAt) || resolveLiveCutoff(session);
      assertActualEndInRange({
        actualEnd,
        startedAt: session.startedAt,
        upperBound: upper,
        now,
      });

      const detected = asDate(session.timeEndDetectedAt);
      if (detected && actualEnd.getTime() === detected.getTime() && input?.copyDetectedAt) {
        throw domainError(
          400,
          "ACTUAL_END_INVALID",
          "Actual end cannot be copied from system detection time.",
        );
      }

      const updated = await tx.machineShiftSession.update({
        where: { id: sessionId },
        data: { actualOperationalEndAt: actualEnd },
      });

      return { session: updated, confirmed: true };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "confirmShiftActualEnd" });
  }
}

module.exports = {
  isManagerRole,
  assertManagerTimeRole,
  endShiftForHandover,
  continueShiftOvertime,
  confirmShiftActualEnd,
};
