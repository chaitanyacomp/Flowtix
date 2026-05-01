const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { normalizeUnitKey } = require("../services/unitMaster");

const unitsRouter = express.Router();

unitsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.unit.findMany({
      where: { isActive: true },
      orderBy: [{ unitName: "asc" }],
      select: { id: true, unitName: true, unitCode: true },
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

unitsRouter.post("/", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const body = z
      .object({
        unitName: z.string().min(1).max(64),
        unitCode: z.string().max(16).optional().nullable(),
      })
      .parse(req.body);

    const unitName = body.unitName.trim();
    const unitCode = body.unitCode != null ? body.unitCode.trim() : null;
    if (!unitName) {
      const err = new Error("Unit name is required");
      err.statusCode = 400;
      throw err;
    }

    // Case/space-insensitive duplicate protection (minimal, safe).
    const existing = await prisma.unit.findMany({ select: { id: true, unitName: true, unitCode: true, isActive: true } });
    const key = normalizeUnitKey(unitName);
    const dup = existing.some((u) => normalizeUnitKey(u.unitName) === key);
    if (dup) {
      const err = new Error("Unit already exists");
      err.statusCode = 400;
      throw err;
    }

    const created = await prisma.unit.create({
      data: { unitName, unitCode: unitCode || null, isActive: true },
      select: { id: true, unitName: true, unitCode: true },
    });
    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

unitsRouter.delete("/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid unit id");
      err.statusCode = 400;
      throw err;
    }
    const inUse = await prisma.item.count({ where: { unitId: id } });
    if (inUse > 0) {
      const err = new Error("Unit is in use and cannot be deleted.");
      err.statusCode = 409;
      throw err;
    }
    await prisma.unit.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) {
    return next(e);
  }
});

module.exports = { unitsRouter };

