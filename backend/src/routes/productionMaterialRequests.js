/**
 * Phase 3B — Production Material Request (PMR).
 */

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  buildBomSuggestionsForWorkOrder,
  listProductionMaterialRequests,
  getProductionMaterialRequestById,
  createProductionMaterialRequest,
  submitProductionMaterialRequest,
  cancelProductionMaterialRequest,
  issueMaterialAgainstPmr,
  buildPmrIssueContext,
  ensureSubmittedProductionMaterialRequestForWorkOrder,
} = require("../services/productionMaterialRequestService");

const pmrRouter = express.Router();
const productionRoles = ["ADMIN", "PRODUCTION"];
const storeRoles = ["ADMIN", "STORE"];
const readRoles = ["ADMIN", "PRODUCTION", "STORE"];

pmrRouter.get("/bom-suggestions", requireAuth, requireRole(readRoles), async (req, res, next) => {
  try {
    const workOrderId = Number(req.query.workOrderId);
    if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
      const err = new Error("workOrderId is required");
      err.statusCode = 400;
      throw err;
    }
    const data = await buildBomSuggestionsForWorkOrder(workOrderId);
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

pmrRouter.get("/", requireAuth, requireRole(readRoles), async (req, res, next) => {
  try {
    const pendingForStore = String(req.query.pendingForStore || "") === "1";
    const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    const rows = await listProductionMaterialRequests(undefined, { pendingForStore, status });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

pmrRouter.get("/:id/issue-context", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const fromLocationId = Number(req.query.fromLocationId);
    const data = await buildPmrIssueContext(
      id,
      Number.isFinite(fromLocationId) && fromLocationId > 0 ? fromLocationId : null,
    );
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

pmrRouter.get("/:id", requireAuth, requireRole(readRoles), async (req, res, next) => {
  try {
    const data = await getProductionMaterialRequestById(Number(req.params.id));
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

const createSchema = z.object({
  workOrderId: z.number().int().positive(),
  remarks: z.string().max(4000).optional().nullable(),
  useBom: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        requiredQty: z.number().positive(),
      }),
    )
    .optional(),
});

pmrRouter.post("/", requireAuth, requireRole(productionRoles), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const pmr = await createProductionMaterialRequest(body, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.status(201).json(pmr);
  } catch (e) {
    return next(e);
  }
});

// Ensure a submitted (store-visible) PMR exists for a Regular work order, building RM
// lines from BOM when needed. Lets the Material Issue Workspace load RM lines for a WO
// that has no PMR yet (the same WO-level RM demand RM Control Center derives from BOM).
// Idempotent: returns the existing open PMR when one already exists.
pmrRouter.post("/ensure-for-work-order", requireAuth, requireRole(readRoles), async (req, res, next) => {
  try {
    const workOrderId = Number(req.body?.workOrderId);
    if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
      const err = new Error("workOrderId is required");
      err.statusCode = 400;
      throw err;
    }
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { salesOrder: { select: { orderType: true } } },
    });
    if (!wo) {
      const err = new Error("Work order not found");
      err.statusCode = 404;
      throw err;
    }
    if (wo.salesOrder?.orderType === "NO_QTY") {
      const err = new Error("No Qty work orders request material through Requirement & Cycle Planning.");
      err.statusCode = 400;
      throw err;
    }
    const pmr = await ensureSubmittedProductionMaterialRequestForWorkOrder(workOrderId, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.status(200).json(pmr);
  } catch (e) {
    return next(e);
  }
});

pmrRouter.post("/:id/submit", requireAuth, requireRole(productionRoles), async (req, res, next) => {
  try {
    const pmr = await submitProductionMaterialRequest(Number(req.params.id), {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.json(pmr);
  } catch (e) {
    return next(e);
  }
});

pmrRouter.post("/:id/cancel", requireAuth, requireRole([...productionRoles, ...storeRoles]), async (req, res, next) => {
  try {
    const pmr = await cancelProductionMaterialRequest(Number(req.params.id), {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.json(pmr);
  } catch (e) {
    return next(e);
  }
});

const issueSchema = z.object({
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  remarks: z.string().max(4000).optional().nullable(),
  lines: z
    .array(
      z.object({
        pmrLineId: z.number().int().positive(),
        issueQty: z.number().positive(),
      }),
    )
    .min(1),
});

pmrRouter.post("/:id/issue", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const body = issueSchema.parse(req.body);
    const result = await issueMaterialAgainstPmr(Number(req.params.id), body, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

module.exports = { pmrRouter };
