const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  normalizeUnitCode,
  findUnitDuplicateConflict,
  isUnitTallyLinked,
  getUnitUsageCounts,
  getUnitUsageCountsById,
  UNIT_EDIT_BLOCKED,
  UNIT_DELETE_IN_USE,
  UNIT_DELETE_TALLY_LINKED,
} = require("../services/unitMaster");

const unitsRouter = express.Router();
const unitWriteRoles = requireRole(["ADMIN", "STORE"]);

const unitMasterSelect = {
  id: true,
  unitName: true,
  unitCode: true,
  isActive: true,
  tallyName: true,
  tallyUnitSymbol: true,
  tallyGuid: true,
  tallyImportedAt: true,
};

function parsePositiveId(raw) {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Normal GET: active units only (dropdowns).
 * With includeInactive=true (ADMIN/STORE): all units + usage/Tally flags for Unit Master.
 */
unitsRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const role = req.user?.role;
    const canManage = role === "ADMIN" || role === "STORE";
    const includeInactive =
      canManage && String(req.query.includeInactive || "").toLowerCase() === "true";

    if (!includeInactive) {
      const rows = await prisma.unit.findMany({
        where: { isActive: true },
        orderBy: [{ unitName: "asc" }],
        select: { id: true, unitName: true, unitCode: true },
      });
      return res.json(rows);
    }

    const rows = await prisma.unit.findMany({
      orderBy: [{ unitName: "asc" }],
      select: unitMasterSelect,
    });
    const usageById = await getUnitUsageCountsById(prisma);
    const enriched = rows.map((u) => {
      const usage = usageById.get(u.id) || { itemCount: 0, bomCount: 0, inUse: false };
      const tallyLinked = isUnitTallyLinked(u);
      return {
        id: u.id,
        unitName: u.unitName,
        unitCode: u.unitCode,
        isActive: u.isActive,
        itemCount: usage.itemCount,
        bomCount: usage.bomCount,
        inUse: usage.inUse,
        tallyLinked,
        canEdit: !usage.inUse,
        canDelete: !usage.inUse && !tallyLinked,
      };
    });
    return res.json(enriched);
  } catch (e) {
    return next(e);
  }
});

unitsRouter.post("/", requireAuth, unitWriteRoles, async (req, res, next) => {
  try {
    const body = z
      .object({
        unitName: z.string().min(1).max(64),
        unitCode: z.string().max(16).optional().nullable(),
      })
      .parse(req.body);

    const unitName = body.unitName.trim();
    const unitCode = normalizeUnitCode(body.unitCode);
    if (!unitName) throw httpError(400, "Unit name is required");

    const existing = await prisma.unit.findMany({
      select: { id: true, unitName: true, unitCode: true },
    });
    const dup = findUnitDuplicateConflict(existing, { unitName, unitCode });
    if (dup) throw httpError(400, dup);

    const created = await prisma.unit.create({
      data: { unitName, unitCode, isActive: true },
      select: { id: true, unitName: true, unitCode: true, isActive: true },
    });
    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

/** Edit name/code only when completely unused. Never touches Tally identity fields. */
unitsRouter.patch("/:id", requireAuth, unitWriteRoles, async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (id == null) throw httpError(400, "Invalid unit id");

    const body = z
      .object({
        unitName: z.string().min(1).max(64),
        unitCode: z.string().max(16).optional().nullable(),
      })
      .parse(req.body);

    const existing = await prisma.unit.findUnique({
      where: { id },
      select: unitMasterSelect,
    });
    if (!existing) throw httpError(404, "Unit not found");

    const usage = await getUnitUsageCounts(prisma, id);
    if (usage.inUse) throw httpError(409, UNIT_EDIT_BLOCKED);

    const unitName = body.unitName.trim();
    const unitCode = normalizeUnitCode(body.unitCode);
    if (!unitName) throw httpError(400, "Unit name is required");

    const others = await prisma.unit.findMany({
      select: { id: true, unitName: true, unitCode: true },
    });
    const dup = findUnitDuplicateConflict(others, { unitName, unitCode, exceptId: id });
    if (dup) throw httpError(400, dup);

    const updated = await prisma.unit.update({
      where: { id },
      data: { unitName, unitCode },
      select: { id: true, unitName: true, unitCode: true, isActive: true },
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

unitsRouter.post("/:id/deactivate", requireAuth, unitWriteRoles, async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (id == null) throw httpError(400, "Invalid unit id");
    const existing = await prisma.unit.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!existing) throw httpError(404, "Unit not found");
    const updated = await prisma.unit.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, unitName: true, unitCode: true, isActive: true },
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

unitsRouter.post("/:id/activate", requireAuth, unitWriteRoles, async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (id == null) throw httpError(400, "Invalid unit id");
    const existing = await prisma.unit.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!existing) throw httpError(404, "Unit not found");
    const updated = await prisma.unit.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, unitName: true, unitCode: true, isActive: true },
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

unitsRouter.delete("/:id", requireAuth, unitWriteRoles, async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    if (id == null) throw httpError(400, "Invalid unit id");

    const existing = await prisma.unit.findUnique({
      where: { id },
      select: unitMasterSelect,
    });
    if (!existing) throw httpError(404, "Unit not found");

    if (isUnitTallyLinked(existing)) throw httpError(409, UNIT_DELETE_TALLY_LINKED);

    const usage = await getUnitUsageCounts(prisma, id);
    if (usage.inUse) throw httpError(409, UNIT_DELETE_IN_USE);

    await prisma.unit.delete({ where: { id } });
    return res.status(204).end();
  } catch (e) {
    return next(e);
  }
});

module.exports = { unitsRouter };
