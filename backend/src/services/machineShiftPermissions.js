/**
 * Centralized Shift Production lifecycle authorization (Step 3).
 * PRODUCTION receives manager actions only when no active PRODUCTION_MANAGER user exists.
 */

const { prisma } = require("../utils/prisma");
const { domainError } = require("./machineShiftSessionErrors");

const SHIFT_ACTION = Object.freeze({
  VIEW: "VIEW",
  START_SESSION: "START_SESSION",
  MANAGE_OPERATORS: "MANAGE_OPERATORS",
  RUN_SEGMENT: "RUN_SEGMENT",
  DOWNTIME: "DOWNTIME",
  SAVE_SUBMIT_REPORT: "SAVE_SUBMIT_REPORT",
  RETURN_VERIFY_REPORT: "RETURN_VERIFY_REPORT",
  SHIFT_OVER: "SHIFT_OVER",
  CANCEL_SESSION: "CANCEL_SESSION",
  REQUEST_REOPEN: "REQUEST_REOPEN",
  DECIDE_REOPEN: "DECIDE_REOPEN",
  REQUEST_ADJUSTMENT: "REQUEST_ADJUSTMENT",
  DECIDE_APPLY_ADJUSTMENT: "DECIDE_APPLY_ADJUSTMENT",
});

/** Always allowed for ADMIN, PRODUCTION_MANAGER, and PRODUCTION (no fallback gate). */
const ALWAYS_ALLOWED_FOR_PRODUCTION = Object.freeze(
  new Set([
    SHIFT_ACTION.VIEW,
    SHIFT_ACTION.DOWNTIME,
    SHIFT_ACTION.SAVE_SUBMIT_REPORT,
    SHIFT_ACTION.REQUEST_REOPEN,
    SHIFT_ACTION.REQUEST_ADJUSTMENT,
  ]),
);

/** Manager-owned actions; PRODUCTION only when no active PRODUCTION_MANAGER exists. */
const MANAGER_OWNED_ACTIONS = Object.freeze(
  new Set([
    SHIFT_ACTION.START_SESSION,
    SHIFT_ACTION.MANAGE_OPERATORS,
    SHIFT_ACTION.RUN_SEGMENT,
    SHIFT_ACTION.RETURN_VERIFY_REPORT,
    SHIFT_ACTION.SHIFT_OVER,
    SHIFT_ACTION.CANCEL_SESSION,
    SHIFT_ACTION.DECIDE_REOPEN,
    SHIFT_ACTION.DECIDE_APPLY_ADJUSTMENT,
  ]),
);

function shiftAuthError(statusCode, code, message) {
  return domainError(statusCode, code, message);
}

/**
 * @param {import('@prisma/client').PrismaClient} [db]
 * @returns {Promise<boolean>}
 */
async function hasActiveProductionManager(db = prisma) {
  try {
    const count = await db.user.count({
      where: { role: "PRODUCTION_MANAGER", isActive: true },
    });
    return Number(count) > 0;
  } catch (e) {
    // Live DB may not have PRODUCTION_MANAGER enum until migration is applied.
    const msg = String(e?.message ?? e);
    const name = String(e?.name ?? "");
    if (
      name === "PrismaClientValidationError" ||
      /PRODUCTION_MANAGER|Unknown arg|invalid.*enum|Data truncated/i.test(msg)
    ) {
      return false;
    }
    throw e;
  }
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{ role?: string, userId?: number }} user
 * @param {string} action
 * @returns {Promise<{ role: string, via: string }>}
 */
async function assertShiftActionAllowed(db, user, action) {
  const role = String(user?.role ?? "")
    .trim()
    .toUpperCase();
  if (!role) {
    throw shiftAuthError(401, "UNAUTHORIZED", "Unauthorized");
  }
  if (!ALWAYS_ALLOWED_FOR_PRODUCTION.has(action) && !MANAGER_OWNED_ACTIONS.has(action)) {
    throw shiftAuthError(403, "SHIFT_ACTION_UNKNOWN", "This shift action is not recognized.");
  }

  if (role === "ADMIN" || role === "PRODUCTION_MANAGER") {
    return { role, via: role };
  }

  if (role === "PRODUCTION") {
    if (ALWAYS_ALLOWED_FOR_PRODUCTION.has(action)) {
      return { role, via: "PRODUCTION" };
    }
    if (MANAGER_OWNED_ACTIONS.has(action)) {
      const managerExists = await hasActiveProductionManager(db);
      if (!managerExists) {
        return { role, via: "PRODUCTION_FALLBACK" };
      }
      throw shiftAuthError(
        403,
        "PRODUCTION_MANAGER_ACTION_REQUIRED",
        "A Production Manager must perform this action. Ask a Production Manager or Admin.",
      );
    }
  }

  throw shiftAuthError(
    403,
    "SHIFT_ACTION_FORBIDDEN",
    "You are not allowed to perform this shift production action.",
  );
}

/**
 * Express middleware factory — uses root prisma for active-manager checks.
 * @param {string} action
 */
function requireShiftAction(action) {
  return async function requireShiftActionMiddleware(req, res, next) {
    try {
      await assertShiftActionAllowed(prisma, req.user, action);
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Acting user id from JWT only (never from request body).
 * @param {import('express').Request} req
 */
function actorUserIdFromReq(req) {
  const id = Number(req.user?.userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw shiftAuthError(401, "UNAUTHORIZED", "Unauthorized");
  }
  return id;
}

/**
 * UI capability flags for Shift Production (no user lists or internal counts).
 * @param {{ role?: string }} user
 * @param {import('@prisma/client').PrismaClient} [db]
 */
async function getShiftCapabilities(user, db = prisma) {
  const role = String(user?.role ?? "")
    .trim()
    .toUpperCase();

  if (role !== "ADMIN" && role !== "PRODUCTION_MANAGER" && role !== "PRODUCTION") {
    return {
      canView: false,
      canPerformManagerActions: false,
      canPauseProduction: false,
      productionManagerAssigned: false,
      isFallbackControl: false,
    };
  }

  const productionManagerAssigned = await hasActiveProductionManager(db);
  const canPauseProduction = true;

  if (role === "ADMIN" || role === "PRODUCTION_MANAGER") {
    return {
      canView: true,
      canPerformManagerActions: true,
      canPauseProduction,
      productionManagerAssigned,
      isFallbackControl: false,
    };
  }

  // PRODUCTION — pause/resume always; other manager actions only via fallback when no active PM
  const canPerformManagerActions = !productionManagerAssigned;
  return {
    canView: true,
    canPerformManagerActions,
    canPauseProduction,
    productionManagerAssigned,
    isFallbackControl: canPerformManagerActions,
  };
}

module.exports = {
  SHIFT_ACTION,
  ALWAYS_ALLOWED_FOR_PRODUCTION,
  MANAGER_OWNED_ACTIONS,
  hasActiveProductionManager,
  assertShiftActionAllowed,
  requireShiftAction,
  actorUserIdFromReq,
  getShiftCapabilities,
};
