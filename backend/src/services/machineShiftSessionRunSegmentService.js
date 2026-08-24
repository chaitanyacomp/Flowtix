/**
 * Machine Shift Session — run segment start / close (no ProductionEntry writes).
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
  WO_NOT_USABLE_FOR_SHIFT_RUN,
} = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  requireOpenSession,
  normalizePositiveInt,
  normalizeOptionalUserId,
  normalizeChangeReason,
} = require("./machineShiftSessionService");

const SEGMENT_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
});

/** Controlled system close reasons (Step 2B+ may pass these; never free-form). */
const SYSTEM_CLOSE_REASON = Object.freeze({
  SHIFT_OVER: "SYSTEM:SHIFT_OVER — run closed because the shift ended",
  SUPERSEDED_BY_NEW_RUN: "SYSTEM:SUPERSEDED_BY_NEW_RUN — run closed before starting another on this machine",
  SESSION_REPAIR: "SYSTEM:SESSION_REPAIR — run closed during controlled session repair",
});

const SYSTEM_CLOSE_REASON_KEYS = Object.freeze(new Set(Object.keys(SYSTEM_CLOSE_REASON)));

/**
 * Resolve close reason: manual requires a user reason; system uses a controlled constant.
 * @param {{
 *   closeReason?: string,
 *   endReason?: string,
 *   changeReason?: string,
 *   reason?: string,
 *   systemReason?: string,
 *   closureSource?: string,
 * }} input
 * @returns {{ closeReason: string, closureSource: 'MANUAL'|'SYSTEM' }}
 */
function resolveRunSegmentCloseReason(input) {
  const sourceRaw = String(input?.closureSource ?? "").trim().toUpperCase();
  const systemKey = String(input?.systemReason ?? "")
    .trim()
    .toUpperCase();

  if (sourceRaw === "SYSTEM" || SYSTEM_CLOSE_REASON_KEYS.has(systemKey)) {
    if (!SYSTEM_CLOSE_REASON_KEYS.has(systemKey)) {
      throw domainError(
        400,
        "SYSTEM_CLOSE_REASON_INVALID",
        "System closure must use a controlled system reason.",
      );
    }
    return { closeReason: SYSTEM_CLOSE_REASON[systemKey], closureSource: "SYSTEM" };
  }

  const closeReason = normalizeChangeReason(
    input?.closeReason ?? input?.endReason ?? input?.changeReason ?? input?.reason,
    {
      required: true,
      message: "A reason is required when closing a production run segment.",
    },
  );
  return { closeReason, closureSource: "MANUAL" };
}

async function findActiveRunSegmentForMachine(tx, machineId) {
  return tx.machineShiftSessionRunSegment.findFirst({
    where: { machineId, status: SEGMENT_STATUS.ACTIVE },
    orderBy: { id: "desc" },
  });
}

/**
 * Validate WO / production run is usable for a shift run segment without changing production rules
 * (no entry gates, no start-confirmation enforcement here).
 */
async function assertWorkOrderRunUsable(tx, { workOrderId, runAllocationId, sessionMachineId }) {
  let resolvedWorkOrderId = workOrderId != null ? Number(workOrderId) : null;
  let allocation = null;

  if (runAllocationId != null) {
    const runId = normalizePositiveInt(runAllocationId, "RUN_ALLOCATION_ID_INVALID", "Production run is not valid.");
    allocation = await tx.workOrderProductionRunAllocation.findUnique({
      where: { id: runId },
      select: {
        id: true,
        workOrderId: true,
        machineId: true,
        isActive: true,
        runSequence: true,
      },
    });
    if (!allocation) {
      throw domainError(404, "RUN_ALLOCATION_NOT_FOUND", "Production run allocation was not found.");
    }
    if (allocation.isActive === false) {
      throw domainError(
        409,
        "RUN_ALLOCATION_INACTIVE",
        "This planned machine run is inactive and cannot be used on a shift session.",
      );
    }
    if (Number(allocation.machineId) !== Number(sessionMachineId)) {
      throw domainError(
        409,
        "RUN_ALLOCATION_MACHINE_MISMATCH",
        "This production run is planned for a different machine than the open shift session.",
      );
    }
    resolvedWorkOrderId = Number(allocation.workOrderId);
  }

  if (resolvedWorkOrderId == null || !Number.isInteger(resolvedWorkOrderId) || resolvedWorkOrderId <= 0) {
    throw domainError(
      400,
      "WORK_ORDER_OR_RUN_REQUIRED",
      "A work order or production run is required to start a shift run segment.",
    );
  }

  const wo = await tx.workOrder.findUnique({
    where: { id: resolvedWorkOrderId },
    select: { id: true, status: true, docNo: true },
  });
  if (!wo) {
    throw domainError(404, "WORK_ORDER_NOT_FOUND", "Work order was not found.");
  }
  const status = String(wo.status || "").toUpperCase();
  if (WO_NOT_USABLE_FOR_SHIFT_RUN.has(status)) {
    throw domainError(
      409,
      "WORK_ORDER_NOT_USABLE",
      `Work order ${wo.docNo || `#${wo.id}`} is ${status.replace(/_/g, " ").toLowerCase()} and cannot start a shift run.`,
    );
  }

  return {
    workOrderId: wo.id,
    runAllocationId: allocation ? allocation.id : null,
    workOrderDocNo: wo.docNo,
  };
}

/**
 * Start an ACTIVE run segment for the session machine. Only one ACTIVE segment per machine (DB + app check).
 * Does not create ProductionEntry records.
 */
async function startRunSegment(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(input?.segmentStartedByUserId ?? input?.actorUserId);
  const runAllocationId =
    input?.runAllocationId == null || input.runAllocationId === ""
      ? null
      : normalizePositiveInt(input.runAllocationId, "RUN_ALLOCATION_ID_INVALID", "Production run is not valid.");
  const workOrderId =
    input?.workOrderId == null || input.workOrderId === ""
      ? null
      : normalizePositiveInt(input.workOrderId, "WORK_ORDER_ID_INVALID", "Work order is not valid.");

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);

      const existingActive = await findActiveRunSegmentForMachine(tx, session.machineId);
      if (existingActive) {
        if (
          existingActive.sessionId === sessionId &&
          ((runAllocationId != null && existingActive.runAllocationId === runAllocationId) ||
            (runAllocationId == null &&
              workOrderId != null &&
              existingActive.workOrderId === workOrderId &&
              existingActive.runAllocationId == null))
        ) {
          return { segment: existingActive, created: false, session };
        }
        throw domainError(
          409,
          "ACTIVE_RUN_SEGMENT_EXISTS",
          "This machine already has an active production run on the shift. Close it before starting another.",
          { segmentId: existingActive.id, sessionId: existingActive.sessionId },
        );
      }

      const { assertShiftSessionProductionQtyUnlocked } = require("./machineShiftProductionQtyLockService");
      await assertShiftSessionProductionQtyUnlocked(tx, sessionId);

      const usable = await assertWorkOrderRunUsable(tx, {
        workOrderId,
        runAllocationId,
        sessionMachineId: session.machineId,
      });

      const priorCount = await tx.machineShiftSessionRunSegment.count({ where: { sessionId } });
      const segmentNo = priorCount + 1;
      const now = new Date();

      try {
        const segment = await tx.machineShiftSessionRunSegment.create({
          data: {
            sessionId,
            machineId: session.machineId,
            runAllocationId: usable.runAllocationId,
            workOrderId: usable.workOrderId,
            segmentNo,
            status: SEGMENT_STATUS.ACTIVE,
            segmentStartedAt: now,
            segmentStartedByUserId: actorUserId,
          },
        });
        return { segment, created: true, session };
      } catch (e) {
        throw mapShiftSessionPersistenceError(e, { action: "startRunSegment" });
      }
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "startRunSegment" });
  }
}

/**
 * Close the ACTIVE run segment. Persists closeReason, closedAt, closedByUserId.
 * Idempotent close does not overwrite original close audit fields.
 */
async function closeRunSegment(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const actorUserId = normalizeOptionalUserId(
    input?.closedByUserId ?? input?.segmentEndedByUserId ?? input?.actorUserId,
  );
  const { closeReason, closureSource } = resolveRunSegmentCloseReason(input);

  const segmentId =
    input?.segmentId == null || input.segmentId === ""
      ? null
      : normalizePositiveInt(input.segmentId, "SEGMENT_ID_INVALID", "Run segment is not valid.");

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);

      let segment = null;
      if (segmentId != null) {
        segment = await tx.machineShiftSessionRunSegment.findUnique({ where: { id: segmentId } });
        if (!segment || segment.sessionId !== sessionId) {
          throw domainError(404, "RUN_SEGMENT_NOT_FOUND", "Run segment was not found on this shift session.");
        }
        if (segment.status === SEGMENT_STATUS.CLOSED) {
          return {
            segment,
            closed: false,
            alreadyClosed: true,
            session,
            closureSource,
          };
        }
      } else {
        segment = await tx.machineShiftSessionRunSegment.findFirst({
          where: { sessionId, machineId: session.machineId, status: SEGMENT_STATUS.ACTIVE },
          orderBy: { id: "desc" },
        });
        if (!segment) {
          throw domainError(
            409,
            "NO_ACTIVE_RUN_SEGMENT",
            "There is no active production run segment to close on this shift.",
          );
        }
      }

      if (segment.status !== SEGMENT_STATUS.ACTIVE) {
        return {
          segment,
          closed: false,
          alreadyClosed: true,
          session,
          closureSource,
        };
      }

      const now = new Date();
      const closed = await tx.machineShiftSessionRunSegment.update({
        where: { id: segment.id },
        data: {
          status: SEGMENT_STATUS.CLOSED,
          closedAt: now,
          closedByUserId: actorUserId,
          closeReason,
        },
      });
      return {
        segment: closed,
        closed: true,
        alreadyClosed: false,
        session,
        closureSource,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "closeRunSegment" });
  }
}

module.exports = {
  SEGMENT_STATUS,
  SYSTEM_CLOSE_REASON,
  resolveRunSegmentCloseReason,
  findActiveRunSegmentForMachine,
  assertWorkOrderRunUsable,
  startRunSegment,
  closeRunSegment,
};
