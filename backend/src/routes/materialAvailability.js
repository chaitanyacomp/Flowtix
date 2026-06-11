const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  RM_ALLOCATION_WRITE_ROLES,
  RM_CONTROL_CENTER_ROLES,
  STOCK_READ_ROLES,
  MATERIAL_REQUISITION_WRITE_ROLES,
} = require("../constants/erpRoles");
const { buildMaterialAvailabilityWorkspace } = require("../services/materialAvailabilityWorkspaceService");
const { allocateForWorkOrder, releaseForWorkOrder } = require("../services/storeAllocationEngineService");
const {
  createOrReuseProductionShortageMr,
  bulkAddProductionShortageMrLines,
} = require("../services/productionShortageMrService");
const { blockProcurementDemandWhenPlanningDriven } = require("../middleware/planningDrivenProcurementGuard");

const materialAvailabilityRouter = express.Router();

const workspaceQuerySchema = z.object({
  salesOrderId: z.coerce.number().int().positive().optional(),
  workOrderId: z.coerce.number().int().positive().optional(),
  rmItemId: z.coerce.number().int().positive().optional(),
  status: z.string().max(64).optional(),
  onlyBlocked: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v == null ? undefined : v === "true")),
});

const productionShortageMrSchema = z.object({
  workOrderId: z.number().int().positive(),
  rmItemId: z.number().int().positive(),
  shortageQty: z.number().positive(),
  freeStockQty: z.number().nonnegative().optional(),
  remarks: z.string().max(4000).optional().nullable(),
  confirmReopenClosed: z.boolean().optional(),
});

const productionShortageMrBulkSchema = z.object({
  workOrderId: z.number().int().positive(),
  remarks: z.string().max(4000).optional().nullable(),
  confirmReopenClosed: z.boolean().optional(),
});

const allocationAllocateSchema = z.object({
  workOrderId: z.coerce.number().int().positive(),
  rmItemId: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive(),
  note: z.string().max(4000).optional().nullable(),
});

const allocationReleaseSchema = z.object({
  allocationId: z.coerce.number().int().positive().optional(),
  workOrderId: z.coerce.number().int().positive().optional(),
  rmItemId: z.coerce.number().int().positive().optional(),
  qty: z.coerce.number().positive(),
  reason: z.string().max(4000).optional().nullable(),
});

materialAvailabilityRouter.get(
  "/workspace",
  requireAuth,
  requireRole(RM_CONTROL_CENTER_ROLES),
  async (req, res, next) => {
    try {
      const query = workspaceQuerySchema.parse(req.query);
      const data = await buildMaterialAvailabilityWorkspace(undefined, query);
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

materialAvailabilityRouter.post(
  "/allocations/allocate",
  requireAuth,
  requireRole(RM_ALLOCATION_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = allocationAllocateSchema.parse(req.body);
      const out = await allocateForWorkOrder(body, { userId: req.user?.userId, role: req.user?.role });
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  },
);

materialAvailabilityRouter.post(
  "/allocations/release",
  requireAuth,
  requireRole(RM_ALLOCATION_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = allocationReleaseSchema.parse(req.body);
      const out = await releaseForWorkOrder(body, { userId: req.user?.userId, role: req.user?.role });
      return res.status(201).json(out);
    } catch (e) {
      return next(e);
    }
  },
);

materialAvailabilityRouter.post(
  "/production-shortage-mr",
  requireAuth,
  requireRole(MATERIAL_REQUISITION_WRITE_ROLES),
  blockProcurementDemandWhenPlanningDriven,
  async (req, res, next) => {
    try {
      const body = productionShortageMrSchema.parse(req.body);
      const data = await createOrReuseProductionShortageMr(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(data.created || data.lineCreated ? 201 : 200).json(data);
    } catch (e) {
      if (e?.code === "REOPEN_CONFIRM_REQUIRED") {
        return res.status(409).json({
          code: e.code,
          message: e.message,
          existingMaterialRequirement: e.existingMaterialRequirement ?? null,
        });
      }
      return next(e);
    }
  },
);

materialAvailabilityRouter.post(
  "/production-shortage-mr/bulk",
  requireAuth,
  requireRole(MATERIAL_REQUISITION_WRITE_ROLES),
  blockProcurementDemandWhenPlanningDriven,
  async (req, res, next) => {
    try {
      const body = productionShortageMrBulkSchema.parse(req.body);
      const data = await bulkAddProductionShortageMrLines(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      const created = data.created || data.linesAdded > 0;
      return res.status(created ? 201 : 200).json(data);
    } catch (e) {
      if (e?.code === "REOPEN_CONFIRM_REQUIRED") {
        return res.status(409).json({
          code: e.code,
          message: e.message,
          existingMaterialRequirement: e.existingMaterialRequirement ?? null,
        });
      }
      return next(e);
    }
  },
);

module.exports = { materialAvailabilityRouter };
