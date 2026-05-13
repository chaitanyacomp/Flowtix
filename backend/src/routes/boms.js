const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertAdminPassword } = require("../services/adminPasswordAuth");

const bomRouter = express.Router();

const BOM_EDIT_FORBIDDEN = "Access denied. Only administrators can edit BOMs.";
const BOM_DELETE_FORBIDDEN = "Access denied. Only administrators can delete BOMs.";
const BOM_CREATE_FORBIDDEN = "Access denied. Only administrators can create BOMs.";
const BOM_IN_USE_MESSAGE =
  "This BOM is already used in production. It cannot be deleted.";
const ADMIN_PW_MESSAGE = "Admin password is required to edit or delete locked BOM.";

const lineSchema = z.object({
  rmItemId: z.number().int(),
  baseQty: z.number().positive(),
  wastagePercent: z.number().nonnegative().optional(),
  processLossPercent: z.number().nonnegative().optional(),
  qcAllowancePercent: z.number().nonnegative().default(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

function normalizeBomLineInput(l) {
  const processLossPercent =
    l.processLossPercent != null ? Number(l.processLossPercent) : Number(l.wastagePercent ?? 0);
  const qcAllowancePercent = Number(l.qcAllowancePercent ?? 0);
  return {
    rmItemId: l.rmItemId,
    baseQty: l.baseQty,
    processLossPercent,
    qcAllowancePercent,
    notes: l.notes ? String(l.notes).trim() : null,
    // Compatibility: operational RM issue math still reads wastagePercent.
    wastagePercent: processLossPercent,
  };
}

function ensureUniqueRm(lines) {
  const seen = new Set();
  for (const l of lines) {
    if (seen.has(l.rmItemId)) return false;
    seen.add(l.rmItemId);
  }
  return true;
}

function bomLooksLocked(row) {
  return row?.isLocked !== false;
}

/**
 * FG is in use when it appears on a work order line or has production batches (covers WO / PE / BOM-driven RM ISSUE).
 */
async function fgHasBomProductionUsage(tx, fgItemId) {
  const [wol, pe] = await Promise.all([
    tx.workOrderLine.count({ where: { fgItemId } }),
    tx.productionEntry.count({ where: { workOrderLine: { fgItemId } } }),
  ]);
  return wol > 0 || pe > 0;
}

async function assertLockedBomAdminPassword(req, pwd) {
  const password = String(pwd ?? "").trim();
  if (!password) {
    const err = new Error("ADMIN_PASSWORD_REQUIRED");
    err.code = "ADMIN_PASSWORD_REQUIRED";
    err.statusCode = 403;
    throw err;
  }
  try {
    await assertAdminPassword(prisma, { userId: req.user.userId, password });
  } catch (_) {
    const err = new Error("ADMIN_PASSWORD_REQUIRED");
    err.code = "ADMIN_PASSWORD_REQUIRED";
    err.statusCode = 403;
    throw err;
  }
}

bomRouter.get("/", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION", "SALES", "QC"]), async (req, res, next) => {
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
bomRouter.get("/fg/:fgItemId", requireAuth, requireRole(["ADMIN", "STORE", "PRODUCTION", "SALES", "QC"]), async (req, res, next) => {
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
      adminPassword: z.string().optional(),
    });
    const body = schema.parse(req.body);
    const existing = await prisma.bom.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }

    if (bomLooksLocked(existing)) {
      await assertLockedBomAdminPassword(req, body.adminPassword);
    }

    if (!ensureUniqueRm(body.lines)) {
      const err = new Error("Duplicate RM item in BOM lines");
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.bomLine.deleteMany({ where: { bomId: id } });
      await tx.bom.update({
        where: { id },
        data: { isLocked: true, lockedAt: now },
      });
      await tx.bomLine.createMany({
        data: body.lines.map((raw) => {
          const l = normalizeBomLineInput(raw);
          return {
          bomId: id,
          rmItemId: l.rmItemId,
          baseQty: String(l.baseQty),
          wastagePercent: String(l.wastagePercent),
          processLossPercent: String(l.processLossPercent),
          qcAllowancePercent: String(l.qcAllowancePercent),
          notes: l.notes,
        };
        }),
      });
      return tx.bom.findUnique({
        where: { id },
        include: { fgItem: true, lines: { include: { rmItem: true } } },
      });
    });
    return res.json(updated);
  } catch (e) {
    if (e?.code === "ADMIN_PASSWORD_REQUIRED") {
      return res.status(403).json({
        error: "ADMIN_PASSWORD_REQUIRED",
        message: ADMIN_PW_MESSAGE,
      });
    }
    return next(e);
  }
});

bomRouter.delete("/:id", requireAuth, requireRole(["ADMIN"], BOM_DELETE_FORBIDDEN), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bodyParsed = z
      .object({ adminPassword: z.string().optional() })
      .safeParse(req.body && typeof req.body === "object" ? req.body : {});
    const adminPassword = bodyParsed.success ? bodyParsed.data.adminPassword : undefined;

    const bom = await prisma.bom.findUnique({ where: { id } });
    if (!bom) {
      const err = new Error("BOM not found");
      err.statusCode = 404;
      throw err;
    }

    const inUse = await fgHasBomProductionUsage(prisma, bom.fgItemId);
    if (inUse) {
      return res.status(400).json({
        error: "BOM_IN_USE",
        message: BOM_IN_USE_MESSAGE,
      });
    }

    if (bomLooksLocked(bom)) {
      try {
        await assertLockedBomAdminPassword(req, adminPassword);
      } catch (_) {
        return res.status(403).json({
          error: "ADMIN_PASSWORD_REQUIRED",
          message: ADMIN_PW_MESSAGE,
        });
      }
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

    const now = new Date();
    const created = await prisma.bom.create({
      data: {
        fgItemId: body.fgItemId,
        isLocked: true,
        lockedAt: now,
        lines: {
          create: body.lines.map((raw) => {
            const l = normalizeBomLineInput(raw);
            return {
            rmItemId: l.rmItemId,
            baseQty: String(l.baseQty),
            wastagePercent: String(l.wastagePercent),
            processLossPercent: String(l.processLossPercent),
            qcAllowancePercent: String(l.qcAllowancePercent),
            notes: l.notes,
          };
          }),
        },
      },
      include: { fgItem: true, lines: true },
    });
    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

module.exports = { bomRouter };
