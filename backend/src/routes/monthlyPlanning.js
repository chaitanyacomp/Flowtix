/**
 * Monthly Planning Workspace — Phase 1 (data foundation) router.
 *
 * Exposes ONLY:
 *   GET  /api/monthly-planning?period=YYYY-MM   load/inspect a plan header (+ lines, revisions)
 *   POST /api/monthly-planning                  create/init a plan header for a period
 *
 * The entire router is gated behind the FEATURE_MONTHLY_PLANNING flag (default OFF).
 * When the flag is off the routes respond 404, so nothing is exposed until enabled.
 *
 * Lock / RM snapshot / release / procurement emission are NOT implemented here (later phases).
 */

const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { isMonthlyPlanningEnabled } = require("../config/featureFlags");
const {
  getMonthlyPlanByPeriod,
  createMonthlyPlan,
  getProductionLines,
  updateProductionLines,
  lockMonthlyPlan,
  reopenMonthlyPlan,
  cancelReopenMonthlyPlan,
  getPlanRevisions,
  getRmPlanning,
  getPurchasePlanning,
  releaseToProcurement,
  MonthlyPlanningError,
} = require("../services/monthlyPlanningService");
const { getRsSuggestionsForPeriod } = require("../services/monthlyPlanningRsSuggestionsService");
const { getGreenLevels } = require("../services/monthlyPlanningGreenLevelService");
const { getRequirementComposition } = require("../services/monthlyPlanningRequirementCompositionService");
const { getRmRequirementComposition } = require("../services/monthlyPlanningRmRequirementCompositionService");

const monthlyPlanningRouter = express.Router();

const {
  MONTHLY_PLANNING_READ_ROLES,
  MONTHLY_PLANNING_WRITE_ROLES,
} = require("../constants/erpRoles");

/** Feature-flag gate: hide the whole router when the flag is OFF. */
monthlyPlanningRouter.use((req, res, next) => {
  if (!isMonthlyPlanningEnabled()) {
    return res.status(404).json({ error: { message: "Not found" } });
  }
  return next();
});

function actorUserId(req) {
  const id = Number(req.user?.userId ?? req.user?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function actorRole(req) {
  const role = String(req.user?.role ?? "").trim().toUpperCase();
  return role || null;
}

function handleServiceError(e, res, next) {
  if (e instanceof MonthlyPlanningError) {
    return res.status(e.httpStatus || 400).json({ error: { code: e.code, message: e.message } });
  }
  return next(e);
}

const createBodySchema = z.object({
  period: z.string(),
  remarks: z.string().trim().max(2000).optional(),
  confirmPastPeriod: z.literal(true).optional(),
});

const pastPeriodConfirmBodySchema = z.object({
  confirmPastPeriod: z.literal(true).optional(),
});

monthlyPlanningRouter.get(
  "/",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const period = req.query.period;
      if (!period) {
        return res
          .status(422)
          .json({ error: { code: "INVALID_PERIOD", message: "period query param is required (YYYY-MM)." } });
      }
      const data = await getMonthlyPlanByPeriod({ period: String(period) });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/green-levels",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const periodKey = req.query.periodKey ?? req.query.period;
      if (!periodKey) {
        return res.status(422).json({
          error: { code: "INVALID_PERIOD", message: "periodKey query param is required (YYYY-MM)." },
        });
      }
      const data = await getGreenLevels({ periodKey: String(periodKey) });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/rs-suggestions",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const periodKey = req.query.periodKey ?? req.query.period;
      if (!periodKey) {
        return res.status(422).json({
          error: { code: "INVALID_PERIOD", message: "periodKey query param is required (YYYY-MM)." },
        });
      }
      const data = await getRsSuggestionsForPeriod({ periodKey: String(periodKey) });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/requirement-composition",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const periodKey = req.query.periodKey ?? req.query.period;
      if (!periodKey) {
        return res.status(422).json({
          error: { code: "INVALID_PERIOD", message: "periodKey query param is required (YYYY-MM)." },
        });
      }
      const data = await getRequirementComposition({ periodKey: String(periodKey) });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/rm-requirement-composition",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const periodKey = req.query.periodKey ?? req.query.period;
      if (!periodKey) {
        return res.status(422).json({
          error: { code: "INVALID_PERIOD", message: "periodKey query param is required (YYYY-MM)." },
        });
      }
      const data = await getRmRequirementComposition({ periodKey: String(periodKey) });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.post(
  "/",
  requireAuth,
  requireRole(MONTHLY_PLANNING_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const parsed = createBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(422)
          .json({ error: { code: "INVALID_BODY", message: "period is required (YYYY-MM)." } });
      }
      const data = await createMonthlyPlan({
        period: parsed.data.period,
        remarks: parsed.data.remarks ?? null,
        actorUserId: actorUserId(req),
        actorRole: actorRole(req),
        confirmPastPeriod: parsed.data.confirmPastPeriod === true,
      });
      return res.status(201).json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

const upsertLineSchema = z.object({
  fgItemId: z.coerce.number().int().positive(),
  plannedFgQty: z.coerce.number().min(0),
  plannedQtyOverridden: z.boolean().optional(),
  source: z.enum(["SALES_ORDER", "REQUIREMENT_SHEET", "MANUAL"]).optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});

const updateLinesSchema = z.object({
  upserts: z.array(upsertLineSchema).optional(),
  deletes: z.array(z.coerce.number().int().positive()).optional(),
  confirmPastPeriod: z.literal(true).optional(),
});

monthlyPlanningRouter.get(
  "/:id/production-lines",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const data = await getProductionLines({ planId: req.params.id });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.put(
  "/:id/production-lines",
  requireAuth,
  requireRole(MONTHLY_PLANNING_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const parsed = updateLinesSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(422)
          .json({ error: { code: "INVALID_BODY", message: "Invalid production lines payload." } });
      }
      const data = await updateProductionLines({
        planId: req.params.id,
        upserts: parsed.data.upserts ?? [],
        deletes: parsed.data.deletes ?? [],
        actorUserId: actorUserId(req),
        actorRole: actorRole(req),
        confirmPastPeriod: parsed.data.confirmPastPeriod === true,
      });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.post(
  "/:id/lock",
  requireAuth,
  requireRole(MONTHLY_PLANNING_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const parsed = pastPeriodConfirmBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(422).json({ error: { code: "INVALID_BODY", message: "Invalid lock request body." } });
      }
      const data = await lockMonthlyPlan({
        planId: req.params.id,
        actorUserId: actorUserId(req),
        actorRole: actorRole(req),
        confirmPastPeriod: parsed.data.confirmPastPeriod === true,
      });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.post(
  "/:id/reopen",
  requireAuth,
  requireRole(MONTHLY_PLANNING_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const parsed = pastPeriodConfirmBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(422).json({ error: { code: "INVALID_BODY", message: "Invalid reopen request body." } });
      }
      const data = await reopenMonthlyPlan({
        planId: req.params.id,
        actorUserId: actorUserId(req),
        actorRole: actorRole(req),
        confirmPastPeriod: parsed.data.confirmPastPeriod === true,
      });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.post(
  "/:id/cancel-reopen",
  requireAuth,
  requireRole(MONTHLY_PLANNING_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const parsed = pastPeriodConfirmBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(422)
          .json({ error: { code: "INVALID_BODY", message: "Invalid cancel-reopen request body." } });
      }
      const data = await cancelReopenMonthlyPlan({
        planId: req.params.id,
        actorUserId: actorUserId(req),
        actorRole: actorRole(req),
        confirmPastPeriod: parsed.data.confirmPastPeriod === true,
      });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/:id/revisions",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const data = await getPlanRevisions({ planId: req.params.id });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/:id/rm-planning",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      const revision = req.query.revision != null ? Number(req.query.revision) : null;
      const data = await getRmPlanning({
        planId: req.params.id,
        revision: Number.isFinite(revision) && revision > 0 ? revision : null,
      });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

monthlyPlanningRouter.get(
  "/:id/purchase-planning",
  requireAuth,
  requireRole(MONTHLY_PLANNING_READ_ROLES),
  async (req, res, next) => {
    try {
      if (req.query.revision != null) {
        return res.status(422).json({
          error: {
            code: "PURCHASE_REVISION_NOT_SUPPORTED",
            message:
              "Purchase Planning always uses the current locked revision. Omit the revision query param.",
          },
        });
      }
      const data = await getPurchasePlanning({ planId: req.params.id });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

const releaseBodySchema = z.object({
  revision: z.number().int().positive().optional(),
  confirm: z.literal(true),
});

monthlyPlanningRouter.post(
  "/:id/release",
  requireAuth,
  requireRole(MONTHLY_PLANNING_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const parsed = releaseBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(422).json({
          error: { code: "INVALID_BODY", message: "confirm:true is required to release." },
        });
      }
      const data = await releaseToProcurement({
        planId: req.params.id,
        revision: parsed.data.revision ?? null,
        confirm: parsed.data.confirm,
        actorUserId: actorUserId(req),
      });
      return res.json(data);
    } catch (e) {
      return handleServiceError(e, res, next);
    }
  },
);

module.exports = { monthlyPlanningRouter };
