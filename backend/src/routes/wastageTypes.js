const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  listWastageTypes,
  createWastageType,
  updateWastageType,
  reorderWastageTypes,
} = require("../services/wastageTypeService");

const wastageTypesRouter = express.Router();

wastageTypesRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === "true" && req.user?.role === "ADMIN";
    const rows = await listWastageTypes(prisma, { includeInactive });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

wastageTypesRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1).max(120) }).parse(req.body ?? {});
    const row = await createWastageType(prisma, body);
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

wastageTypesRouter.patch("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const row = await updateWastageType(prisma, id, body);
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

wastageTypesRouter.put("/reorder", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = z.object({ orderedIds: z.array(z.number().int().positive()).min(1) }).parse(req.body ?? {});
    const rows = await reorderWastageTypes(prisma, body.orderedIds);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

module.exports = { wastageTypesRouter };
