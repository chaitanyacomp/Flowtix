const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  getStrictInventoryControl,
  setStrictInventoryControl,
  getStockAdjustmentPolicy,
  updateStockAdjustmentPolicy,
  getCompanyState,
  setCompanyState,
  getCompanyStateDetails,
  setCompanyStateDetails,
  setCompanyGstDetails,
  getMaxRegularSoBufferPercent,
  setMaxRegularSoBufferPercent,
} = require("../services/appSettings");

const settingsRouter = express.Router();

const stockAdjustmentControlPutSchema = z.object({
  stockAdjustmentReverseRoles: z.enum(["ADMIN_ONLY", "ADMIN_AND_STORE"]),
  stockAdjustmentReverseWindowType: z.enum(["SAME_DAY", "HOURS", "DAYS", "NO_LIMIT"]),
  stockAdjustmentReverseWindowValue: z.number().int().min(1).max(36500),
  stockAdjustmentCreateRoles: z.enum(["ADMIN_ONLY", "ADMIN_AND_STORE"]),
});

/** Max rejection buffer % allowed on Regular (NORMAL) sales order lines — for SO edit UI validation. */
settingsRouter.get(
  "/regular-so-buffer",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES", "PRODUCTION", "QC"]),
  async (req, res, next) => {
    try {
      const maxRegularSoBufferPercent = await getMaxRegularSoBufferPercent();
      return res.json({ maxRegularSoBufferPercent });
    } catch (e) {
      return next(e);
    }
  },
);

settingsRouter.put(
  "/regular-so-buffer",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const { maxRegularSoBufferPercent } = z
        .object({ maxRegularSoBufferPercent: z.number().min(0).max(100) })
        .parse(req.body);
      const nextVal = await setMaxRegularSoBufferPercent(maxRegularSoBufferPercent);
      return res.json({ maxRegularSoBufferPercent: nextVal });
    } catch (e) {
      return next(e);
    }
  },
);

settingsRouter.get(
  "/inventory-mode",
  requireAuth,
  requireRole(["ADMIN", "STORE", "SALES", "PRODUCTION", "QC"]),
  async (req, res, next) => {
    try {
      const strictInventoryControl = await getStrictInventoryControl();
      return res.json({ strictInventoryControl });
    } catch (e) {
      return next(e);
    }
  },
);

settingsRouter.put(
  "/inventory-mode",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const { strictInventoryControl } = z
        .object({ strictInventoryControl: z.boolean() })
        .parse(req.body);
      await setStrictInventoryControl(strictInventoryControl);
      return res.json({ strictInventoryControl });
    } catch (e) {
      return next(e);
    }
  },
);

/** Read-only policy for Stock Adjustment UI (Admin + Store). */
settingsRouter.get(
  "/stock-adjustment-control",
  requireAuth,
  requireRole(["ADMIN", "STORE"]),
  async (req, res, next) => {
    try {
      const policy = await getStockAdjustmentPolicy();
      return res.json(policy);
    } catch (e) {
      return next(e);
    }
  },
);

settingsRouter.put(
  "/stock-adjustment-control",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const body = stockAdjustmentControlPutSchema.parse(req.body);
      const policy = await updateStockAdjustmentPolicy(body);
      return res.json(policy);
    } catch (e) {
      return next(e);
    }
  },
);

/** Company registered state (free text) — for future GST place-of-supply; no tax math yet. */
settingsRouter.get("/company-state", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    // Backward compatible payload: always returns companyState; adds structured fields when available.
    const details = await getCompanyStateDetails();
    return res.json(details);
  } catch (e) {
    return next(e);
  }
});

settingsRouter.put("/company-state", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = z
      .object({
        companyState: z.union([z.string(), z.null()]).optional(),
        companyStateId: z.union([z.number().int().positive(), z.null()]).optional(),
        companyGstin: z.union([z.string(), z.null()]).optional(),
      })
      .parse(req.body);

    // If only legacy field is sent (old UI), preserve old behavior.
    if (body.companyStateId === undefined && body.companyGstin === undefined && body.companyState !== undefined) {
      const nextVal = await setCompanyState(body.companyState);
      return res.json({
        companyState: nextVal,
        companyStateId: null,
        companyStateName: null,
        companyStateCode: null,
        companyGstin: null,
      });
    }

    const details = await setCompanyGstDetails({
      companyStateId: body.companyStateId,
      companyState: body.companyState,
      companyGstin: body.companyGstin,
    });
    return res.json(details);
  } catch (e) {
    return next(e);
  }
});

module.exports = { settingsRouter };
