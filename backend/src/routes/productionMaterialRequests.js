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
  getExistingProductionMaterialRequestForWorkOrder,
  createProductionMaterialRequest,
  submitProductionMaterialRequest,
  cancelProductionMaterialRequest,
  issueMaterialAgainstPmr,
  buildPmrIssueContext,
  waiveRemainingPmrQty,
  releaseWorkOrderMaterialToProduction,
  acknowledgePmrIssueLater,
  ensureSubmittedProductionMaterialRequestForWorkOrder,
  STORE_ISSUE_STATUSES,
  PMR_ISSUED_STATUSES,
  PMR_SHORT_ISSUE_WAIVE_REASONS,
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

pmrRouter.get("/release-handoff-queue", requireAuth, requireRole(readRoles), async (req, res, next) => {
  try {
    const { buildStoreProductionReleaseHandoffQueue } = require("../services/pendingActionsService");
    const rows = await buildStoreProductionReleaseHandoffQueue(prisma);
    return res.json({ count: rows.length, rows });
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

pmrRouter.get("/for-work-order/:workOrderId/release-handoff", requireAuth, requireRole(readRoles), async (req, res, next) => {
  try {
    const pmr = await getExistingProductionMaterialRequestForWorkOrder(Number(req.params.workOrderId), prisma, {
      statuses: PMR_ISSUED_STATUSES,
      preferIssued: true,
    });
    if (!pmr) {
      const err = new Error("No issued PMR exists for this work order release handoff.");
      err.statusCode = 404;
      err.code = "ISSUED_PMR_NOT_FOUND_FOR_WORK_ORDER";
      throw err;
    }
    return res.json(pmr);
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

// Lookup/reuse the PMR for a work order. This endpoint must not create PMRs;
// PMR auto-creation belongs only to the Work Order creation transaction/path.
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
      select: { id: true },
    });
    if (!wo) {
      const err = new Error("Work order not found");
      err.statusCode = 404;
      throw err;
    }
    const pmr = await ensureSubmittedProductionMaterialRequestForWorkOrder(
      workOrderId,
      { userId: req.user?.userId, role: req.user?.role },
      prisma,
      { allowCreate: false },
    );
    if (!STORE_ISSUE_STATUSES.includes(String(pmr?.status ?? "").trim().toUpperCase())) {
      const err = new Error("No PMR is pending material issue for this work order.");
      err.statusCode = 404;
      err.code = "PMR_NOT_PENDING_MATERIAL_ISSUE_FOR_WORK_ORDER";
      throw err;
    }
    return res.status(200).json(pmr);
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
        theoreticalBomQty: z.number().nonnegative(),
        includedRunnerQty: z.number().nonnegative().optional().default(0),
        allowanceInputSource: z.enum(["QUANTITY"]).optional().default("QUANTITY"),
        enteredAllowanceQty: z.number().nonnegative().optional().nullable(),
        plannedAllowancePct: z.number().min(0).max(10).optional(),
        plannedAllowanceQty: z.number().nonnegative().optional(),
        recommendedIssueQty: z.number().nonnegative().optional(),
        allowanceReason: z.string().max(500).optional().nullable(),
        allowanceApprovalRequestId: z.number().int().positive().optional().nullable(),
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

const waiveSchema = z.object({
  reason: z.enum(PMR_SHORT_ISSUE_WAIVE_REASONS),
  remarks: z.string().max(4000).optional().nullable(),
});

pmrRouter.post("/:id/waive-remaining", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const body = waiveSchema.parse(req.body);
    const pmr = await waiveRemainingPmrQty(Number(req.params.id), body, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.json(pmr);
  } catch (e) {
    return next(e);
  }
});

pmrRouter.post("/:id/issue-later", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const pmr = await acknowledgePmrIssueLater(Number(req.params.id), {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.json(pmr);
  } catch (e) {
    return next(e);
  }
});

const releaseSchema = z.object({
  remarks: z.string().max(4000).optional().nullable(),
});

pmrRouter.post("/:id/release-to-production", requireAuth, requireRole(storeRoles), async (req, res, next) => {
  try {
    const body = releaseSchema.parse(req.body ?? {});
    const pmrId = Number(req.params.id);
    const pmr = await getProductionMaterialRequestById(pmrId);
    const result = await releaseWorkOrderMaterialToProduction(
      pmr.workOrderId,
      { pmrId, remarks: body.remarks },
      { userId: req.user?.userId, role: req.user?.role },
    );
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

module.exports = { pmrRouter };
