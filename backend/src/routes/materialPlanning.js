/**
 * REGULAR flow — Material Planning (quotation / sales order → RM requirement draft).
 */

const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const { RM_PO_WRITE_ROLES } = require("../constants/erpRoles");
const {
  buildMaterialPlanningPreview,
  createMaterialRequirementDraft,
  listMaterialPlanningSources,
} = require("../services/materialPlanningService");
const { blockProcurementDemandWhenPlanningDriven } = require("../middleware/planningDrivenProcurementGuard");
const { transitionRmRequisition } = require("../services/rmRequisitionLifecycle");

const materialPlanningRouter = express.Router();

const previewQuerySchema = z
  .object({
    quotationId: z.coerce.number().int().positive().optional(),
    salesOrderId: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => !!(q.quotationId || q.salesOrderId), {
    message: "Provide quotationId or salesOrderId",
  })
  .refine((q) => !(q.quotationId && q.salesOrderId), {
    message: "Provide only one of quotationId or salesOrderId",
  });

const createBodySchema = z
  .object({
    quotationId: z.number().int().positive().optional(),
    salesOrderId: z.number().int().positive().optional(),
  })
  .refine((b) => !!(b.quotationId || b.salesOrderId), {
    message: "Provide quotationId or salesOrderId",
  })
  .refine((b) => !(b.quotationId && b.salesOrderId), {
    message: "Provide only one of quotationId or salesOrderId",
  });

materialPlanningRouter.get(
  "/sources",
  requireAuth,
  requireRole(RM_PO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const data = await listMaterialPlanningSources();
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

materialPlanningRouter.get(
  "/preview",
  requireAuth,
  requireRole(RM_PO_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const q = previewQuerySchema.parse(req.query);
      const data = await buildMaterialPlanningPreview({
        quotationId: q.quotationId,
        salesOrderId: q.salesOrderId,
      });
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

materialPlanningRouter.post(
  "/requirements",
  requireAuth,
  requireRole(RM_PO_WRITE_ROLES),
  blockProcurementDemandWhenPlanningDriven,
  async (req, res, next) => {
    try {
      const body = createBodySchema.parse(req.body);
      const result = await createMaterialRequirementDraft({
        quotationId: body.quotationId,
        salesOrderId: body.salesOrderId,
        createdByUserId: req.user?.userId,
      });
      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

const transitionSchema = z.object({
  remarks: z.string().max(4000).optional().nullable(),
});

for (const [path, transition] of [
  ["/requirements/:id/approve", "approve"],
  ["/requirements/:id/send-to-purchase", "send"],
  ["/requirements/:id/reopen", "reopen"],
  ["/requirements/:id/close", "close"],
]) {
  materialPlanningRouter.post(
    path,
    requireAuth,
    requireRole(RM_PO_WRITE_ROLES),
    async (req, res, next) => {
      try {
        const body = transitionSchema.parse(req.body || {});
        const result = await transitionRmRequisition(Number(req.params.id), transition, {
          userId: req.user?.userId,
          role: req.user?.role,
          remarks: body.remarks,
        });
        return res.json(result);
      } catch (e) {
        return next(e);
      }
    },
  );
}

module.exports = { materialPlanningRouter };
