const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { createSalesOrderFromPo } = require("../services/salesOrderFromPo");

const poRouter = express.Router();

function lineTotal(qty, rate, discountPct, gstPct) {
  const base = Number(qty) * Number(rate) * (1 - Number(discountPct) / 100);
  const gst = base * (Number(gstPct) / 100);
  return (Math.round((base + gst) * 100) / 100).toFixed(2);
}

poRouter.post("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const schema = z.object({
      customerId: z.number().int(),
      supplierId: z.number().int().optional().nullable(),
      poNumber: z.string().trim().min(1, "PO Number is required"),
      poDate: z.coerce.date(),
      requiredDate: z.coerce.date().optional().nullable(),
      lines: z
        .array(
          z.object({
            itemId: z.number().int(),
            qty: z.number().positive(),
            rate: z.number().nonnegative(),
            discountPct: z.number().nonnegative().default(0),
            gstPct: z.number().nonnegative().default(18),
          }),
        )
        .min(1),
    });
    const body = schema.parse(req.body);

    const lineCreates = body.lines.map((l) => ({
      itemId: l.itemId,
      qty: String(l.qty),
      rate: String(l.rate),
      discountPct: String(l.discountPct),
      gstPct: String(l.gstPct),
      lineTotal: lineTotal(l.qty, l.rate, l.discountPct, l.gstPct),
    }));

    const po = await prisma.customerPO.create({
      data: {
        customerId: body.customerId,
        ...(body.supplierId != null ? { supplierId: body.supplierId } : {}),
        poNumber: body.poNumber.trim(),
        poDate: body.poDate,
        requiredDate: body.requiredDate ?? null,
        status: "PENDING",
        lines: { create: lineCreates },
      },
      include: { lines: { include: { item: true } }, customer: true },
    });

    return res.status(201).json({ po });
  } catch (err) {
    return next(err);
  }
});

poRouter.put("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      supplierId: z.number().int().optional().nullable(),
      poNumber: z.string().trim().min(1).optional(),
      poDate: z.coerce.date().optional(),
      requiredDate: z.coerce.date().optional().nullable(),
      lines: z
        .array(
          z.object({
            itemId: z.number().int(),
            qty: z.number().positive(),
            rate: z.number().nonnegative(),
            discountPct: z.number().nonnegative().default(0),
            gstPct: z.number().nonnegative().default(18),
          }),
        )
        .min(1),
    });
    const body = schema.parse(req.body);

    const existingSo = await prisma.salesOrder.findUnique({ where: { poId: id } });
    if (existingSo) {
      const err = new Error("Cannot edit PO after sales order exists");
      err.statusCode = 400;
      throw err;
    }

    const lineCreates = body.lines.map((l) => ({
      itemId: l.itemId,
      qty: String(l.qty),
      rate: String(l.rate),
      discountPct: String(l.discountPct),
      gstPct: String(l.gstPct),
      lineTotal: lineTotal(l.qty, l.rate, l.discountPct, l.gstPct),
    }));

    const po = await prisma.$transaction(async (tx) => {
      await tx.customerPOLine.deleteMany({ where: { poId: id } });
      await tx.customerPO.update({
        where: { id },
        data: {
          supplierId: body.supplierId === undefined ? undefined : body.supplierId,
          poNumber: body.poNumber === undefined ? undefined : body.poNumber.trim(),
          poDate: body.poDate === undefined ? undefined : body.poDate,
          requiredDate: body.requiredDate === undefined ? undefined : body.requiredDate,
          lines: { create: lineCreates },
        },
      });
      return tx.customerPO.findUnique({
        where: { id },
        include: { lines: { include: { item: true } }, customer: true, supplier: true },
      });
    });

    return res.json(po);
  } catch (err) {
    return next(err);
  }
});

poRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const so = await prisma.salesOrder.findUnique({ where: { poId: id } });
    if (so) {
      const err = new Error("Cannot delete PO with sales order");
      err.statusCode = 400;
      throw err;
    }
    await prisma.customerPO.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

poRouter.post("/:id/apply-decision", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { salesOrder, created } = await createSalesOrderFromPo(id);
    return res.json({ action: created ? "CREATE_SO" : "ALREADY_EXISTS", soId: salesOrder.id });
  } catch (err) {
    return next(err);
  }
});

poRouter.get("/", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const pos = await prisma.customerPO.findMany({
      orderBy: { id: "desc" },
      include: {
        customer: true,
        supplier: true,
        lines: { include: { item: true } },
        salesOrder: true,
      },
    });
    return res.json(pos);
  } catch (err) {
    return next(err);
  }
});

module.exports = { poRouter };
