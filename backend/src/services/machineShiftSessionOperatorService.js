/**
 * Machine Shift Session — operator join / leave / change primary (append-only history).
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
} = require("./machineShiftSessionErrors");
const {
  withShiftSessionTx,
  requireOpenSession,
  assertOperatorsActive,
  normalizePositiveInt,
  normalizeOptionalUserId,
  normalizeChangeReason,
} = require("./machineShiftSessionService");

async function listActiveParticipations(tx, sessionId) {
  return tx.machineShiftSessionOperator.findMany({
    where: { sessionId, leftAt: null },
    orderBy: [{ id: "asc" }],
  });
}

async function findActiveParticipation(tx, sessionId, operatorId) {
  return tx.machineShiftSessionOperator.findFirst({
    where: { sessionId, operatorId, leftAt: null },
    orderBy: { id: "desc" },
  });
}

function activePrimaryFromRows(rows, sessionPrimaryOperatorId) {
  const flagged = rows.filter((r) => r.isPrimarySnapshot && r.leftAt == null);
  if (flagged.length > 1) {
    throw domainError(
      409,
      "MULTIPLE_PRIMARY_OPERATORS",
      "This shift session has more than one active primary operator. Contact Admin to repair the session.",
    );
  }
  if (flagged.length === 1) return flagged[0];
  const bySession = rows.find((r) => r.leftAt == null && r.operatorId === sessionPrimaryOperatorId);
  return bySession || null;
}

/**
 * Join an operator to an open session. Idempotent if already active (returns existing row).
 */
async function joinSessionOperator(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const operatorId = normalizePositiveInt(input?.operatorId, "OPERATOR_ID_INVALID", "Operator is required.");
  const actorUserId = normalizeOptionalUserId(input?.changedByUserId ?? input?.actorUserId);
  const changeReason = normalizeChangeReason(input?.changeReason ?? input?.joinedLeaveReason);
  const asPrimary = Boolean(input?.isPrimary);

  if (asPrimary) {
    throw domainError(
      400,
      "USE_CHANGE_PRIMARY",
      "To make an operator primary, use change primary — do not join them as primary directly.",
    );
  }

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);
      await assertOperatorsActive(tx, [operatorId]);

      const existing = await findActiveParticipation(tx, sessionId, operatorId);
      if (existing) {
        return { participation: existing, created: false, session };
      }

      const now = new Date();
      const participation = await tx.machineShiftSessionOperator.create({
        data: {
          sessionId,
          operatorId,
          isPrimarySnapshot: false,
          joinedAt: now,
          leftAt: null,
          joinedLeaveReason: changeReason,
          changedByUserId: actorUserId,
          changedAt: now,
        },
      });
      return { participation, created: true, session };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "joinOperator" });
  }
}

/**
 * Leave an operator. Never leaves the session without an active primary.
 * Idempotent if the operator has no active participation.
 */
async function leaveSessionOperator(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const operatorId = normalizePositiveInt(input?.operatorId, "OPERATOR_ID_INVALID", "Operator is required.");
  const actorUserId = normalizeOptionalUserId(input?.changedByUserId ?? input?.actorUserId);
  const changeReason = normalizeChangeReason(input?.changeReason ?? input?.joinedLeaveReason, {
    required: true,
    message: "A reason is required when an operator leaves the shift.",
  });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);
      const active = await findActiveParticipation(tx, sessionId, operatorId);
      if (!active) {
        const last = await tx.machineShiftSessionOperator.findFirst({
          where: { sessionId, operatorId, leftAt: { not: null } },
          orderBy: { leftAt: "desc" },
        });
        return { participation: last, left: false, alreadyLeft: true, session };
      }

      const actives = await listActiveParticipations(tx, sessionId);
      const primaryRow = activePrimaryFromRows(actives, session.primaryOperatorId);
      const isPrimary =
        Boolean(active.isPrimarySnapshot) ||
        (primaryRow && primaryRow.id === active.id) ||
        operatorId === session.primaryOperatorId;

      if (isPrimary) {
        throw domainError(
          409,
          "PRIMARY_OPERATOR_CANNOT_LEAVE",
          "Change the primary operator before removing them from this shift session.",
        );
      }

      const now = new Date();
      const participation = await tx.machineShiftSessionOperator.update({
        where: { id: active.id },
        data: {
          leftAt: now,
          joinedLeaveReason: changeReason,
          changedByUserId: actorUserId,
          changedAt: now,
        },
      });
      return { participation, left: true, alreadyLeft: false, session };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "leaveOperator" });
  }
}

/**
 * Change primary operator safely (append-only participation rows; updates session.primaryOperatorId).
 * Never allows more than one active primary; never leaves session without a primary.
 *
 * @param {{
 *   sessionId: number,
 *   newPrimaryOperatorId: number,
 *   changeReason: string,
 *   actorUserId?: number|null,
 *   keepPreviousPrimary?: boolean,
 * }} input
 */
async function changePrimaryOperator(input, db = prisma) {
  const sessionId = normalizePositiveInt(input?.sessionId, "SESSION_ID_INVALID", "Shift session is required.");
  const newPrimaryOperatorId = normalizePositiveInt(
    input?.newPrimaryOperatorId ?? input?.operatorId,
    "OPERATOR_ID_INVALID",
    "New primary operator is required.",
  );
  const actorUserId = normalizeOptionalUserId(input?.changedByUserId ?? input?.actorUserId);
  const changeReason = normalizeChangeReason(input?.changeReason ?? input?.joinedLeaveReason, {
    required: true,
    message: "A reason is required when changing the primary operator.",
  });
  const keepPreviousPrimary = input?.keepPreviousPrimary !== false;

  try {
    return await withShiftSessionTx(db, async (tx) => {
      const session = await requireOpenSession(tx, sessionId);
      await assertOperatorsActive(tx, [newPrimaryOperatorId]);

      const actives = await listActiveParticipations(tx, sessionId);
      const currentPrimary = activePrimaryFromRows(actives, session.primaryOperatorId);

      if (currentPrimary && currentPrimary.operatorId === newPrimaryOperatorId) {
        return {
          session,
          previousPrimaryOperatorId: currentPrimary.operatorId,
          primaryOperatorId: newPrimaryOperatorId,
          changed: false,
          participations: actives,
        };
      }

      if (!currentPrimary) {
        throw domainError(
          409,
          "PRIMARY_OPERATOR_MISSING",
          "This shift session has no active primary operator. Contact Admin to repair the session before changing primary.",
        );
      }

      const now = new Date();
      const created = [];

      // Close current primary participation (history preserved).
      await tx.machineShiftSessionOperator.update({
        where: { id: currentPrimary.id },
        data: {
          leftAt: now,
          joinedLeaveReason: changeReason,
          changedByUserId: actorUserId,
          changedAt: now,
        },
      });

      if (keepPreviousPrimary && currentPrimary.operatorId !== newPrimaryOperatorId) {
        const secondary = await tx.machineShiftSessionOperator.create({
          data: {
            sessionId,
            operatorId: currentPrimary.operatorId,
            isPrimarySnapshot: false,
            joinedAt: now,
            leftAt: null,
            joinedLeaveReason: changeReason,
            changedByUserId: actorUserId,
            changedAt: now,
          },
        });
        created.push(secondary);
      }

      const existingNew = actives.find((r) => r.operatorId === newPrimaryOperatorId && r.id !== currentPrimary.id);
      if (existingNew && existingNew.leftAt == null) {
        await tx.machineShiftSessionOperator.update({
          where: { id: existingNew.id },
          data: {
            leftAt: now,
            joinedLeaveReason: changeReason,
            changedByUserId: actorUserId,
            changedAt: now,
          },
        });
      }

      const primaryRow = await tx.machineShiftSessionOperator.create({
        data: {
          sessionId,
          operatorId: newPrimaryOperatorId,
          isPrimarySnapshot: true,
          joinedAt: now,
          leftAt: null,
          joinedLeaveReason: changeReason,
          changedByUserId: actorUserId,
          changedAt: now,
        },
      });
      created.push(primaryRow);

      const updatedSession = await tx.machineShiftSession.update({
        where: { id: sessionId },
        data: { primaryOperatorId: newPrimaryOperatorId },
      });

      const after = await listActiveParticipations(tx, sessionId);
      const primaries = after.filter((r) => r.isPrimarySnapshot);
      if (primaries.length !== 1) {
        throw domainError(
          409,
          "PRIMARY_OPERATOR_INVARIANT",
          "Could not set a single primary operator for this shift session. Please try again.",
        );
      }
      if (!after.some((r) => r.operatorId === newPrimaryOperatorId && r.isPrimarySnapshot)) {
        throw domainError(
          409,
          "PRIMARY_OPERATOR_INVARIANT",
          "Could not set a single primary operator for this shift session. Please try again.",
        );
      }

      return {
        session: updatedSession,
        previousPrimaryOperatorId: currentPrimary.operatorId,
        primaryOperatorId: newPrimaryOperatorId,
        changed: true,
        participations: after,
        createdParticipations: created,
      };
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "changePrimary" });
  }
}

module.exports = {
  listActiveParticipations,
  findActiveParticipation,
  activePrimaryFromRows,
  joinSessionOperator,
  leaveSessionOperator,
  changePrimaryOperator,
};
