/**
 * Machine Shift Session — downtime pause / resume / continue across shifts.
 * Duration is always derived from server timestamps (never client-provided).
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
  DOWNTIME_REASONS,
} = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  requireOpenSession,
  normalizePositiveInt,
  normalizeOptionalUserId,
} = require("./machineShiftSessionService");
const { SEGMENT_STATUS, findActiveRunSegmentForMachine } = require("./machineShiftSessionRunSegmentService");

function normalizeDowntimeReason(value) {
  const key = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!DOWNTIME_REASONS.has(key)) {
    throw domainError(
      400,
      "DOWNTIME_REASON_INVALID",
      "Choose a valid downtime reason (for example machine breakdown or waiting for RM).",
    );
  }
  return key;
}

function normalizeRemarks(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 2000) : null;
}

/** Whole minutes from timestamps; never trust client duration. */
function durationMinutesFromTimestamps(startAt, endAt) {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const end = endAt instanceof Date ? endAt : new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

async function findOpenDowntimeSegmentForMachine(tx, machineId) {
  return tx.machineShiftDowntimeSegment.findFirst({
    where: {
      segmentEndAt: null,
      incident: { machineId },
    },
    include: {
      incident: true,
    },
    orderBy: { id: "desc" },
  });
}

async function findOpenDowntimeIncidentForMachine(tx, machineId) {
  return tx.machineShiftDowntimeIncident.findFirst({
    where: { machineId, endedAt: null },
    orderBy: { id: "desc" },
  });
}

/**
 * Pause an active run: create downtime incident + shift-wise downtime segment.
 * Keeps the run segment ACTIVE (paused); does not write ProductionEntry.
 */
async function pauseForDowntime(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const reason = normalizeDowntimeReason(input?.reason ?? input?.reasonCode);
  const actorUserId = normalizeOptionalUserId(input?.startedByUserId ?? input?.actorUserId);
  const remarks = normalizeRemarks(input?.remarks);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);

      const openSeg = await findOpenDowntimeSegmentForMachine(tx, session.machineId);
      if (openSeg) {
        if (openSeg.sessionId === sessionId && openSeg.incident?.endedAt == null) {
          return {
            incident: openSeg.incident,
            downtimeSegment: openSeg,
            created: false,
            session,
            durationMinutes: null,
          };
        }
        throw domainError(
          409,
          "DOWNTIME_ALREADY_OPEN",
          "This machine already has an open downtime pause. Resume or continue it before starting another.",
          { incidentId: openSeg.incidentId, downtimeSegmentId: openSeg.id },
        );
      }

      const activeRun = await findActiveRunSegmentForMachine(tx, session.machineId);
      if (!activeRun || activeRun.sessionId !== sessionId) {
        throw domainError(
          409,
          "NO_ACTIVE_RUN_TO_PAUSE",
          "Start an active production run on this shift before recording downtime.",
        );
      }
      if (activeRun.status !== SEGMENT_STATUS.ACTIVE) {
        throw domainError(
          409,
          "NO_ACTIVE_RUN_TO_PAUSE",
          "Start an active production run on this shift before recording downtime.",
        );
      }

      const now = new Date();
      const incident = await tx.machineShiftDowntimeIncident.create({
        data: {
          machineId: session.machineId,
          runSegmentId: activeRun.id,
          reason,
          startedAt: now,
          endedAt: null,
          startedByUserId: actorUserId,
          remarks,
        },
      });

      const downtimeSegment = await tx.machineShiftDowntimeSegment.create({
        data: {
          sessionId,
          incidentId: incident.id,
          segmentStartAt: now,
          segmentEndAt: null,
          remarks,
        },
      });

      return {
        incident,
        downtimeSegment,
        created: true,
        session,
        runSegment: activeRun,
        durationMinutes: null,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "pauseForDowntime" });
  }
}

/**
 * Resume: close current open downtime segment and resolve the incident.
 * Duration is calculated from timestamps only.
 */
async function resumeFromDowntime(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(input?.endedByUserId ?? input?.actorUserId);
  const remarks = normalizeRemarks(input?.remarks);
  const incidentId =
    input?.incidentId == null || input.incidentId === ""
      ? null
      : normalizePositiveInt(input.incidentId, "INCIDENT_ID_INVALID", "Downtime incident is not valid.");

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);

      let openSeg = null;
      if (incidentId != null) {
        openSeg = await tx.machineShiftDowntimeSegment.findFirst({
          where: { sessionId, incidentId, segmentEndAt: null },
          include: { incident: true },
          orderBy: { id: "desc" },
        });
      } else {
        openSeg = await findOpenDowntimeSegmentForMachine(tx, session.machineId);
        if (openSeg && openSeg.sessionId !== sessionId) {
          throw domainError(
            409,
            "DOWNTIME_ON_OTHER_SESSION",
            "Open downtime belongs to another shift session. Continue it into this session or resume on the correct session.",
          );
        }
      }

      if (!openSeg) {
        const closedIncident =
          incidentId != null
            ? await tx.machineShiftDowntimeIncident.findUnique({ where: { id: incidentId } })
            : await tx.machineShiftDowntimeIncident.findFirst({
                where: { machineId: session.machineId, endedAt: { not: null } },
                orderBy: { endedAt: "desc" },
              });
        if (closedIncident?.endedAt) {
          const lastSeg = await tx.machineShiftDowntimeSegment.findFirst({
            where: { incidentId: closedIncident.id, sessionId },
            orderBy: { id: "desc" },
          });
          const durationMinutes = lastSeg?.segmentEndAt
            ? durationMinutesFromTimestamps(lastSeg.segmentStartAt, lastSeg.segmentEndAt)
            : durationMinutesFromTimestamps(closedIncident.startedAt, closedIncident.endedAt);
          return {
            incident: closedIncident,
            downtimeSegment: lastSeg,
            resumed: false,
            alreadyResumed: true,
            session,
            durationMinutes,
          };
        }
        throw domainError(409, "NO_OPEN_DOWNTIME", "There is no open downtime pause to resume on this shift.");
      }

      if (openSeg.incident && openSeg.incident.machineId !== session.machineId) {
        throw domainError(409, "DOWNTIME_MACHINE_MISMATCH", "Downtime does not belong to this machine.");
      }

      const now = new Date();
      const downtimeSegment = await tx.machineShiftDowntimeSegment.update({
        where: { id: openSeg.id },
        data: {
          segmentEndAt: now,
          ...(remarks != null ? { remarks } : {}),
        },
      });

      const incident = await tx.machineShiftDowntimeIncident.update({
        where: { id: openSeg.incidentId },
        data: {
          endedAt: now,
          endedByUserId: actorUserId,
          ...(remarks != null ? { remarks } : {}),
        },
      });

      const segmentDuration = durationMinutesFromTimestamps(downtimeSegment.segmentStartAt, downtimeSegment.segmentEndAt);
      const incidentDuration = durationMinutesFromTimestamps(incident.startedAt, incident.endedAt);

      return {
        incident,
        downtimeSegment,
        resumed: true,
        alreadyResumed: false,
        session,
        durationMinutes: segmentDuration,
        incidentDurationMinutes: incidentDuration,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "resumeFromDowntime" });
  }
}

/**
 * Continue an unresolved downtime incident into a new open shift session via a new segment.
 * Closes the previous session's open segment (does not rewrite its start); leaves incident open.
 */
async function continueDowntimeIntoSession(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const incidentId = normalizePositiveInt(input?.incidentId, "INCIDENT_ID_INVALID", "Downtime incident is required.");
  const remarks = normalizeRemarks(input?.remarks);

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);
      const incident = await tx.machineShiftDowntimeIncident.findUnique({ where: { id: incidentId } });
      if (!incident) {
        throw domainError(404, "DOWNTIME_INCIDENT_NOT_FOUND", "Downtime incident was not found.");
      }
      if (incident.machineId !== session.machineId) {
        throw domainError(
          409,
          "DOWNTIME_MACHINE_MISMATCH",
          "This downtime belongs to a different machine than the open shift session.",
        );
      }
      if (incident.endedAt != null) {
        throw domainError(
          409,
          "DOWNTIME_ALREADY_RESOLVED",
          "This downtime is already resolved and cannot continue into another shift.",
        );
      }

      const existingOnSession = await tx.machineShiftDowntimeSegment.findFirst({
        where: { incidentId, sessionId },
        orderBy: { id: "desc" },
      });

      if (existingOnSession) {
        if (existingOnSession.segmentEndAt == null) {
          return {
            incident,
            downtimeSegment: existingOnSession,
            created: false,
            continued: false,
            session,
          };
        }
        throw domainError(
          409,
          "DOWNTIME_SEGMENT_EXISTS",
          "A downtime segment for this incident already exists on this shift session.",
        );
      }

      const now = new Date();

      // Close prior open segment(s) for this incident on other sessions — never rewrite start/history.
      const priorOpen = await tx.machineShiftDowntimeSegment.findMany({
        where: { incidentId, segmentEndAt: null, sessionId: { not: sessionId } },
      });
      for (const seg of priorOpen) {
        await tx.machineShiftDowntimeSegment.update({
          where: { id: seg.id },
          data: { segmentEndAt: now },
        });
      }

      // Also block if another open segment exists on this machine for a different incident.
      const otherOpen = await findOpenDowntimeSegmentForMachine(tx, session.machineId);
      if (otherOpen && otherOpen.incidentId !== incidentId) {
        throw domainError(
          409,
          "DOWNTIME_ALREADY_OPEN",
          "This machine already has an open downtime pause. Resume it before continuing another incident.",
        );
      }

      const downtimeSegment = await tx.machineShiftDowntimeSegment.create({
        data: {
          sessionId,
          incidentId,
          segmentStartAt: now,
          segmentEndAt: null,
          remarks,
        },
      });

      return {
        incident,
        downtimeSegment,
        created: true,
        continued: true,
        session,
        closedPriorSegmentIds: priorOpen.map((s) => s.id),
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "continueDowntime" });
  }
}

module.exports = {
  normalizeDowntimeReason,
  durationMinutesFromTimestamps,
  findOpenDowntimeSegmentForMachine,
  findOpenDowntimeIncidentForMachine,
  pauseForDowntime,
  resumeFromDowntime,
  continueDowntimeIntoSession,
};
