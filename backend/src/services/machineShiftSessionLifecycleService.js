/**
 * Step 2B — Shift Over and controlled reopen (service layer only).
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
  HANDOVER_STATES,
} = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  normalizePositiveInt,
  normalizeOptionalUserId,
  normalizeChangeReason,
  normalizeHandoverState,
  SESSION_STATUS,
  findOpenSessionForMachine,
} = require("./machineShiftSessionService");
const {
  SEGMENT_STATUS,
  SYSTEM_CLOSE_REASON,
  findActiveRunSegmentForMachine,
} = require("./machineShiftSessionRunSegmentService");
const {
  closeActiveParticipationsForShiftOver,
  restoreParticipationsAfterReopen,
} = require("./machineShiftSessionOperatorService");
const {
  REPORT_VERSION_STATUS,
  ensureShiftProductionReport,
  findLatestVersion,
  createDraftVersionFrom,
} = require("./machineShiftProductionReportService");

const REOPEN_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  DENIED: "DENIED",
});

function normalizeHandoverRemarks(value, handoverState) {
  if (value == null || value === "") {
    if (handoverState === "UNKNOWN") {
      throw domainError(
        400,
        "HANDOVER_REMARKS_REQUIRED",
        "Add handover remarks when machine handover state is Unknown.",
      );
    }
    return null;
  }
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text) {
    if (handoverState === "UNKNOWN") {
      throw domainError(
        400,
        "HANDOVER_REMARKS_REQUIRED",
        "Add handover remarks when machine handover state is Unknown.",
      );
    }
    return null;
  }
  return text.slice(0, 2000);
}

function normalizeDecisionNote(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 2000) : null;
}

/**
 * Shift Over: requires latest report VERIFIED; closes active run + current downtime segment;
 * leaves parent downtime incident open for next-session continuation; sets session SHIFT_OVER.
 */
async function completeShiftOver(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(input?.endedByUserId ?? input?.actorUserId);
  const handoverState = normalizeHandoverState(input?.handoverState);
  if (!HANDOVER_STATES.has(handoverState)) {
    throw domainError(400, "HANDOVER_STATE_INVALID", "Machine handover state must be Retained, Cleared, or Unknown.");
  }
  const handoverRemarks = normalizeHandoverRemarks(input?.handoverRemarks, handoverState);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
      }

      if (session.status === SESSION_STATUS.SHIFT_OVER) {
        return {
          session,
          completed: false,
          alreadyShiftOver: true,
          closedRunSegmentIds: [],
          closedDowntimeSegmentIds: [],
          closedOperatorParticipationIds: [],
        };
      }

      const report = await ensureShiftProductionReport(tx, sessionId);
      const latest = await findLatestVersion(tx, report);
      if (!latest || latest.status !== REPORT_VERSION_STATUS.VERIFIED) {
        throw domainError(
          409,
          "SHIFT_OVER_REQUIRES_VERIFIED_REPORT",
          "Shift Over is allowed only after the latest shift report version is verified.",
        );
      }

      const now = new Date();
      const closedRunSegmentIds = [];

      // Close ACTIVE run segment(s) for this machine/session with controlled system reason.
      const activeRun = await findActiveRunSegmentForMachine(tx, session.machineId);
      if (activeRun && activeRun.sessionId === sessionId && activeRun.status === SEGMENT_STATUS.ACTIVE) {
        await tx.machineShiftSessionRunSegment.update({
          where: { id: activeRun.id },
          data: {
            status: SEGMENT_STATUS.CLOSED,
            closedAt: now,
            closedByUserId: actorUserId,
            closeReason: SYSTEM_CLOSE_REASON.SHIFT_OVER,
          },
        });
        closedRunSegmentIds.push(activeRun.id);
      }

      // Close current shift downtime segment(s); keep parent incident open for continuation.
      const openDtSegs = await tx.machineShiftDowntimeSegment.findMany({
        where: { sessionId, segmentEndAt: null },
      });
      const closedDowntimeSegmentIds = [];
      for (const seg of openDtSegs) {
        await tx.machineShiftDowntimeSegment.update({
          where: { id: seg.id },
          data: { segmentEndAt: now },
        });
        closedDowntimeSegmentIds.push(seg.id);
      }

      const closedOperatorParticipationIds = await closeActiveParticipationsForShiftOver(tx, sessionId, {
        actorUserId,
        at: now,
      });

      const updated = await tx.machineShiftSession.update({
        where: { id: sessionId },
        data: {
          status: SESSION_STATUS.SHIFT_OVER,
          endedAt: now,
          endedByUserId: actorUserId,
          handoverState,
          handoverRemarks,
        },
      });

      return {
        session: updated,
        completed: true,
        alreadyShiftOver: false,
        closedRunSegmentIds,
        closedDowntimeSegmentIds,
        closedOperatorParticipationIds,
        reportVersionId: latest.id,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "completeShiftOver" });
  }
}

/**
 * Create a reopen request (session must be SHIFT_OVER).
 */
async function requestShiftSessionReopen(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const requestedByUserId = normalizePositiveInt(
    input?.requestedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The requesting user is required.",
  );
  const reopenReason = normalizeChangeReason(input?.reopenReason ?? input?.reason, {
    required: true,
    message: "A reason is required to request reopen of a closed shift session.",
  });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
      if (!session) {
        throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
      }
      if (session.status !== SESSION_STATUS.SHIFT_OVER) {
        throw domainError(
          409,
          "REOPEN_REQUIRES_SHIFT_OVER",
          "Reopen can only be requested for a session that has completed Shift Over.",
        );
      }

      const openOther = await findOpenSessionForMachine(tx, session.machineId);
      if (openOther && openOther.id !== sessionId) {
        throw domainError(
          409,
          "REOPEN_BLOCKED_NEXT_SESSION",
          "Reopen is not allowed after another shift session has started on this machine.",
          { blockingSessionId: openOther.id, shiftSessionNo: openOther.shiftSessionNo },
        );
      }
      const later = await tx.machineShiftSession.findFirst({
        where: { machineId: session.machineId, id: { gt: sessionId } },
        orderBy: { id: "asc" },
      });
      if (later) {
        throw domainError(
          409,
          "REOPEN_BLOCKED_NEXT_SESSION",
          "Reopen is not allowed after another shift session has started on this machine.",
          { blockingSessionId: later.id, shiftSessionNo: later.shiftSessionNo },
        );
      }

      const existingRequested = await tx.shiftSessionReopenRequest.findFirst({
        where: { sessionId, status: REOPEN_STATUS.REQUESTED },
        orderBy: { id: "desc" },
      });
      if (existingRequested) {
        return { request: existingRequested, created: false, session };
      }

      const now = new Date();
      const request = await tx.shiftSessionReopenRequest.create({
        data: {
          sessionId,
          requestedByUserId,
          requestedAt: now,
          reopenReason,
          status: REOPEN_STATUS.REQUESTED,
        },
      });
      return { request, created: true, session };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "requestShiftSessionReopen" });
  }
}

/**
 * Deny reopen — session stays SHIFT_OVER.
 */
async function denyShiftSessionReopen(input, db = prisma) {
  const requestId = normalizePositiveInt(input?.requestId, "REQUEST_ID_INVALID", "Reopen request is required.");
  const decidedByUserId = normalizePositiveInt(
    input?.decidedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The deciding user is required.",
  );
  const decisionNote = normalizeDecisionNote(input?.decisionNote);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const request = await tx.shiftSessionReopenRequest.findUnique({ where: { id: requestId } });
      if (!request) {
        throw domainError(404, "REOPEN_REQUEST_NOT_FOUND", "Reopen request was not found.");
      }
      if (request.status === REOPEN_STATUS.DENIED) {
        return { request, denied: false, alreadyDenied: true };
      }
      if (request.status === REOPEN_STATUS.APPROVED) {
        throw domainError(409, "REOPEN_ALREADY_APPROVED", "This reopen request was already approved.");
      }
      if (request.status !== REOPEN_STATUS.REQUESTED) {
        throw domainError(409, "REOPEN_NOT_REQUESTED", "Only a pending reopen request can be denied.");
      }

      const now = new Date();
      const updated = await tx.shiftSessionReopenRequest.update({
        where: { id: requestId },
        data: {
          status: REOPEN_STATUS.DENIED,
          decidedByUserId,
          decidedAt: now,
          decisionNote,
        },
      });
      const session = await tx.machineShiftSession.findUnique({ where: { id: request.sessionId } });
      return { request: updated, denied: true, alreadyDenied: false, session };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "denyShiftSessionReopen" });
  }
}

/**
 * Approve reopen — restore OPEN, clear end fields, increment reopenCount,
 * create new DRAFT from verified version; never mutate VERIFIED.
 */
async function approveShiftSessionReopen(input, db = prisma) {
  const requestId = normalizePositiveInt(input?.requestId, "REQUEST_ID_INVALID", "Reopen request is required.");
  const decidedByUserId = normalizePositiveInt(
    input?.decidedByUserId ?? input?.actorUserId,
    "USER_ID_INVALID",
    "The deciding user is required.",
  );
  const decisionNote = normalizeDecisionNote(input?.decisionNote);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const request = await tx.shiftSessionReopenRequest.findUnique({ where: { id: requestId } });
      if (!request) {
        throw domainError(404, "REOPEN_REQUEST_NOT_FOUND", "Reopen request was not found.");
      }

      if (request.status === REOPEN_STATUS.APPROVED) {
        const session = await tx.machineShiftSession.findUnique({ where: { id: request.sessionId } });
        return { request, approved: false, alreadyApproved: true, session, draftVersion: null };
      }
      if (request.status === REOPEN_STATUS.DENIED) {
        throw domainError(409, "REOPEN_ALREADY_DENIED", "This reopen request was already denied.");
      }
      if (request.status !== REOPEN_STATUS.REQUESTED) {
        throw domainError(409, "REOPEN_NOT_REQUESTED", "Only a pending reopen request can be approved.");
      }

      const session = await tx.machineShiftSession.findUnique({ where: { id: request.sessionId } });
      if (!session) {
        throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
      }
      if (session.status !== SESSION_STATUS.SHIFT_OVER) {
        throw domainError(
          409,
          "REOPEN_REQUIRES_SHIFT_OVER",
          "Reopen can only be approved for a session that has completed Shift Over.",
        );
      }

      const openOther = await findOpenSessionForMachine(tx, session.machineId);
      if (openOther) {
        throw domainError(
          409,
          "REOPEN_BLOCKED_NEXT_SESSION",
          "Reopen is not allowed after another shift session has started on this machine.",
          { blockingSessionId: openOther.id, shiftSessionNo: openOther.shiftSessionNo },
        );
      }
      const later = await tx.machineShiftSession.findFirst({
        where: { machineId: session.machineId, id: { gt: session.id } },
        orderBy: { id: "asc" },
      });
      if (later) {
        throw domainError(
          409,
          "REOPEN_BLOCKED_NEXT_SESSION",
          "Reopen is not allowed after another shift session has started on this machine.",
          { blockingSessionId: later.id, shiftSessionNo: later.shiftSessionNo },
        );
      }

      const report = await ensureShiftProductionReport(tx, session.id);
      const latest = await findLatestVersion(tx, report);
      if (!latest || latest.status !== REPORT_VERSION_STATUS.VERIFIED) {
        throw domainError(
          409,
          "REOPEN_REQUIRES_VERIFIED_REPORT",
          "Controlled reopen requires a verified shift report version to copy into a new draft.",
        );
      }

      const now = new Date();
      let restored;
      try {
        restored = await tx.machineShiftSession.update({
          where: { id: session.id },
          data: {
            status: SESSION_STATUS.OPEN,
            endedAt: null,
            endedByUserId: null,
            reopenCount: { increment: 1 },
          },
        });
      } catch (e) {
        if (e?.code === "P2002") {
          throw mapShiftSessionPersistenceError(e, { action: "startSession" });
        }
        throw e;
      }

      const draftVersion = await createDraftVersionFrom(tx, report, latest);

      const operatorRestore = await restoreParticipationsAfterReopen(tx, restored, {
        actorUserId: decidedByUserId,
        at: now,
      });

      const updatedRequest = await tx.shiftSessionReopenRequest.update({
        where: { id: requestId },
        data: {
          status: REOPEN_STATUS.APPROVED,
          decidedByUserId,
          decidedAt: now,
          decisionNote,
        },
      });

      return {
        request: updatedRequest,
        approved: true,
        alreadyApproved: false,
        session: restored,
        draftVersion,
        verifiedVersionId: latest.id,
        restoredOperatorParticipations: operatorRestore.restored,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "approveShiftSessionReopen" });
  }
}

module.exports = {
  REOPEN_STATUS,
  completeShiftOver,
  requestShiftSessionReopen,
  approveShiftSessionReopen,
  denyShiftSessionReopen,
};
