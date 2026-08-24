const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { listShifts, getShiftById, createShift, updateShift } = require("../services/shiftService");

const shiftsRouter = express.Router();

const createBodySchema = z.object({
  shiftCode: z.string().min(1).max(32),
  shiftName: z.string().min(1).max(120),
  startTime: z.string().min(1).max(8),
  endTime: z.string().min(1).max(8),
  plannedBreakMinutes: z.coerce.number().int().optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
});

const updateBodySchema = z.object({
  shiftCode: z.string().min(1).max(32).optional(),
  shiftName: z.string().min(1).max(120).optional(),
  startTime: z.string().min(1).max(8).optional(),
  endTime: z.string().min(1).max(8).optional(),
  plannedBreakMinutes: z.coerce.number().int().optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const READ_ROLES = ["ADMIN", "PRODUCTION", "PRODUCTION_MANAGER", "STORE"];
const WRITE_ROLES = ["ADMIN", "PRODUCTION"];

shiftsRouter.get("/", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const includeInactive =
      String(req.query.includeInactive ?? "") === "1" || req.query.includeInactive === "true";
    const rows = await listShifts(prisma, { includeInactive });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

shiftsRouter.get("/:id", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await getShiftById(prisma, id);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

shiftsRouter.post("/", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const body = createBodySchema.parse(req.body ?? {});
    const row = await createShift(prisma, body);
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

shiftsRouter.patch("/:id", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = updateBodySchema.parse(req.body ?? {});
    const row = await updateShift(prisma, id, body);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

module.exports = { shiftsRouter, READ_ROLES, WRITE_ROLES };
