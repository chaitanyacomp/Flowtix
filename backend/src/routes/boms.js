const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const bomRouter = express.Router();

/** Block delete when the FG item is referenced in operational/commercial tables (schema + routes use this FG). */
const BOM_DELETE_BLOCKED_DOWNSTREAM =
  "This BOM cannot be deleted while this finished good appears on a sales order, work order, dispatch, or scrap record. Remove or complete those references first.";
const BOM_EDIT_FORBIDDEN = "Access denied. Only administrators can edit BOMs.";
const BOM_DELETE_FORBIDDEN = "Access denied. Only administrators can delete BOMs.";
const BOM_CREATE_FORBIDDEN = "Access denied. Only administrators can create BOMs.";

const lineSchema = z.object({
  rmItemId: z.number().int(),
  baseQty: z.number().positive(),
  wastagePercent: z.number().nonnegative().default(0),
});

function ensureUniqueRm(lines) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.rmItemId)) return false;
    seen.add(l.rmItemId);
  }
  return true;
}

bomRouter.get("/", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION"]), async (req, res, next) => {
  try {
    const rows = await prisma.bom.findMany({
      orderBy: { id: "desc" },
      include: { fgItem: true, lines: { include: { rmItem: true } } },
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

// Get BOM by FG item id
bomRouter.get("/fg/:fgItemId", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION"]), async (req, res, next) => {
  try {
    const fgItemId = Number(req.params.fgItemId);
    const row = await prisma.bom.findUnique({
      where: { fgItemId },
      include: { fgItem: true, lines: { include: { rmItem: true } } },
    });
    if (!row) return res.status(404).json({ error: { message: "BOM not found" } });
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

bomRouter.put("/:id", requireAuth, requireRole(["ADMIN"], BOM_EDIT_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      lines: z.array(lineSchema).min(1),
    });
    const body = schema.parse(req.body);
    if (!ensureUniqueRm(body.lines)) {
      const err = new Error("Duplicate RM item in BOM lines");
      err.statusCode = 400;
      throw err;
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.bomLine.deleteMany({ where: { bomId: id } });
      await tx.bomLine.createMany({
        data: body.lines.map((l) => ({
          bomId: id,
          rmItemId: l.rmItemId,
          baseQty: String(l.baseQty),
          wastagePercent: String(l.wastagePercent),
        })),
      });
      return tx.bom.findUnique({
        where: { id },
        include: { fgItem: true, lines: { include: { rmItem: true } } },
      });
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

bomRouter.delete("/:id", requireAuth, requireRole(["ADMIN"], BOM_DELETE_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bom = await prisma.bom.findUnique({ where: { id } });
    if (!bom) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }
    const fgItemId = bom.fgItemId;
    const [workOrderLines, salesOrderLines, dispatches, scrapRows] = await Promise.all([
      prisma.workOrderLine.count({ where: { fgItemId } }),
      prisma.salesOrderLine.count({ where: { itemId: fgItemId } }),
      prisma.dispatch.count({ where: { itemId: fgItemId } }),
      prisma.scrapRecord.count({ where: { fgItemId } }),
    ]);
    if (workOrderLines + salesOrderLines + dispatches + scrapRows > 0) {
      const err = new Error(BOM_DELETE_BLOCKED_DOWNSTREAM);
      err.statusCode = 409;
      throw err;
    }
    await prisma.bom.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

bomRouter.post("/", requireAuth, requireRole(["ADMIN"], BOM_CREATE_FORBIDDEN), async (req, res, next) => {
  try {
    const schema = z.object({
      fgItemId: z.number().int(),
      lines: z.array(lineSchema).min(1),
    });
    const body = schema.parse(req.body);
    if (!ensureUniqueRm(body.lines)) {
      const err = new Error("Each raw material can only appear once on a BOM.");
      err.statusCode = 400;
      throw err;
    }

    const created = await prisma.bom.create({
      data: {
        fgItemId: body.fgItemId,
        lines: {
          create: body.lines.map((l) => ({
            rmItemId: l.rmItemId,
            baseQty: String(l.baseQty),
            wastagePercent: String(l.wastagePercent),
          })),
        },
      },
      include: { lines: true },
    });
    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

module.exports = { bomRouter };
