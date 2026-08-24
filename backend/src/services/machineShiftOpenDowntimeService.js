/**
 * Read unresolved downtime for a machine (no mutation).
 */

const { prisma } = require("../utils/prisma");
const { domainError } = require("./machineShiftSessionErrors");
const {
  normalizePositiveInt,
  findOpenSessionForMachine,
  SESSION_STATUS,
} = require("./machineShiftSessionService");
const { findOpenDowntimeIncidentForMachine } = require("./machineShiftDowntimeService");

/**
 * @param {number} machineId
 * @param {import('@prisma/client').PrismaClient} [db]
 * @returns {Promise<object|null>}
 */
async function getOpenDowntimeForMachine(machineId, db = prisma) {
  const id = normalizePositiveInt(machineId, "MACHINE_ID_INVALID", "Machine is required.");

  const machine = await db.machine.findUnique({
    where: { id },
    select: { id: true, machineCode: true, machineName: true },
  });
  if (!machine) {
    throw domainError(404, "MACHINE_NOT_FOUND", "Machine was not found.");
  }

  const incident = await findOpenDowntimeIncidentForMachine(db, id);
  if (!incident) {
    return null;
  }

  const latestSegment = await db.machineShiftDowntimeSegment.findFirst({
    where: { incidentId: incident.id },
    orderBy: { id: "desc" },
    include: {
      session: {
        select: {
          id: true,
          shiftSessionNo: true,
          status: true,
          sessionDate: true,
        },
      },
    },
  });

  const openSession = await findOpenSessionForMachine(db, id);

  let canContinueIntoCurrentSession = false;
  if (openSession && incident.endedAt == null) {
    const segmentOnOpenSession = await db.machineShiftDowntimeSegment.findFirst({
      where: { incidentId: incident.id, sessionId: openSession.id },
      orderBy: { id: "desc" },
    });
    // Continue is for bringing prior-session downtime onto the current open session.
    canContinueIntoCurrentSession = !segmentOnOpenSession;
  }

  const continuedFromPriorShift =
    Boolean(latestSegment) &&
    latestSegment.sessionId != null &&
    (openSession == null || latestSegment.sessionId !== openSession.id) &&
    (latestSegment.session?.status === SESSION_STATUS.SHIFT_OVER ||
      latestSegment.segmentEndAt != null ||
      (openSession != null && latestSegment.sessionId !== openSession.id));

  return {
    incidentId: incident.id,
    reason: incident.reason,
    remarks: incident.remarks ?? null,
    startedAt: incident.startedAt,
    endedAt: incident.endedAt,
    machine: {
      id: machine.id,
      machineCode: machine.machineCode,
      machineName: machine.machineName,
    },
    latestSegment: latestSegment
      ? {
          id: latestSegment.id,
          sessionId: latestSegment.sessionId,
          shiftSessionNo: latestSegment.session?.shiftSessionNo ?? null,
          sessionStatus: latestSegment.session?.status ?? null,
          sessionDate: latestSegment.session?.sessionDate
            ? String(latestSegment.session.sessionDate).slice(0, 10)
            : null,
          segmentStartAt: latestSegment.segmentStartAt,
          segmentEndAt: latestSegment.segmentEndAt,
          remarks: latestSegment.remarks ?? null,
        }
      : null,
    currentOpenSessionId: openSession?.id ?? null,
    canContinueIntoCurrentSession,
    continuedFromPriorShift: Boolean(continuedFromPriorShift),
  };
}

module.exports = {
  getOpenDowntimeForMachine,
};
