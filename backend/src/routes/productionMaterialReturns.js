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

const productionMaterialReturnRouter = express.Router();
const mrnRoles = ["ADMIN", "STORE", "PRODUCTION"];

productionMaterialReturnRouter.get(
  "/context",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
      const data = await buildMaterialReturnFormContext();
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
  "/",
  requireAuth,
  requireRole(mrnRoles),
  async (req, res, next) => {
    try {
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
        userId: req.user?.id,
        role: req.user?.role,
      });
      return res.status(201).json({ id: note.id, docNo: note.docNo });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { productionMaterialReturnRouter };
