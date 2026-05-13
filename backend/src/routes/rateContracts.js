const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { normalizeUtcDateOnly, getRateContractLineDelegate } = require("../services/rateContractService");

const rateContractsRouter = express.Router();

const dateInput = z.union([z.string().min(1), z.number(), z.coerce.date()]);

rateContractsRouter.get("/", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
    const itemId = req.query.itemId != null ? Number(req.query.itemId) : null;
    /** @type {import('@prisma/client').Prisma.RateContractLineWhereInput} */
    const where = { status: "APPROVED" };
    if (Number.isFinite(customerId) && customerId > 0) where.customerId = customerId;
    if (Number.isFinite(itemId) && itemId > 0) where.itemId = itemId;
    const rows = await prisma.rateContractLine.findMany({
      where,
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      take: 500,
      include: {
        customer: { select: { id: true, name: true } },
        item: { select: { id: true, itemName: true, itemType: true } },
      },
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

rateContractsRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = z
      .object({
        customerId: z.number().int().positive(),
        itemId: z.number().int().positive(),
        rate: z.number().positive(),
        gstRate: z.number().min(0).max(100),
        effectiveFrom: dateInput,
      })
      .parse(req.body);

    let eff = body.effectiveFrom instanceof Date ? body.effectiveFrom : new Date(body.effectiveFrom);
    if (Number.isNaN(eff.getTime())) {
      return res.status(400).json({ error: { message: "Invalid effectiveFrom date." } });
    }
    eff = normalizeUtcDateOnly(eff);
    if (!eff) {
      return res.status(400).json({ error: { message: "Invalid effectiveFrom date." } });
    }

    const rateContractLine = getRateContractLineDelegate(prisma);
    const row = await rateContractLine.create({
      data: {
        customerId: body.customerId,
        itemId: body.itemId,
        rate: String(body.rate),
        gstRate: String(body.gstRate),
        effectiveFrom: eff,
        status: "APPROVED",
      },
      include: {
        customer: { select: { id: true, name: true } },
        item: { select: { id: true, itemName: true } },
      },
    });
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

module.exports = { rateContractsRouter };
