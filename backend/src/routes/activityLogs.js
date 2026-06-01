const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth } = require("../middleware/auth");

const activityLogsRouter = express.Router();

const listQuerySchema = z
  .object({
    module: z.string().min(1).max(64).optional(),
    entityType: z.string().min(1).max(64).optional(),
    entityId: z.coerce.number().int().positive().optional(),
    docNo: z.string().min(1).max(64).optional(),
    salesOrderId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  })
  .superRefine((q, ctx) => {
    if ((q.entityType && !q.entityId) || (!q.entityType && q.entityId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "entityType and entityId must be provided together.",
      });
    }
  });

/**
 * GET /api/activity-logs
 * Document-scoped history for authenticated users.
 */
activityLogsRouter.get("/activity-logs", requireAuth, async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);

    /** @type {import("@prisma/client').Prisma.ActivityLogWhereInput} */
    const where = {};

    if (q.salesOrderId != null) {
      if (q.module && q.module !== "STORE") {
        const err = new Error("salesOrderId filter applies only to DISPATCH module logs.");
        err.statusCode = 400;
        throw err;
      }
      where.module = "STORE";
      // MySQL JSON path syntax: Prisma expects a string path (e.g. "$.salesOrderId"), not an array.
      where.metadataJson = { path: "$.salesOrderId", equals: q.salesOrderId };
    } else {
      if (q.module) where.module = q.module;
      if (q.entityType && q.entityId) {
        where.entityType = q.entityType;
        where.entityId = q.entityId;
      }
      if (q.docNo) where.docNo = q.docNo.trim();
    }

    if (q.salesOrderId == null && !q.entityType && !q.docNo) {
      const err = new Error("Provide entityType+entityId, docNo, or salesOrderId for dispatch history.");
      err.statusCode = 400;
      throw err;
    }

    const rows = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit,
      select: {
        id: true,
        createdAt: true,
        userNameSnapshot: true,
        message: true,
        reason: true,
        action: true,
        module: true,
      },
    });

    return res.json({ rows });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const err = new Error(e.issues.map((x) => x.message).join("; "));
      err.statusCode = 400;
      return next(err);
    }
    return next(e);
  }
});

module.exports = { activityLogsRouter };
