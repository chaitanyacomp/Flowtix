const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { AuditAction, AuditEntityType } = require("../prismaClientPackage");

const activityRouter = express.Router();

/** Who may view the global audit trail (sensitive). */
const ACTIVITY_ROLES = ["ADMIN"];

const areaSchema = z.enum(["ALL", "SALES", "PRODUCTION_QC", "DISPATCH", "STOCK", "SESSION"]);

const AREA_ENTITY_TYPES = {
  ALL: null,
  SALES: [AuditEntityType.SALES_ORDER],
  PRODUCTION_QC: [AuditEntityType.PRODUCTION_ENTRY, AuditEntityType.QC_ENTRY],
  DISPATCH: [AuditEntityType.DISPATCH],
  STOCK: [AuditEntityType.STOCK_ADJUSTMENT],
  SESSION: [AuditEntityType.USER_SESSION],
};

/**
 * Users for the "Who" filter (minimal list).
 */
activityRouter.get("/actors", requireAuth, requireRole(ACTIVITY_ROLES), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return res.json(users);
  } catch (e) {
    return next(e);
  }
});

const listQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  actorUserId: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  action: z.nativeEnum(AuditAction).optional(),
  area: areaSchema.optional().default("ALL"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

function parseDayBoundary(isoDate, endOfDay) {
  if (!isoDate || typeof isoDate !== "string") return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoDate.trim()) ? new Date(`${isoDate.trim()}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * Paginated audit log list for the Activity UI.
 */
activityRouter.get("/", requireAuth, requireRole(ACTIVITY_ROLES), async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    /** @type {import('@prisma/client').Prisma.AuditLogWhereInput} */
    const where = {};

    const from = parseDayBoundary(q.from, false);
    const to = parseDayBoundary(q.to, true);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    if (q.actorUserId) {
      where.actorUserId = q.actorUserId;
    }

    if (q.action) {
      where.action = q.action;
    }

    const types = AREA_ENTITY_TYPES[q.area];
    if (types && types.length) {
      where.entityType = { in: types };
    }

    const skip = (q.page - 1) * q.pageSize;

    const [total, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: q.pageSize,
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return res.json({
      rows,
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const err = new Error(e.issues.map((x) => x.message).join("; "));
      err.statusCode = 400;
      return next(err);
    }
    return next(e);
  }
});

module.exports = { activityRouter };
