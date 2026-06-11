/**
 * Phase 2B — Procurement Planning (Store: consolidate RM demand → purchase request).
 */

const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  RM_PO_READ_ROLES,
  PROCUREMENT_PLANNING_ROLES,
  MATERIAL_REQUISITION_WRITE_ROLES,
} = require("../constants/erpRoles");
const { buildProcurementPool } = require("../services/procurementPlanningService");
const { createPurchaseRequestFromPool } = require("../services/purchaseRequestService");
const { buildProcurementWorkspace } = require("../services/procurementWorkspaceService");
const { repairStaleDuplicateWoPlanningProcurement } = require("../services/procurementLifecycleService");

const procurementPlanningRouter = express.Router();

const workspaceQuerySchema = z.object({
  salesOrderId: z.coerce.number().int().positive().optional(),
  sourceType: z.enum(["MONTHLY_PLAN", "WORK_ORDER_PLANNING", "STOCK_REPLENISHMENT"]).optional(),
});

procurementPlanningRouter.get(
  "/workspace",
  requireAuth,
  requireRole(RM_PO_READ_ROLES),
  async (req, res, next) => {
    try {
      const query = workspaceQuerySchema.parse(req.query);
      const salesOrderId = query.salesOrderId != null ? Number(query.salesOrderId) : null;
      await repairStaleDuplicateWoPlanningProcurement(undefined, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      const data = await buildProcurementWorkspace(undefined, {
        salesOrderId: Number.isFinite(salesOrderId) && salesOrderId > 0 ? salesOrderId : null,
        sourceType: query.sourceType ?? null,
      });
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

procurementPlanningRouter.get(
  "/pool",
  requireAuth,
  requireRole(PROCUREMENT_PLANNING_ROLES),
  async (req, res, next) => {
    try {
      const data = await buildProcurementPool();
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

const sendRequirementSchema = z.object({
  remarks: z.string().max(4000).optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        requiredQty: z.number().nonnegative(),
        availableQty: z.number().nonnegative().optional(),
        netRequiredQty: z.number().positive(),
        unit: z.string().max(64).optional().nullable(),
        allocations: z
          .array(
            z.object({
              materialRequirementLineId: z.number().int().positive(),
              qty: z.number().positive(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

procurementPlanningRouter.post(
  "/send-requirement",
  requireAuth,
  requireRole(MATERIAL_REQUISITION_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = sendRequirementSchema.parse(req.body);
      const result = await createPurchaseRequestFromPool(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { procurementPlanningRouter };
