/**
 * Phase 3D — Production Material Return (MRN).
 */

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  buildMaterialReturnFormContext,
  buildReturnableLinesForWorkOrder,
  createMaterialReturnNote,
  listMaterialReturnNotes,
  getMaterialReturnNoteById,
} = require("../services/materialReturnService");
const {
  WASTAGE_REASON_LABELS,
  buildWastageContextForLine,
  createMaterialWastageNote,
  listProductionRmDispositionHistory,
} = require("../services/materialWastageService");

const productionMaterialReturnRouter = express.Router();
const mrnRoles = ["ADMIN", "STORE", "PRODUCTION"];

productionMaterialReturnRouter.get(
  "/context",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const focusWorkOrderId = Number(req.query.workOrderId);
      const focusPmrId = Number(req.query.pmrId ?? req.query.productionMaterialRequestId);
      const data = await buildMaterialReturnFormContext(prisma, {
        focusWorkOrderId:
          Number.isFinite(focusWorkOrderId) && focusWorkOrderId > 0 ? focusWorkOrderId : null,
        focusPmrId: Number.isFinite(focusPmrId) && focusPmrId > 0 ? focusPmrId : null,
      });
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

productionMaterialReturnRouter.get(
  "/returnable",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const workOrderId = Number(req.query.workOrderId);
      if (!Number.isFinite(workOrderId)) {
        const err = new Error("workOrderId is required");
        err.statusCode = 400;
        throw err;
      }
      const productionMaterialRequestId = req.query.productionMaterialRequestId
        ? Number(req.query.productionMaterialRequestId)
        : null;
      const fromLocationId = req.query.fromLocationId ? Number(req.query.fromLocationId) : null;
      const toLocationId = req.query.toLocationId ? Number(req.query.toLocationId) : null;
      const data = await buildReturnableLinesForWorkOrder(prisma, {
        workOrderId,
        productionMaterialRequestId:
          productionMaterialRequestId && Number.isFinite(productionMaterialRequestId)
            ? productionMaterialRequestId
            : null,
        fromLocationId: fromLocationId && Number.isFinite(fromLocationId) ? fromLocationId : null,
        toLocationId: toLocationId && Number.isFinite(toLocationId) ? toLocationId : null,
      });
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

productionMaterialReturnRouter.get(
  "/history",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const rows = await listProductionRmDispositionHistory();
      return res.json(rows);
    } catch (e) {
      return next(e);
    }
  },
);

productionMaterialReturnRouter.get(
  "/wastage-reasons",
  requireAuth,
  requireRole(mrnRoles),
  async (_req, res) => {
    return res.json(
      Object.entries(WASTAGE_REASON_LABELS).map(([id, label]) => ({ id, label })),
    );
  },
);

productionMaterialReturnRouter.get(
  "/wastage-context",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const workOrderId = Number(req.query.workOrderId);
      const itemId = Number(req.query.itemId);
      if (!Number.isFinite(workOrderId) || !Number.isFinite(itemId)) {
        const err = new Error("workOrderId and itemId are required");
        err.statusCode = 400;
        throw err;
      }
      const productionMaterialRequestId = req.query.productionMaterialRequestId
        ? Number(req.query.productionMaterialRequestId)
        : null;
      const fromLocationId = req.query.fromLocationId ? Number(req.query.fromLocationId) : null;
      const data = await buildWastageContextForLine(prisma, {
        workOrderId,
        itemId,
        productionMaterialRequestId:
          productionMaterialRequestId && Number.isFinite(productionMaterialRequestId)
            ? productionMaterialRequestId
            : null,
        fromLocationId: fromLocationId && Number.isFinite(fromLocationId) ? fromLocationId : null,
      });
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

productionMaterialReturnRouter.get(
  "/",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      if (String(req.query.history || "") === "1") {
        const rows = await listProductionRmDispositionHistory();
        return res.json(rows);
      }
      const rows = await listMaterialReturnNotes();
      return res.json(rows);
    } catch (e) {
      return next(e);
    }
  },
);

productionMaterialReturnRouter.get(
  "/:id",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error("Invalid id");
        err.statusCode = 400;
        throw err;
      }
      const row = await getMaterialReturnNoteById(id);
      return res.json(row);
    } catch (e) {
      return next(e);
    }
  },
);

const createSchema = z.object({
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  workOrderId: z.number().int().positive(),
  productionMaterialRequestId: z.number().int().positive().optional().nullable(),
  remarks: z.string().max(4000).optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        returnQty: z.number().positive(),
        remarks: z.string().max(500).optional().nullable(),
      }),
    )
    .min(1),
});

productionMaterialReturnRouter.post(
  "/",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const note = await createMaterialReturnNote(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(201).json({ id: note.id, docNo: note.docNo });
    } catch (e) {
      return next(e);
    }
  },
);

const wastageSchema = z.object({
  workOrderId: z.number().int().positive(),
  fromLocationId: z.number().int().positive(),
  productionMaterialRequestId: z.number().int().positive().optional().nullable(),
  itemId: z.number().int().positive(),
  qty: z.number().positive(),
  reason: z.enum([
    "PROCESS_LOSS",
    "MACHINE_SETTING",
    "SPILLAGE",
    "CONTAMINATION",
    "PURGING",
    "OTHER",
  ]),
  remarks: z.string().min(1).max(4000),
});

productionMaterialReturnRouter.post(
  "/wastage",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const body = wastageSchema.parse(req.body);
      const note = await createMaterialWastageNote(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(201).json(note);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { productionMaterialReturnRouter };
