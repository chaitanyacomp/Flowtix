/**
 * Domain errors for Machine Shift Session services (UI-safe messages).
 */

function domainError(statusCode, code, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.expose = true;
  if (details !== undefined) err.details = details;
  return err;
}

function prismaTargetText(err) {
  const meta = err?.meta && typeof err.meta === "object" ? err.meta : {};
  const target = meta.target;
  if (Array.isArray(target)) return target.filter((x) => typeof x === "string").join(",");
  if (typeof target === "string") return target;
  if (typeof meta.constraint === "string") return meta.constraint;
  if (Array.isArray(meta.constraint)) return meta.constraint.filter((x) => typeof x === "string").join(",");
  return "";
}

/**
 * Map Prisma unique/FK conflicts to clear shift-session domain errors.
 * @param {unknown} e
 * @param {{ action?: string }} [ctx]
 */
function mapShiftSessionPersistenceError(e, ctx = {}) {
  const code = e && typeof e === "object" ? e.code : null;
  const target = prismaTargetText(e);
  const action = String(ctx.action || "");

  if (code === "P2002") {
    // Check activeOpId before startSession fallback — otherwise start races map wrongly.
    if (/activeOpId|uq_mssop_active_op/i.test(target)) {
      return domainError(
        409,
        "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE",
        "This operator is already active on another open shift session. They must leave that machine before joining here.",
      );
    }
    if (/openMachId|uq_mss_open/i.test(target)) {
      return domainError(
        409,
        "SHIFT_SESSION_ALREADY_OPEN",
        "This machine already has an open shift session. Finish or close that session before starting another.",
      );
    }
    if (/actMachId|uq_mssseg_act/i.test(target) || action === "startRunSegment") {
      return domainError(
        409,
        "ACTIVE_RUN_SEGMENT_EXISTS",
        "This machine already has an active production run on the shift. Close it before starting another.",
      );
    }
    if (/shiftSessionNo/i.test(target)) {
      return domainError(
        409,
        "SHIFT_SESSION_NO_CONFLICT",
        "Could not allocate a unique shift session number. Please try again.",
      );
    }
    if (/uniq_mssds_inc_sid|incidentId_sessionId|incidentId,sessionId/i.test(target)) {
      return domainError(
        409,
        "DOWNTIME_SEGMENT_EXISTS",
        "A downtime segment for this incident already exists on this shift session.",
      );
    }
    if (/uniq_srpt_ver|reportId_versionNo|reportId,versionNo/i.test(target)) {
      return domainError(
        409,
        "SHIFT_REPORT_VERSION_CONFLICT",
        "A shift report version with this number already exists. Please reload and try again.",
      );
    }
    if (/ShiftProductionReport_sessionId|sessionId/i.test(target) && action === "ensureReport") {
      return domainError(
        409,
        "SHIFT_REPORT_EXISTS",
        "A shift production report already exists for this session.",
      );
    }
    if (/unresVerId|uq_srpt_adj_unres/i.test(target) || action === "requestAdjustment") {
      return domainError(
        409,
        "ADJUSTMENT_ALREADY_OPEN",
        "An unresolved historical adjustment already exists for this verified report version.",
      );
    }
    if (/appliedReportVersionId/i.test(target)) {
      return domainError(
        409,
        "ADJUSTMENT_APPLIED_VERSION_CONFLICT",
        "This corrected report version is already linked to another adjustment.",
      );
    }
    if (action === "joinOperator" || action === "changePrimary") {
      return domainError(
        409,
        "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE",
        "This operator is already active on another open shift session. They must leave that machine before joining here.",
      );
    }
    if (action === "startSession") {
      return domainError(
        409,
        "SHIFT_SESSION_ALREADY_OPEN",
        "This machine already has an open shift session. Finish or close that session before starting another.",
      );
    }
    return domainError(409, "SHIFT_SESSION_CONFLICT", "This change conflicts with an existing shift session record.");
  }

  if (code === "P2003") {
    return domainError(
      409,
      "SHIFT_SESSION_REFERENCE_INVALID",
      "One of the linked records is missing or no longer valid. Check machine, shift, operator, or work order.",
    );
  }

  if (code === "P2025") {
    return domainError(404, "SHIFT_SESSION_NOT_FOUND", "Shift session record was not found.");
  }

  if (e && typeof e === "object" && typeof e.statusCode === "number" && e.expose) {
    return e;
  }

  return domainError(
    500,
    "SHIFT_SESSION_PERSISTENCE_FAILED",
    "Could not save the shift session change. No partial update was kept. Please try again.",
  );
}

const HANDOVER_STATES = Object.freeze(new Set(["RETAINED", "CLEARED", "UNKNOWN"]));

const DOWNTIME_REASONS = Object.freeze(
  new Set([
    "MACHINE_BREAKDOWN",
    "WAITING_FOR_RM",
    "TOOL_MOULD_MAINTENANCE",
    "QUALITY_CONCERN",
    "EMERGENCY_PRIORITY_PRODUCTION",
    "POWER_UTILITY_FAILURE",
    "MANAGEMENT_HOLD",
    "OTHER",
  ]),
);

/** Work orders that must not receive a new shift run segment (read-only check; does not alter production rules). */
const WO_NOT_USABLE_FOR_SHIFT_RUN = Object.freeze(new Set(["COMPLETED", "REJECTED", "CLOSED_WITH_SHORTFALL"]));

module.exports = {
  domainError,
  mapShiftSessionPersistenceError,
  prismaTargetText,
  HANDOVER_STATES,
  DOWNTIME_REASONS,
  WO_NOT_USABLE_FOR_SHIFT_RUN,
};
