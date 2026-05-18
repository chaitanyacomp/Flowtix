const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  normalizeUtcDateOnly,
  getRateContractLineDelegate,
  assertEffectiveFromNotFuture,
  deactivateFutureApprovedRateContractLines,
  endOfUtcCalendarDay,
} = require("../services/rateContractService");
const { assertAdminPassword } = require("../services/adminPasswordAuth");

const rateContractsRouter = express.Router();

const dateInput = z.union([z.string().min(1), z.number(), z.coerce.date()]);
const mutationSchema = z.object({
  customerId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  rate: z.number().positive(),
  gstRate: z.number().min(0).max(100),
  effectiveFrom: dateInput,
  adminPassword: z.string().min(1),
});

function parseEffectiveFrom(input) {
  let eff = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(eff.getTime())) return null;
  return assertEffectiveFromNotFuture(normalizeUtcDateOnly(eff));
}

function includeContractRefs() {
  return {
    customer: { select: { id: true, name: true } },
    item: { select: { id: true, itemName: true, itemType: true } },
    revisedFrom: { select: { id: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    deactivatedBy: { select: { id: true, name: true, email: true } },
  };
}

rateContractsRouter.get("/", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
    const itemId = req.query.itemId != null ? Number(req.query.itemId) : null;
    const includeHistory = req.user?.role === "ADMIN" && String(req.query.includeHistory ?? "") === "1";
    const todayEnd = endOfUtcCalendarDay(new Date());
    /** @type {import('@prisma/client').Prisma.RateContractLineWhereInput} */
    const where = includeHistory ? {} : { status: "APPROVED" };
    if (!includeHistory && todayEnd) {
      where.effectiveFrom = { lte: todayEnd };
    }
    if (Number.isFinite(customerId) && customerId > 0) where.customerId = customerId;
    if (Number.isFinite(itemId) && itemId > 0) where.itemId = itemId;
    const rows = await prisma.rateContractLine.findMany({
      where,
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      take: 500,
      include: includeContractRefs(),
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

rateContractsRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = mutationSchema.parse(req.body);
    await assertAdminPassword(prisma, { userId: req.user.userId, password: body.adminPassword });

    let eff;
    try {
      eff = parseEffectiveFrom(body.effectiveFrom);
    } catch (e) {
      const status = e?.statusCode === 400 ? 400 : 400;
      return res.status(status).json({ error: { message: e?.message ?? "Invalid effectiveFrom date." } });
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
        createdByUserId: req.user.userId,
      },
      include: includeContractRefs(),
    });
    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

rateContractsRouter.put("/:id/revise", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid rate contract id." } });
    }

    const body = mutationSchema.parse(req.body);
    await assertAdminPassword(prisma, { userId: req.user.userId, password: body.adminPassword });

    let eff;
    try {
      eff = parseEffectiveFrom(body.effectiveFrom);
    } catch (e) {
      const status = e?.statusCode === 400 ? 400 : 400;
      return res.status(status).json({ error: { message: e?.message ?? "Invalid effectiveFrom date." } });
    }

    const row = await prisma.$transaction(async (tx) => {
      const rateContractLine = getRateContractLineDelegate(tx);
      const previous = await rateContractLine.findUnique({ where: { id } });
      if (!previous) {
        const err = new Error("Rate contract not found.");
        err.statusCode = 404;
        throw err;
      }
      if (previous.status !== "APPROVED") {
        const err = new Error("Only active approved rate contracts can be revised.");
        err.statusCode = 409;
        throw err;
      }

      await rateContractLine.update({
        where: { id },
        data: { status: "SUPERSEDED", deactivatedAt: new Date(), deactivatedByUserId: req.user.userId },
      });

      return rateContractLine.create({
        data: {
          customerId: body.customerId,
          itemId: body.itemId,
          rate: String(body.rate),
          gstRate: String(body.gstRate),
          effectiveFrom: eff,
          status: "APPROVED",
          revisedFromId: previous.id,
          createdByUserId: req.user.userId,
        },
        include: includeContractRefs(),
      });
    });

    return res.status(201).json(row);
  } catch (e) {
    return next(e);
  }
});

rateContractsRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: { message: "Invalid rate contract id." } });
    }
    const body = z.object({ adminPassword: z.string().min(1) }).parse(req.body ?? {});
    await assertAdminPassword(prisma, { userId: req.user.userId, password: body.adminPassword });

    const rateContractLine = getRateContractLineDelegate(prisma);
    const existing = await rateContractLine.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: { message: "Rate contract not found." } });
    }
    if (existing.status === "INACTIVE") {
      return res.status(409).json({ error: { message: "Rate contract is already inactive." } });
    }

    const row = await rateContractLine.update({
      where: { id },
      data: {
        status: "INACTIVE",
        deactivatedAt: new Date(),
        deactivatedByUserId: req.user.userId,
      },
      include: includeContractRefs(),
    });
    return res.json(row);
  } catch (e) {
    return next(e);
  }
});

rateContractsRouter.post("/deactivate-future", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const body = z.object({ adminPassword: z.string().min(1) }).parse(req.body ?? {});
    await assertAdminPassword(prisma, { userId: req.user.userId, password: body.adminPassword });

    const { count } = await deactivateFutureApprovedRateContractLines(prisma, { userId: req.user.userId });
    return res.json({
      ok: true,
      deactivatedCount: count,
      message:
        count > 0
          ? `Deactivated ${count} future-dated approved rate contract${count === 1 ? "" : "s"}.`
          : "No future-dated approved rate contracts found.",
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = { rateContractsRouter };
