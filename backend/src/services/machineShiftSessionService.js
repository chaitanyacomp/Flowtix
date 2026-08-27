/**
 * Machine Shift Session — start session + shared load helpers (Step 2A).
 * No routes/API; no Shift Over / report lifecycle (Step 2B).
 */

const { prisma } = require("../utils/prisma");
const {
  domainError,
  mapShiftSessionPersistenceError,
  HANDOVER_STATES,
} = require("./machineShiftSessionErrors");
const { allocateShiftSessionNo, MAX_ALLOCATE_ATTEMPTS } = require("./machineShiftSessionNumbering");
const {
  SESSION_STATUS,
  START_OUTSIDE_WINDOW_REASON_SET,
  GUIDANCE,
  buildScheduledWindow,
  evaluateStartWindow,
  readShiftGraceMinutes,
  findUnresolvedHandoverSession,
  throwHandoverPending,
  reconcileSessionExpiry,
} = require("./shiftSessionTimeWindowService");

/**
 * Run in a transaction when `db` is the root Prisma client; otherwise use `db` as tx.
 * @template T
 * @param {import('@prisma/client').PrismaClient} db
 * @param {(tx: import('@prisma/client').PrismaClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withShiftSessionTx(db, fn) {
  if (db && typeof db.$transaction === "function") {
    return db.$transaction(async (tx) => fn(tx));
  }
  return fn(db);
}

/** Calendar date only (night shift uses the shift starting date supplied by the caller). */
function normalizeSessionDate(sessionDate) {
  if (sessionDate == null || sessionDate === "") {
    throw domainError(400, "SESSION_DATE_REQUIRED", "Shift session date is required (use the shift starting date for night shifts).");
  }
  const { parseStrictIsoDateOnly, INVALID_MESSAGE } = require("./strictIsoDate");
  const parsed = parseStrictIsoDateOnly(sessionDate, { required: true });
  if (!parsed.ok || !parsed.ymd) {
    throw domainError(400, "SESSION_DATE_INVALID", INVALID_MESSAGE);
  }
  const [y, mo, d] = parsed.ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

function normalizeOptionalUserId(userId) {
  if (userId == null || userId === "") return null;
  const n = Number(userId);
  if (!Number.isInteger(n) || n <= 0) {
    throw domainError(400, "USER_ID_INVALID", "Starting user is not valid.");
  }
  return n;
}

function normalizePositiveInt(value, code, message) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw domainError(400, code, message);
  }
  return n;
}

function normalizeHandoverState(value) {
  if (value == null || value === "") return "UNKNOWN";
  const key = String(value).trim().toUpperCase();
  if (!HANDOVER_STATES.has(key)) {
    throw domainError(400, "HANDOVER_STATE_INVALID", "Machine handover state must be Retained, Cleared, or Unknown.");
  }
  return key;
}

function normalizeChangeReason(value, { required = false, message } = {}) {
  const requiredMessage = message || "A reason is required for this change.";
  if (value == null || value === "") {
    if (required) {
      throw domainError(400, "CHANGE_REASON_REQUIRED", requiredMessage);
    }
    return null;
  }
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text) {
    if (required) {
      throw domainError(400, "CHANGE_REASON_REQUIRED", requiredMessage);
    }
    return null;
  }
  return text.slice(0, 2000);
}

/**
 * @param {unknown} operatorsInput
 * @returns {{ operatorId: number, isPrimary: boolean }[]}
 */
function normalizeInitialOperators(operatorsInput) {
  if (!Array.isArray(operatorsInput) || operatorsInput.length === 0) {
    throw domainError(400, "OPERATORS_REQUIRED", "At least one operator is required to start a shift session.");
  }
  const seen = new Set();
  const list = [];
  for (const row of operatorsInput) {
    const operatorId = normalizePositiveInt(row?.operatorId ?? row?.id, "OPERATOR_ID_INVALID", "Operator is not valid.");
    if (seen.has(operatorId)) {
      throw domainError(400, "OPERATOR_DUPLICATE", "The same operator was listed more than once for this shift session.");
    }
    seen.add(operatorId);
    const isPrimary = Boolean(row?.isPrimary ?? row?.isPrimarySnapshot);
    list.push({ operatorId, isPrimary });
  }
  const primaries = list.filter((o) => o.isPrimary);
  if (primaries.length !== 1) {
    throw domainError(
      400,
      "PRIMARY_OPERATOR_REQUIRED",
      "Exactly one primary operator is required to start a shift session.",
    );
  }
  return list;
}

async function assertMachineActive(tx, machineId) {
  const machine = await tx.machine.findUnique({
    where: { id: machineId },
    select: { id: true, isActive: true, machineCode: true, machineName: true },
  });
  if (!machine) {
    throw domainError(404, "MACHINE_NOT_FOUND", "Machine was not found.");
  }
  if (!machine.isActive) {
    throw domainError(409, "MACHINE_INACTIVE", "This machine is inactive and cannot start a shift session.");
  }
  return machine;
}

async function assertShiftActive(tx, shiftId) {
  if (shiftId == null) return null;
  const shift = await tx.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      isActive: true,
      shiftCode: true,
      shiftName: true,
      startTime: true,
      endTime: true,
    },
  });
  if (!shift) {
    throw domainError(404, "SHIFT_NOT_FOUND", "Shift was not found.");
  }
  if (!shift.isActive) {
    throw domainError(409, "SHIFT_INACTIVE", "This shift is inactive and cannot be used for a new session.");
  }
  return shift;
}

async function assertOperatorsActive(tx, operatorIds) {
  const rows = await tx.operator.findMany({
    where: { id: { in: operatorIds } },
    select: { id: true, isActive: true, operatorCode: true, operatorName: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of operatorIds) {
    const op = byId.get(id);
    if (!op) {
      throw domainError(404, "OPERATOR_NOT_FOUND", `Operator #${id} was not found.`);
    }
    if (!op.isActive) {
      throw domainError(409, "OPERATOR_INACTIVE", `${op.operatorName || "Operator"} is inactive and cannot join this shift.`);
    }
  }
  return byId;
}

async function findOpenSessionForMachine(tx, machineId) {
  return tx.machineShiftSession.findFirst({
    where: { machineId, status: SESSION_STATUS.OPEN },
    orderBy: { id: "desc" },
  });
}

async function requireOpenSession(tx, sessionId, now = new Date()) {
  let session = await tx.machineShiftSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session was not found.");
  }
  if (session.status === SESSION_STATUS.CANCELLED) {
    throw domainError(
      409,
      "SHIFT_SESSION_ALREADY_CANCELLED",
      "This shift session was cancelled. Open a new shift if work needs to continue.",
    );
  }
  session = await reconcileSessionExpiry(tx, session, now);
  if (session.status !== SESSION_STATUS.OPEN) {
    throw domainError(409, "SHIFT_SESSION_NOT_OPEN", "This shift session is not open.");
  }
  return session;
}

function normalizeOutsideWindowReason(value) {
  if (value == null || value === "") return null;
  const key = String(value).trim().toUpperCase();
  if (!START_OUTSIDE_WINDOW_REASON_SET.has(key)) {
    throw domainError(
      400,
      "START_OUTSIDE_WINDOW_REASON_INVALID",
      "Choose a valid outside-window start reason.",
    );
  }
  return key;
}

/**
 * Start a Machine Shift Session.
 *
 * @param {{
 *   machineId: number,
 *   shiftId?: number|null,
 *   sessionDate: Date|string,
 *   startedByUserId?: number|null,
 *   operators: Array<{ operatorId: number, isPrimary?: boolean }>,
 *   handoverState?: string,
 * }} input
 * @param {import('@prisma/client').PrismaClient} [db]
 */
async function startShiftSession(input, db = prisma) {
  const machineId = normalizePositiveInt(input?.machineId, "MACHINE_ID_INVALID", "Machine is required.");
  if (input?.shiftId == null || input.shiftId === "") {
    throw domainError(400, "SHIFT_ID_REQUIRED", "Select a shift. Session date is the shift starting date and is never inferred.");
  }
  const shiftId = normalizePositiveInt(input.shiftId, "SHIFT_ID_INVALID", "Shift is not valid.");
  const sessionDate = normalizeSessionDate(input?.sessionDate);
  const startedByUserId = normalizeOptionalUserId(input?.startedByUserId ?? input?.actorUserId);
  const actorRole = String(input?.actorRole ?? "").trim().toUpperCase();
  const handoverState = normalizeHandoverState(input?.handoverState);
  const operators = normalizeInitialOperators(input?.operators);
  const primaryOperatorId = operators.find((o) => o.isPrimary).operatorId;
  const now = input?.now instanceof Date && Number.isFinite(input.now.getTime()) ? input.now : new Date();
  const requestedOutsideReason = normalizeOutsideWindowReason(
    input?.startedOutsideWindowReason ?? input?.outsideWindowReason,
  );
  const requestedOutsideRemarks = normalizeChangeReason(input?.startedOutsideWindowRemarks ?? input?.outsideWindowRemarks, {
    required: false,
  });

  try {
    return await withShiftSessionTx(db, async (tx) => {
      await assertMachineActive(tx, machineId);
      const shift = await assertShiftActive(tx, shiftId);
      await assertOperatorsActive(
        tx,
        operators.map((o) => o.operatorId),
      );

      const { assertOperatorsAvailableAcrossMachines } = require("./machineShiftSessionOperatorService");
      await assertOperatorsAvailableAcrossMachines(
        tx,
        operators.map((o) => o.operatorId),
      );

      const existingOpen = await findOpenSessionForMachine(tx, machineId);
      if (existingOpen) {
        throw domainError(
          409,
          "SHIFT_SESSION_ALREADY_OPEN",
          "This machine already has an open shift session. Finish or close that session before starting another.",
          { sessionId: existingOpen.id, shiftSessionNo: existingOpen.shiftSessionNo },
        );
      }

      const unresolvedHandover = await findUnresolvedHandoverSession(tx, machineId);
      if (unresolvedHandover) {
        throwHandoverPending(unresolvedHandover);
      }

      const graceMinutesSnapshot = await readShiftGraceMinutes(tx);
      const scheduled = buildScheduledWindow({
        sessionDate,
        startTime: shift?.startTime,
        endTime: shift?.endTime,
      });
      const scheduledStartAt = scheduled?.scheduledStartAt ?? null;
      const scheduledEndAt = scheduled?.scheduledEndAt ?? null;

      let startedOutsideWindow = false;
      let startedOutsideWindowReason = null;
      let startedOutsideWindowRemarks = null;

      if (scheduledStartAt) {
        const startEval = evaluateStartWindow(scheduledStartAt, graceMinutesSnapshot, now);
        if (!startEval.withinStartWindow) {
          const manager = actorRole === "ADMIN" || actorRole === "PRODUCTION_MANAGER";
          if (!manager) {
            throw domainError(
              403,
              "SHIFT_START_OUTSIDE_WINDOW",
              GUIDANCE.START_OUTSIDE_WINDOW,
              { side: startEval.side },
            );
          }
          if (!requestedOutsideReason) {
            throw domainError(
              400,
              "START_OUTSIDE_WINDOW_REASON_REQUIRED",
              "A reason is required to start this shift outside the allowed window.",
            );
          }
          if (!requestedOutsideRemarks) {
            throw domainError(
              400,
              "START_OUTSIDE_WINDOW_REMARKS_REQUIRED",
              "Remarks are required to start this shift outside the allowed window.",
            );
          }
          startedOutsideWindow = true;
          startedOutsideWindowReason = requestedOutsideReason;
          startedOutsideWindowRemarks = requestedOutsideRemarks;
        }
      }

      const startedAt = now;
      let lastErr = null;

      for (let attempt = 0; attempt < MAX_ALLOCATE_ATTEMPTS; attempt += 1) {
        const shiftSessionNo = await allocateShiftSessionNo(tx, { date: startedAt, attemptOffset: attempt });
        try {
          const session = await tx.machineShiftSession.create({
            data: {
              machineId,
              shiftId,
              sessionDate,
              shiftSessionNo,
              status: SESSION_STATUS.OPEN,
              handoverState,
              primaryOperatorId,
              startedAt,
              startedByUserId,
              scheduledStartAt,
              scheduledEndAt,
              graceMinutesSnapshot,
              startedOutsideWindow,
              startedOutsideWindowReason,
              startedOutsideWindowRemarks,
              sessionOperators: {
                create: operators.map((o) => ({
                  operatorId: o.operatorId,
                  isPrimarySnapshot: o.isPrimary,
                  joinedAt: startedAt,
                  leftAt: null,
                  joinedLeaveReason: null,
                  changedByUserId: startedByUserId,
                  changedAt: startedAt,
                })),
              },
            },
            include: {
              sessionOperators: { orderBy: { id: "asc" } },
              machine: { select: { id: true, machineCode: true, machineName: true } },
              shift: { select: { id: true, shiftCode: true, shiftName: true } },
              primaryOperator: { select: { id: true, operatorCode: true, operatorName: true } },
            },
          });
          return session;
        } catch (e) {
          lastErr = e;
          if (e?.code === "P2002") {
            const target = String(
              Array.isArray(e.meta?.target) ? e.meta.target.join(",") : e.meta?.target || "",
            );
            if (/openMachId|uq_mss_open/i.test(target)) {
              throw mapShiftSessionPersistenceError(e, { action: "startSession" });
            }
            if (/activeOpId|uq_mssop_active_op/i.test(target)) {
              throw mapShiftSessionPersistenceError(e, { action: "startSession" });
            }
            if (/shiftSessionNo/i.test(target) && attempt < MAX_ALLOCATE_ATTEMPTS - 1) {
              continue;
            }
          }
          throw mapShiftSessionPersistenceError(e, { action: "startSession" });
        }
      }

      throw mapShiftSessionPersistenceError(lastErr, { action: "startSession" });
    });
  } catch (e) {
    if (e && typeof e === "object" && e.expose) throw e;
    throw mapShiftSessionPersistenceError(e, { action: "startSession" });
  }
}

module.exports = {
  SESSION_STATUS,
  withShiftSessionTx,
  normalizeSessionDate,
  normalizeOptionalUserId,
  normalizePositiveInt,
  normalizeHandoverState,
  normalizeChangeReason,
  normalizeInitialOperators,
  assertMachineActive,
  assertShiftActive,
  assertOperatorsActive,
  findOpenSessionForMachine,
  requireOpenSession,
  startShiftSession,
};
