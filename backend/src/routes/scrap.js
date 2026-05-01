const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const scrapRouter = express.Router();

// Reporting: scrap/loss list (not stock). Filters are optional.
scrapRouter.get("/", requireAuth, requireRole(["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"]), async (req, res, next) => {
  try {
    const schema = z.object({
      fgItemId: z.string().optional(),
      workOrderId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      take: z.string().optional(),
    });
    const q = schema.parse(req.query);

    const fgItemId = q.fgItemId ? Number(q.fgItemId) : undefined;
    const workOrderId = q.workOrderId ? Number(q.workOrderId) : undefined;
    const from = q.from ? new Date(String(q.from)) : undefined;
    const to = q.to ? new Date(String(q.to)) : undefined;
    const take = q.take ? Math.min(500, Math.max(1, Number(q.take))) : 200;

    const where = {
      ...(Number.isFinite(fgItemId) ? { fgItemId } : {}),
      ...(Number.isFinite(workOrderId) ? { workOrderId } : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const rows = await prisma.scrapRecord.findMany({
      where,
      orderBy: { id: "desc" },
      take,
      include: {
        fgItem: true,
        workOrder: true,
      },
    });

    return res.json(
      rows.map((r) => ({
        id: r.id,
        date: r.date,
        fgItemId: r.fgItemId,
        fgItemName: r.fgItem.itemName,
        rejectedQty: Number(r.rejectedQty),
        reason: r.reason,
        workOrderId: r.workOrderId,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

module.exports = { scrapRouter };

