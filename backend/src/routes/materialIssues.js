/**
 * Phase 3A — Material Issue (Store → Production location transfer).
 */

const express = require("express");
const { z } = require("zod");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  buildMaterialIssueFormContext,
  createMaterialIssueNote,
  listMaterialIssueNotes,
  getAvailableRmAtLocation,
  buildStockGroupedByLocation,
} = require("../services/materialIssueService");

const materialIssueRouter = express.Router();
const storeRoles = ["ADMIN", "STORE"];

materialIssueRouter.get(
  "/context",
  requireAuth,
  requireRole(storeRoles),
  async (req, res, next) => {
    try {
      const data = await buildMaterialIssueFormContext();
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

materialIssueRouter.get(
  "/available",
  requireAuth,
  requireRole(storeRoles),
  async (req, res, next) => {
    try {
      const fromLocationId = Number(req.query.fromLocationId);
      const itemId = Number(req.query.itemId);
      if (!Number.isFinite(fromLocationId) || !Number.isFinite(itemId)) {
        const err = new Error("fromLocationId and itemId are required");
        err.statusCode = 400;
        throw err;
      }
      const availability = await getAvailableRmAtLocation(itemId, fromLocationId);
      return res.json({ itemId, fromLocationId, ...availability });
    } catch (e) {
      return next(e);
    }
  },
);

materialIssueRouter.get(
  "/",
  requireAuth,
  requireRole(storeRoles),
  async (req, res, next) => {
    try {
      const rows = await listMaterialIssueNotes();
      return res.json(rows);
    } catch (e) {
      return next(e);
    }
  },
);

materialIssueRouter.get(
  "/stock-by-location-grouped",
  requireAuth,
  requireRole(["ADMIN", "STORE", "PRODUCTION", "QA"]),
  async (req, res, next) => {
    try {
      const data = await buildStockGroupedByLocation();
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

const createSchema = z.object({
  fromLocationId: z.number().int().positive(),
  toLocationId: z.number().int().positive(),
  workOrderId: z.number().int().positive().optional().nullable(),
  remarks: z.string().max(4000).optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        issueQty: z.number().positive(),
      }),
    )
    .min(1),
});

materialIssueRouter.post(
  "/",
  requireAuth,
  requireRole(storeRoles),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const note = await createMaterialIssueNote(body, {
        userId: req.user?.userId,
        role: req.user?.role,
      });
      return res.status(201).json({
        id: note.id,
        docNo: note.docNo,
        fromLocation: note.fromLocation,
        toLocation: note.toLocation,
        workOrderNo: note.workOrder?.docNo ?? null,
        lines: note.lines.map((ln) => ({
          itemId: ln.itemId,
          itemName: ln.item?.itemName,
          issueQty: ln.issueQty,
          unit: ln.unitSnapshot,
        })),
      });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { materialIssueRouter };
