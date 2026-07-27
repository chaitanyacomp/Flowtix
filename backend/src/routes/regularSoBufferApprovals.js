const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  submitRegularSoBufferApprovalRequest,
  listRegularSoBufferApprovals,
  getRegularSoBufferApprovalById,
  getLatestRegularSoBufferApprovalForSalesOrder,
  approveRegularSoBufferApprovalRequest,
  rejectRegularSoBufferApprovalRequest,
} = require("../services/regularSoBufferApprovalService");

const regularSoBufferApprovalRouter = express.Router();
const storeRoles = ["ADMIN", "STORE"];
const adminRoles = ["ADMIN"];

const submitSchema = z.object({
  salesOrderId: z.number().int().positive(),
  bufferPercent: z.number().gt(5).max(10),
  storeReason: z.string().min(1).max(500),
  plannedProductionQty: z.number().positive().optional(),
});

regularSoBufferApprovalRouter.post(
  "/",
  requireAuth,
  requireRole(storeRoles),
  async (req, res, next) => {
    try {
      const body = submitSchema.parse(req.body);
      const result = await submitRegularSoBufferApprovalRequest(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

regularSoBufferApprovalRouter.get("/", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const status = req.query.status
      ? String(req.query.status)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    if (req.query.latestForSalesOrderId) {
      const latest = await getLatestRegularSoBufferApprovalForSalesOrder(
        Number(req.query.latestForSalesOrderId),
      );
      return res.json(latest);
    }
    const rows = await listRegularSoBufferApprovals({
      status,
      salesOrderId: req.query.salesOrderId ? Number(req.query.salesOrderId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

regularSoBufferApprovalRouter.get("/:id", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const row = await getRegularSoBufferApprovalById(Number(req.params.id));
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

const approveSchema = z.object({
  adminRemarks: z.string().max(500).optional().nullable(),
});

regularSoBufferApprovalRouter.post(
  "/:id/approve",
  requireAuth,
  requireRole(adminRoles),
  async (req, res, next) => {
    try {
      const body = approveSchema.parse(req.body ?? {});
      const row = await approveRegularSoBufferApprovalRequest(
        Number(req.params.id),
        body,
        {
          userId: req.user?.userId,
          role: req.user?.role,
        },
      );
      return res.json(row);
    } catch (e) {
      return next(e);
    }
  },
);

const rejectSchema = z.object({
  rejectionReason: z.string().min(1).max(500).optional(),
  adminRemarks: z.string().min(1).max(500).optional(),
}).refine((b) => Boolean(String(b.rejectionReason || b.adminRemarks || "").trim()), {
  message: "Admin remarks are required when rejecting.",
});

regularSoBufferApprovalRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole(adminRoles),
  async (req, res, next) => {
    try {
      const body = rejectSchema.parse(req.body);
      const row = await rejectRegularSoBufferApprovalRequest(Number(req.params.id), body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.json(row);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { regularSoBufferApprovalRouter };
