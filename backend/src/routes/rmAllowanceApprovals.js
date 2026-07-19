const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  submitRmAllowanceApprovalRequest,
  listRmAllowanceApprovals,
  getRmAllowanceApprovalById,
  approveRmAllowanceApprovalRequest,
  rejectRmAllowanceApprovalRequest,
} = require("../services/rmAllowanceApprovalService");

const rmAllowanceApprovalRouter = express.Router();
const storeRoles = ["ADMIN", "STORE"];
const adminRoles = ["ADMIN"];

const submitSchema = z.object({
  productionMaterialRequestId: z.number().int().positive(),
  pmrLineId: z.number().int().positive(),
  enteredAllowanceQty: z.number().nonnegative(),
  issueQty: z.number().positive(),
  allowanceReason: z.string().min(1).max(500),
  fromLocationId: z.number().int().positive().optional().nullable(),
});

rmAllowanceApprovalRouter.post(
  "/",
  requireAuth,
  requireRole(storeRoles),
  async (req, res, next) => {
    try {
      const body = submitSchema.parse(req.body);
      const result = await submitRmAllowanceApprovalRequest(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

rmAllowanceApprovalRouter.get("/", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const status = req.query.status
      ? String(req.query.status)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const rows = await listRmAllowanceApprovals({
      status,
      workOrderId: req.query.workOrderId ? Number(req.query.workOrderId) : undefined,
      productionMaterialRequestId: req.query.productionMaterialRequestId
        ? Number(req.query.productionMaterialRequestId)
        : undefined,
      pmrLineId: req.query.pmrLineId ? Number(req.query.pmrLineId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

rmAllowanceApprovalRouter.get("/:id", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const row = await getRmAllowanceApprovalById(Number(req.params.id));
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

rmAllowanceApprovalRouter.post(
  "/:id/approve",
  requireAuth,
  requireRole(adminRoles),
  async (req, res, next) => {
    try {
      const row = await approveRmAllowanceApprovalRequest(Number(req.params.id), {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.json(row);
    } catch (e) {
      return next(e);
    }
  },
);

const rejectSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

rmAllowanceApprovalRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole(adminRoles),
  async (req, res, next) => {
    try {
      const body = rejectSchema.parse(req.body);
      const row = await rejectRmAllowanceApprovalRequest(Number(req.params.id), body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.json(row);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { rmAllowanceApprovalRouter };
