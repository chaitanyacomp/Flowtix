/**
 * Controlled backdating for REGULAR Machine Run Planning Start Date (plannedDate).
 *
 * Business calendar day uses the Node process local timezone (typically set via `TZ`),
 * matching stockAdjustmentPolicy SAME_DAY semantics — frontend is not authoritative.
 *
 * No schema migration: AuditLog carries user, enteredAt, plannedStartDate, reason, SO, machine.
 */

const MACHINE_PLANNING_BACKDATE_ROLES = Object.freeze(["ADMIN", "PRODUCTION_MANAGER"]);

const { parseStrictIsoDateOnly, INVALID_MESSAGE } = require("./strictIsoDate");

function httpError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

/**
 * Calendar YYYY-MM-DD in the configured business timezone (process local / TZ).
 * @param {Date} [now]
 */
function businessTodayYmd(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Date-only values persisted as UTC midnight (`…T00:00:00.000Z`) — read via UTC parts.
 * @param {Date} d
 */
function storedDateOnlyYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * @param {Date|string|null|undefined} value
 * @param {{ dateOnly?: boolean }} [opts] — dateOnly=true for plannedDate @db.Date rows
 * @returns {string|null}
 */
function toBusinessYmd(value, opts = {}) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    if (opts.dateOnly) {
      const parsed = parseStrictIsoDateOnly(value.trim(), { required: true });
      if (!parsed.ok || !parsed.ymd) {
        throw httpError(INVALID_MESSAGE, 400, "INVALID_DATE");
      }
      return parsed.ymd;
    }
    const s = value.trim().slice(0, 10);
    const parsedLoose = parseStrictIsoDateOnly(s, { required: false });
    if (parsedLoose.ok && parsedLoose.ymd) return parsedLoose.ymd;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return businessTodayYmd(d);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (opts.dateOnly) {
      const ymd = storedDateOnlyYmd(value);
      const parsed = parseStrictIsoDateOnly(ymd, { required: true });
      if (!parsed.ok || !parsed.ymd) {
        throw httpError(INVALID_MESSAGE, 400, "INVALID_DATE");
      }
      return parsed.ymd;
    }
    return businessTodayYmd(value);
  }
  return null;
}

/**
 * @param {string|null|undefined} plannedYmd
 * @param {Date} [now]
 */
function isPastMachinePlanningStartDate(plannedYmd, now = new Date()) {
  const ymd = toBusinessYmd(plannedYmd);
  if (!ymd) return false;
  return ymd < businessTodayYmd(now);
}

/**
 * Earliest allowed planned start: SO creation calendar day (SO must exist).
 * @param {{ createdAt?: Date|string|null, approvedAt?: Date|string|null }} so
 */
function soEarliestAllowedPlannedStartYmd(so) {
  const created = toBusinessYmd(so?.createdAt);
  const approved = toBusinessYmd(so?.approvedAt);
  // Floor is the later of creation/approval when both exist (never before SO existed).
  if (created && approved) return created >= approved ? created : approved;
  return created || approved || null;
}

function canBackdateMachinePlanning(role) {
  const r = String(role ?? "")
    .trim()
    .toUpperCase();
  return MACHINE_PLANNING_BACKDATE_ROLES.includes(r);
}

/**
 * Build map of previously persisted planned dates by fgItemId:runSequence.
 * @param {Array<{ fgItemId?: number, runSequence?: number, plannedDate?: unknown }>|null|undefined} existingRuns
 */
function existingPlannedDateByRunKey(existingRuns) {
  /** @type {Map<string, string|null>} */
  const m = new Map();
  for (const r of existingRuns ?? []) {
    const fg = Number(r.fgItemId);
    const seq = Number(r.runSequence);
    if (!Number.isInteger(fg) || fg <= 0 || !Number.isInteger(seq) || seq < 1) continue;
    m.set(`${fg}:${seq}`, toBusinessYmd(r.plannedDate, { dateOnly: true }));
  }
  return m;
}

/**
 * Enforce backdate authorization, SO date floor, and mandatory reason for *new* past dates.
 * Unchanged historical past dates remain valid (not invalidated merely because time passed).
 *
 * @param {{
 *   runs: Array<{ fgItemId: number, runSequence: number, machineId: number, plannedDate?: string|null }>,
 *   actorRole?: string|null,
 *   backdateReason?: string|null,
 *   salesOrder: { id?: number, createdAt?: Date|string|null, approvedAt?: Date|string|null, docNo?: string|null },
 *   existingRuns?: Array<{ fgItemId?: number, runSequence?: number, plannedDate?: unknown }>|null,
 *   now?: Date,
 * }} input
 * @returns {{ backdatedRuns: Array<{ fgItemId: number, runSequence: number, machineId: number, plannedDate: string }>, reason: string|null }}
 */
function assertMachinePlanningPlannedDatesAllowed(input) {
  const now = input?.now instanceof Date ? input.now : new Date();
  const today = businessTodayYmd(now);
  const role = String(input?.actorRole ?? "")
    .trim()
    .toUpperCase();
  const reason = String(input?.backdateReason ?? "").trim();
  const floorYmd = soEarliestAllowedPlannedStartYmd(input?.salesOrder ?? {});
  const prevByKey = existingPlannedDateByRunKey(input?.existingRuns);
  /** @type {Array<{ fgItemId: number, runSequence: number, machineId: number, plannedDate: string }>} */
  const newlyBackdated = [];

  for (const run of input?.runs ?? []) {
    const plannedYmd = toBusinessYmd(run.plannedDate, { dateOnly: true });
    if (!plannedYmd) continue;

    if (floorYmd && plannedYmd < floorYmd) {
      throw httpError(
        `Start Date cannot be earlier than the Sales Order date (${floorYmd}).`,
        400,
        "MACHINE_PLANNING_DATE_BEFORE_SO",
      );
    }

    const key = `${Number(run.fgItemId)}:${Number(run.runSequence)}`;
    const prevYmd = prevByKey.get(key) ?? null;
    const dateUnchanged = prevYmd != null && prevYmd === plannedYmd;
    const isPast = plannedYmd < today;

    if (!isPast) continue;

    // Grandfather unchanged historical past dates — still editable under lifecycle rules.
    if (dateUnchanged) continue;

    if (!canBackdateMachinePlanning(role)) {
      throw httpError(
        "Past Start Date is only allowed for Admin or Production Manager.",
        403,
        "MACHINE_PLANNING_BACKDATE_FORBIDDEN",
      );
    }

    newlyBackdated.push({
      fgItemId: Number(run.fgItemId),
      runSequence: Number(run.runSequence),
      machineId: Number(run.machineId),
      plannedDate: plannedYmd,
    });
  }

  if (newlyBackdated.length > 0 && reason.length < 3) {
    throw httpError(
      "A Backdate Reason is required when recording a past machine plan (at least 3 characters).",
      400,
      "MACHINE_PLANNING_BACKDATE_REASON_REQUIRED",
    );
  }

  return { backdatedRuns: newlyBackdated, reason: newlyBackdated.length ? reason : null };
}

/**
 * Write AuditLog rows for newly backdated machine-plan starts (transactional with snapshot save).
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{
 *   salesOrderId: number,
 *   salesOrderDocNo?: string|null,
 *   actorUserId?: number|null,
 *   actorRole?: string|null,
 *   reason: string,
 *   backdatedRuns: Array<{ fgItemId: number, runSequence: number, machineId: number, plannedDate: string }>,
 *   enteredAt?: Date,
 * }} args
 */
async function writeMachinePlanningBackdateAudits(tx, args) {
  if (!args?.backdatedRuns?.length) return [];
  const auditLog = require("./auditLog");
  const enteredAt = (args.enteredAt instanceof Date ? args.enteredAt : new Date()).toISOString();
  const reason = String(args.reason ?? "").trim().slice(0, 512);
  const soId = String(args.salesOrderId);
  const results = [];

  for (const run of args.backdatedRuns) {
    const row = await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SALES_ORDER,
      entityId: soId,
      actorUserId: args.actorUserId ?? null,
      actorRole: args.actorRole ?? null,
      summary: `Machine Run Planning backdated start ${run.plannedDate} (machine ${run.machineId})`,
      reason,
      payload: {
        kind: "MACHINE_PLANNING_BACKDATE",
        userId: args.actorUserId ?? null,
        enteredAt,
        plannedStartDate: run.plannedDate,
        reason,
        salesOrderId: Number(args.salesOrderId),
        salesOrderDocNo: args.salesOrderDocNo ?? null,
        machineId: run.machineId,
        fgItemId: run.fgItemId,
        runSequence: run.runSequence,
      },
    });
    results.push(row);
  }
  return results;
}

module.exports = {
  MACHINE_PLANNING_BACKDATE_ROLES,
  businessTodayYmd,
  toBusinessYmd,
  isPastMachinePlanningStartDate,
  soEarliestAllowedPlannedStartYmd,
  canBackdateMachinePlanning,
  existingPlannedDateByRunKey,
  assertMachinePlanningPlannedDatesAllowed,
  writeMachinePlanningBackdateAudits,
};
