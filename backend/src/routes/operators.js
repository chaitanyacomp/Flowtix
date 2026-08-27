const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listOperators,
  getOperatorById,
  createOperator,
  updateOperator,
} = require("../services/operatorService");

const operatorsRouter = express.Router();

const createBodySchema = z.object({
  operatorCode: z.string().min(1).max(32),
  operatorName: z.string().min(1).max(120),
  employeeNumber: z.string().max(64).optional().nullable(),
  department: z.string().max(120).optional().nullable(),
  designationSkill: z.string().max(120).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
});

const updateBodySchema = z.object({
  operatorCode: z.string().min(1).max(32).optional(),
  operatorName: z.string().min(1).max(120).optional(),
  employeeNumber: z.string().max(64).optional().nullable(),
  department: z.string().max(120).optional().nullable(),
  designationSkill: z.string().max(120).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const READ_ROLES = ["ADMIN", "PRODUCTION", "PRODUCTION_MANAGER", "STORE"];
/** ADMIN maintains masters; PRODUCTION may update registers; PRODUCTION_MANAGER is read-only. */
const WRITE_ROLES = ["ADMIN", "PRODUCTION"];

operatorsRouter.get("/", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const includeInactive =
      String(req.query.includeInactive ?? "") === "1" || req.query.includeInactive === "true";
    const rows = await listOperators(prisma, { includeInactive });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

operatorsRouter.get("/:id", requireAuth, requireRole(READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await getOperatorById(prisma, id);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

operatorsRouter.post("/", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const body = createBodySchema.parse(req.body ?? {});
    const row = await createOperator(prisma, body);
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

operatorsRouter.patch("/:id", requireAuth, requireRole(WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = updateBodySchema.parse(req.body ?? {});
    const row = await updateOperator(prisma, id, body);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

module.exports = { operatorsRouter, READ_ROLES, WRITE_ROLES };
