const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listFgProductionStandards,
  getFgProductionStandardById,
  createFgProductionStandard,
  updateFgProductionStandard,
  previewFgProductionStandard,
} = require("../services/fgProductionStandardService");

const fgProductionStandardsRouter = express.Router();

const createBodySchema = z.object({
  itemId: z.coerce.number().int().positive(),
  machineId: z.coerce.number().int().positive(),
  cycleTimeSeconds: z.coerce.number().positive(),
  piecesPerCycle: z.coerce.number().int().positive().optional().nullable(),
  standardEfficiencyPercent: z.coerce.number().positive().max(100).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
});

const updateBodySchema = z.object({
  itemId: z.coerce.number().int().positive().optional(),
  machineId: z.coerce.number().int().positive().optional(),
  cycleTimeSeconds: z.coerce.number().positive().optional(),
  piecesPerCycle: z.coerce.number().int().positive().optional().nullable(),
  standardEfficiencyPercent: z.coerce.number().positive().max(100).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const previewBodySchema = z.object({
  cycleTimeSeconds: z.coerce.number().positive(),
  piecesPerCycle: z.coerce.number().int().positive().optional().nullable(),
  standardEfficiencyPercent: z.coerce.number().positive().max(100).optional().nullable(),
  shiftId: z.coerce.number().int().positive().optional().nullable(),
  netShiftMinutes: z.coerce.number().positive().optional().nullable(),
});

const READ_ROLES = ["ADMIN", "PRODUCTION", "STORE"];
const WRITE_ROLES = ["ADMIN", "PRODUCTION"];

fgProductionStandardsRouter.get("/", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const includeInactive =
      String(req.query.includeInactive ?? "") === "1" || req.query.includeInactive === "true";
    const rows = await listFgProductionStandards(prisma, { includeInactive });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

fgProductionStandardsRouter.post("/preview", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const body = previewBodySchema.parse(req.body ?? {});
    if (body.shiftId == null && body.netShiftMinutes == null) {
      return res.status(400).json({
        error: { message: "Select an active preview shift (or provide net shift minutes)." },
      });
    }
    const preview = await previewFgProductionStandard(prisma, body);
    return res.json(preview);
  } catch (e) {
    return next(e);
  }
});

fgProductionStandardsRouter.get("/:id", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await getFgProductionStandardById(prisma, id);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

fgProductionStandardsRouter.post("/", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const body = createBodySchema.parse(req.body ?? {});
    const row = await createFgProductionStandard(prisma, body);
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

fgProductionStandardsRouter.patch("/:id", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = updateBodySchema.parse(req.body ?? {});
    const row = await updateFgProductionStandard(prisma, id, body);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

module.exports = { fgProductionStandardsRouter, READ_ROLES, WRITE_ROLES };
