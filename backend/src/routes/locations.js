/**
 * Location Master — physical/process inventory locations (not stock buckets).
 */

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  allocateLocationCode,
  itemTypeFlagsFromCheckboxes,
  assertAtLeastOneItemType,
  mapLocationRow,
} = require("../services/locationService");

const locationsRouter = express.Router();

const locationTypeEnum = z.enum([
  "RM_STORE",
  "PRODUCTION",
  "FG_STORE",
  "WIP",
  "SCRAP",
  "VENDOR",
  "CONSUMABLE",
  "STORE",
]);

const departmentEnum = z.enum(["STORES", "PRODUCTION", "PURCHASE", "PLANT_HEAD"]);

const writeBodySchema = z.object({
  locationName: z.string().min(1).max(128),
  locationType: locationTypeEnum,
  departmentOwner: departmentEnum,
  allowRm: z.boolean().optional(),
  allowFg: z.boolean().optional(),
  allowSfg: z.boolean().optional(),
  allowConsumable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

locationsRouter.get("/", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION"]), async (req, res, next) => {
  try {
    const includeInactive = String(req.query.includeInactive ?? "") === "1";
    const rows = await prisma.location.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isSystem: "desc" }, { locationName: "asc" }],
    });
    return res.json(rows.map(mapLocationRow));
  } catch (e) {
    return next(e);
  }
});

locationsRouter.get("/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.location.findUnique({ where: { id } });
    if (!row) {
      const err = new Error("Location not found");
      err.statusCode = 404;
      throw err;
    }
    return res.json(mapLocationRow(row));
  } catch (e) {
    return next(e);
  }
});

locationsRouter.post("/", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const body = writeBodySchema.parse(req.body);
    const flags = itemTypeFlagsFromCheckboxes(body);
    assertAtLeastOneItemType(flags);

    const created = await prisma.$transaction(async (tx) => {
      const locationCode = await allocateLocationCode(tx);
      return tx.location.create({
        data: {
          locationCode,
          locationName: body.locationName.trim(),
          locationType: body.locationType,
          departmentOwner: body.departmentOwner,
          ...flags,
          isActive: body.isActive !== false,
          isSystem: false,
        },
      });
    });
    return res.status(201).json(mapLocationRow(created));
  } catch (e) {
    return next(e);
  }
});

locationsRouter.put("/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = writeBodySchema.parse(req.body);
    const flags = itemTypeFlagsFromCheckboxes(body);
    assertAtLeastOneItemType(flags);

    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("Location not found");
      err.statusCode = 404;
      throw err;
    }

    const updated = await prisma.location.update({
      where: { id },
      data: {
        locationName: body.locationName.trim(),
        locationType: body.locationType,
        departmentOwner: body.departmentOwner,
        ...flags,
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    return res.json(mapLocationRow(updated));
  } catch (e) {
    return next(e);
  }
});

locationsRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("Location not found");
      err.statusCode = 404;
      throw err;
    }
    if (existing.isSystem) {
      const err = new Error("System locations cannot be deleted.");
      err.statusCode = 400;
      throw err;
    }
    const inUse = await prisma.stockTransaction.count({ where: { locationId: id } });
    if (inUse > 0) {
      const err = new Error("Location has stock history and cannot be deleted. Deactivate instead.");
      err.statusCode = 409;
      throw err;
    }
    await prisma.location.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) {
    return next(e);
  }
});

module.exports = { locationsRouter };
