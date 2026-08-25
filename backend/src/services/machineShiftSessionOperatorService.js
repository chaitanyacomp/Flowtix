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

/** System leave reason stamped on Shift Over (preserved in history). */
const SYSTEM_LEAVE_REASON = Object.freeze({
  SHIFT_OVER: "SHIFT_OVER",
});

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

/**
 * Active participations for operators (leftAt null), optionally excluding one session.
 */
async function findActiveParticipationsForOperators(tx, operatorIds, opts = {}) {
  const ids = [...new Set((operatorIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const where = {
    operatorId: { in: ids },
    leftAt: null,
  };
  if (opts.excludeSessionId != null) {
    where.sessionId = { not: Number(opts.excludeSessionId) };
  }
  return tx.machineShiftSessionOperator.findMany({
    where,
    include: {
      session: {
        select: {
          id: true,
          shiftSessionNo: true,
          status: true,
          machineId: true,
          machine: { select: { id: true, machineCode: true, machineName: true } },
        },
      },
    },
    orderBy: [{ id: "asc" }],
  });
}

function formatBusyMachineLabel(row) {
  const m = row?.session?.machine;
  if (!m) return null;
  const name = String(m.machineName || "").trim();
  const code = String(m.machineCode || "").trim();
  if (name && code) return `${name} (${code})`;
  return name || code || null;
}

/**
 * Reject when any operator already has leftAt=null on another session.
 */
async function assertOperatorsAvailableAcrossMachines(tx, operatorIds, opts = {}) {
  const busy = await findActiveParticipationsForOperators(tx, operatorIds, opts);
  if (!busy.length) return;

  const first = busy[0];
  const machineLabel = formatBusyMachineLabel(first);
  const sessionNo = first.session?.shiftSessionNo ? String(first.session.shiftSessionNo) : null;
  let message =
    "This operator is already active on another open shift session. They must leave that machine before joining here.";
  if (machineLabel && sessionNo) {
    message = `This operator is already active on ${machineLabel} (${sessionNo}). They must leave that machine before joining here.`;
  } else if (machineLabel) {
    message = `This operator is already active on ${machineLabel}. They must leave that machine before joining here.`;
  } else if (sessionNo) {
    message = `This operator is already active on shift ${sessionNo}. They must leave that machine before joining here.`;
  }

  throw domainError(409, "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE", message, {
    operatorId: first.operatorId,
    sessionId: first.sessionId,
    shiftSessionNo: sessionNo,
    machineId: first.session?.machineId ?? first.session?.machine?.id ?? null,
    machineCode: first.session?.machine?.machineCode ?? null,
    machineName: first.session?.machine?.machineName ?? null,
    machineLabel,
  });
}

/**
 * List operators currently active (leftAt null) — for Start/Join dropdown exclusion.
 */
async function listBusyOperatorsAcrossOpenSessions(db = prisma) {
  const rows = await db.machineShiftSessionOperator.findMany({
    where: { leftAt: null },
    include: {
      session: {
        select: {
          id: true,
          shiftSessionNo: true,
          status: true,
          machineId: true,
          machine: { select: { id: true, machineCode: true, machineName: true } },
        },
      },
      operator: { select: { id: true, operatorCode: true, operatorName: true } },
    },
    orderBy: [{ operatorId: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    operatorId: r.operatorId,
    operatorCode: r.operator?.operatorCode ?? null,
    operatorName: r.operator?.operatorName ?? null,
    sessionId: r.sessionId,
    shiftSessionNo: r.session?.shiftSessionNo ?? null,
    sessionStatus: r.session?.status ?? null,
    machineId: r.session?.machineId ?? r.session?.machine?.id ?? null,
    machineCode: r.session?.machine?.machineCode ?? null,
    machineName: r.session?.machine?.machineName ?? null,
    machineLabel: formatBusyMachineLabel(r),
  }));
}

/**
 * Close all active participations on a session (Shift Over). History preserved.
 */
async function closeActiveParticipationsForShiftOver(tx, sessionId, { actorUserId, at } = {}) {
  const now = at instanceof Date ? at : new Date();
  const actives = await listActiveParticipations(tx, sessionId);
  const closedIds = [];
  for (const row of actives) {
    await tx.machineShiftSessionOperator.update({
      where: { id: row.id },
      data: {
        leftAt: now,
        joinedLeaveReason: SYSTEM_LEAVE_REASON.SHIFT_OVER,
        changedByUserId: actorUserId ?? null,
        changedAt: now,
      },
    });
    closedIds.push(row.id);
  }
  return closedIds;
}

/**
 * After controlled reopen: append-only re-seed active rows for operators closed by SHIFT_OVER.
 */
async function restoreParticipationsAfterReopen(tx, session, { actorUserId, at } = {}) {
  const now = at instanceof Date ? at : new Date();
  const sessionId = session.id;
  const closed = await tx.machineShiftSessionOperator.findMany({
    where: {
      sessionId,
      leftAt: { not: null },
      joinedLeaveReason: SYSTEM_LEAVE_REASON.SHIFT_OVER,
    },
    orderBy: [{ id: "desc" }],
  });

  /** @type {Map<number, { operatorId: number, isPrimarySnapshot: boolean }>} */
  const byOp = new Map();
  for (const row of closed) {
    if (!byOp.has(row.operatorId)) {
      byOp.set(row.operatorId, {
        operatorId: row.operatorId,
        isPrimarySnapshot: Boolean(row.isPrimarySnapshot) || row.operatorId === session.primaryOperatorId,
      });
    }
  }

  if (session.primaryOperatorId && byOp.has(session.primaryOperatorId)) {
    byOp.get(session.primaryOperatorId).isPrimarySnapshot = true;
  } else if (session.primaryOperatorId && !byOp.has(session.primaryOperatorId)) {
    byOp.set(session.primaryOperatorId, {
      operatorId: session.primaryOperatorId,
      isPrimarySnapshot: true,
    });
  }

  const alreadyActive = await listActiveParticipations(tx, sessionId);
  const alreadyIds = new Set(alreadyActive.map((r) => r.operatorId));
  const toRestore = [...byOp.values()].filter((o) => !alreadyIds.has(o.operatorId));
  if (!toRestore.length) return { restored: [], skipped: alreadyActive.length };

  await assertOperatorsAvailableAcrossMachines(
    tx,
    toRestore.map((o) => o.operatorId),
    { excludeSessionId: sessionId },
  );

  let primaryAssigned = alreadyActive.some((r) => r.isPrimarySnapshot);
  const created = [];
  for (const o of toRestore) {
    let asPrimary = Boolean(o.isPrimarySnapshot) && !primaryAssigned;
    if (asPrimary) primaryAssigned = true;
    if (!asPrimary && o.operatorId === session.primaryOperatorId && !primaryAssigned) {
      asPrimary = true;
      primaryAssigned = true;
    }
    const row = await tx.machineShiftSessionOperator.create({
      data: {
        sessionId,
        operatorId: o.operatorId,
        isPrimarySnapshot: asPrimary,
        joinedAt: now,
        leftAt: null,
        joinedLeaveReason: "REOPEN_RESTORE",
        changedByUserId: actorUserId ?? null,
        changedAt: now,
      },
    });
    created.push(row);
  }

  const after = await listActiveParticipations(tx, sessionId);
  if (!after.some((r) => r.isPrimarySnapshot) && session.primaryOperatorId) {
    const target = after.find((r) => r.operatorId === session.primaryOperatorId);
    if (target) {
      await tx.machineShiftSessionOperator.update({
        where: { id: target.id },
        data: { isPrimarySnapshot: true, changedAt: now, changedByUserId: actorUserId ?? null },
      });
    }
  }

  return { restored: created, skipped: alreadyActive.length };
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

      await assertOperatorsAvailableAcrossMachines(tx, [operatorId], { excludeSessionId: sessionId });

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

      const alreadyOnSession = actives.some((r) => r.operatorId === newPrimaryOperatorId);
      if (!alreadyOnSession) {
        await assertOperatorsAvailableAcrossMachines(tx, [newPrimaryOperatorId], {
          excludeSessionId: sessionId,
        });
      }

      const now = new Date();
      const created = [];

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
  SYSTEM_LEAVE_REASON,
  listActiveParticipations,
  findActiveParticipation,
  findActiveParticipationsForOperators,
  assertOperatorsAvailableAcrossMachines,
  listBusyOperatorsAcrossOpenSessions,
  closeActiveParticipationsForShiftOver,
  restoreParticipationsAfterReopen,
  activePrimaryFromRows,
  joinSessionOperator,
  leaveSessionOperator,
  changePrimaryOperator,
};
