const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { resolveScrapReportDateFilters } = require("../services/scrapReportDateFilters");

const scrapRouter = express.Router();

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = "VALIDATION";
  return err;
}

// Reporting: scrap/loss list (not stock). Filters are optional.
scrapRouter.get("/", requireAuth, requireRole(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"]), async (req, res, next) => {
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
    const take = q.take ? Math.min(500, Math.max(1, Number(q.take))) : 200;

    const dateRange = resolveScrapReportDateFilters(q.from, q.to);
    if (!dateRange.ok) throw badRequest(dateRange.message);

    const where = {
      ...(Number.isFinite(fgItemId) ? { fgItemId } : {}),
      ...(Number.isFinite(workOrderId) ? { workOrderId } : {}),
      ...(dateRange.from || dateRange.to
        ? {
            date: {
              ...(dateRange.from ? { gte: dateRange.from } : {}),
              ...(dateRange.to ? { lte: dateRange.to } : {}),
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
