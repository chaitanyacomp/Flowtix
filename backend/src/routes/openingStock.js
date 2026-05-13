const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const auditLog = require("../services/auditLog");
const { assertNonNegativeStockAfterNetChange } = require("../services/stockService");
const { assertAnyAdminPassword } = require("../services/adminPasswordAuth");

const openingStockRouter = express.Router();

const OPENING_STOCK_ACCESS_DENIED = "Access denied. Only Admin and Store roles can manage opening stock.";
const OPENING_STOCK_DELETE_DENIED = "Access denied. Only administrators can delete opening stock drafts.";
const openingStockRoles = requireRole(["ADMIN", "STORE"], OPENING_STOCK_ACCESS_DENIED);
const openingStockAdminOnly = requireRole(["ADMIN"], OPENING_STOCK_DELETE_DENIED);

function safeNum(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

openingStockRouter.get("/opening-stock", requireAuth, openingStockRoles, async (req, res, next) => {
  try {
    const rows = await prisma.openingStockEntry.findMany({
      orderBy: [{ status: "asc" }, { id: "desc" }],
      include: { item: { select: { id: true, itemName: true, itemType: true, unit: true, unitId: true, unitRef: { select: { unitName: true } } } } },
    });
    const approvedIds = rows.filter((r) => r.status === "APPROVED").map((r) => r.id);
    /** @type {Map<number, Date | null>} */
    const reversedAtByEntryId = new Map();
    if (approvedIds.length > 0) {
      const openingTxs = await prisma.stockTransaction.findMany({
        where: { transactionType: "OPENING", refId: { in: approvedIds } },
        select: { refId: true, reversedAt: true },
      });
      for (const t of openingTxs) {
        reversedAtByEntryId.set(t.refId, t.reversedAt);
      }
    }
    return res.json(
      rows.map((r) => ({
        ...r,
        openingQty: Number(r.openingQty),
        itemName: r.item?.itemName ?? null,
        itemType: r.item?.itemType ?? null,
        unitName: r.item?.unitRef?.unitName ?? null,
        unit: r.item?.unit ?? null,
        openingLedgerReversedAt:
          r.status === "APPROVED" ? (reversedAtByEntryId.get(r.id) ?? null) : null,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

openingStockRouter.post("/opening-stock", requireAuth, openingStockRoles, async (req, res, next) => {
  try {
    const schema = z.object({
      itemId: z.number().int().positive(),
      openingQty: z.union([z.number(), z.string()]),
      stockBucket: z.enum(["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"]).optional().default("USABLE"),
      remarks: z.string().optional().nullable(),
      adminPassword: z.any().optional(),
    });
    const body = schema.parse(req.body);
    await assertAnyAdminPassword(prisma, { password: body.adminPassword });
    const qty = safeNum(body.openingQty);
    if (qty == null || qty <= 0) {
      return res.status(400).json({ error: { message: "Opening Qty must be greater than 0", code: "VALIDATION" } });
    }
    const item = await prisma.item.findUnique({ where: { id: body.itemId }, select: { id: true } });
    if (!item) {
      return res.status(400).json({ error: { message: "Invalid item", code: "VALIDATION" } });
    }

    const created = await prisma.openingStockEntry.create({
      data: {
        itemId: body.itemId,
        openingQty: String(qty),
        stockBucket: body.stockBucket,
        remarks: body.remarks != null && String(body.remarks).trim() !== "" ? String(body.remarks).trim() : null,
        status: "DRAFT",
        createdByUserId: typeof req.user?.userId === "number" ? req.user.userId : null,
      },
    });
    return res.status(201).json({ ...created, openingQty: Number(created.openingQty) });
  } catch (e) {
    return next(e);
  }
});

openingStockRouter.put("/opening-stock/:id", requireAuth, openingStockRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: "Invalid id" } });

    const existing = await prisma.openingStockEntry.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: { message: "Opening stock entry not found" } });
    if (existing.status !== "DRAFT") {
      return res.status(409).json({ error: { message: "Approved entries cannot be edited", code: "LOCKED" } });
    }

    const schema = z.object({
      itemId: z.number().int().positive().optional(),
      openingQty: z.union([z.number(), z.string()]).optional(),
      stockBucket: z.enum(["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"]).optional(),
      remarks: z.string().optional().nullable(),
      adminPassword: z.any().optional(),
    });
    const body = schema.parse(req.body);
    await assertAnyAdminPassword(prisma, { password: body.adminPassword });

    if (body.itemId != null) {
      const item = await prisma.item.findUnique({ where: { id: body.itemId }, select: { id: true } });
      if (!item) return res.status(400).json({ error: { message: "Invalid item", code: "VALIDATION" } });
    }
    let qtyPatch = {};
    if (body.openingQty !== undefined) {
      const qty = safeNum(body.openingQty);
      if (qty == null || qty <= 0) {
        return res.status(400).json({ error: { message: "Opening Qty must be greater than 0", code: "VALIDATION" } });
      }
      qtyPatch = { openingQty: String(qty) };
    }

    const updated = await prisma.openingStockEntry.update({
      where: { id },
      data: {
        ...(body.itemId !== undefined ? { itemId: body.itemId } : {}),
        ...qtyPatch,
        ...(body.stockBucket !== undefined ? { stockBucket: body.stockBucket } : {}),
        ...(body.remarks !== undefined
          ? { remarks: body.remarks != null && String(body.remarks).trim() !== "" ? String(body.remarks).trim() : null }
          : {}),
      },
    });
    return res.json({ ...updated, openingQty: Number(updated.openingQty) });
  } catch (e) {
    return next(e);
  }
});

/** Draft-only removal (no stock posted yet). Approved rows must never be deleted — use an offsetting ledger row if reversal is added later. */
openingStockRouter.delete("/opening-stock/:id", requireAuth, openingStockAdminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: "Invalid id" } });

    const existing = await prisma.openingStockEntry.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: { message: "Opening stock entry not found" } });
    if (existing.status !== "DRAFT") {
      return res.status(409).json({ error: { message: "Approved entries cannot be deleted", code: "LOCKED" } });
    }

    await prisma.openingStockEntry.delete({ where: { id } });
    return res.sendStatus(204);
  } catch (e) {
    return next(e);
  }
});

openingStockRouter.post("/opening-stock/:id/approve", requireAuth, openingStockRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: "Invalid id" } });

    const approveBody = z.object({ adminPassword: z.any().optional() }).parse(req.body ?? {});
    await assertAnyAdminPassword(prisma, { password: approveBody.adminPassword });

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.openingStockEntry.findUnique({ where: { id } });
      if (!entry) {
        const err = new Error("Opening stock entry not found");
        err.statusCode = 404;
        throw err;
      }
      if (entry.status !== "DRAFT") {
        const err = new Error("Already approved");
        err.statusCode = 409;
        throw err;
      }
      const qty = Number(entry.openingQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        const err = new Error("Opening Qty must be greater than 0");
        err.statusCode = 400;
        throw err;
      }

      const existingOpening = await tx.stockTransaction.count({
        where: { itemId: entry.itemId, transactionType: "OPENING", reversedAt: null },
      });
      if (existingOpening > 0) {
        const err = new Error("Opening stock already approved for this item");
        err.statusCode = 409;
        throw err;
      }

      await tx.stockTransaction.create({
        data: {
          itemId: entry.itemId,
          transactionType: "OPENING",
          refId: entry.id,
          stockBucket: entry.stockBucket,
          qtyIn: String(qty),
          qtyOut: "0",
          reason: entry.remarks ?? "Opening stock",
          createdByUserId: typeof req.user?.userId === "number" ? req.user.userId : null,
        },
      });

      const approved = await tx.openingStockEntry.update({
        where: { id: entry.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: typeof req.user?.userId === "number" ? req.user.userId : null,
        },
      });

      return { ...approved, openingQty: Number(approved.openingQty) };
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

/**
 * Reverse approved opening stock: OPENING_REVERSAL qtyOut offsets forward OPENING (original row kept + reversedAt).
 */
openingStockRouter.post("/opening-stock/:id/reverse", requireAuth, openingStockRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: "Invalid id" } });

    const schema = z.object({
      reason: z.string().min(1, "Reason is required."),
      adminPassword: z.any().optional(),
    });
    const body = schema.parse(req.body);
    await assertAnyAdminPassword(prisma, { password: body.adminPassword });

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const reasonTrim = body.reason.trim();
    if (!reasonTrim) {
      return res.status(400).json({ error: { message: "Reason is required." } });
    }

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.openingStockEntry.findUnique({ where: { id } });
      if (!entry) {
        const err = new Error("Opening stock entry not found");
        err.statusCode = 404;
        throw err;
      }
      if (entry.status !== "APPROVED") {
        const err = new Error("Only approved opening stock can be reversed");
        err.statusCode = 400;
        throw err;
      }

      const original = await tx.stockTransaction.findFirst({
        where: {
          itemId: entry.itemId,
          transactionType: "OPENING",
          refId: entry.id,
        },
        orderBy: { id: "asc" },
      });
      if (!original) {
        const err = new Error("Opening stock ledger row not found");
        err.statusCode = 500;
        throw err;
      }
      if (original.reversedAt != null) {
        const err = new Error("Opening stock already reversed");
        err.statusCode = 400;
        throw err;
      }

      const qtyIn = Number(original.qtyIn);
      if (!Number.isFinite(qtyIn) || qtyIn <= 0) {
        const err = new Error("Invalid opening quantity on ledger row");
        err.statusCode = 500;
        throw err;
      }

      const bucket = original.stockBucket || "USABLE";
      await assertNonNegativeStockAfterNetChange(
        tx,
        entry.itemId,
        -qtyIn,
        "Cannot reverse opening stock: insufficient quantity in bucket.",
        { stockBucket: bucket },
      );

      const reversal = await tx.stockTransaction.create({
        data: {
          itemId: entry.itemId,
          transactionType: "OPENING_REVERSAL",
          refId: entry.id,
          stockBucket: bucket,
          qtyIn: "0",
          qtyOut: String(qtyIn),
          reversalOfId: original.id,
          reason: reasonTrim,
          createdByUserId: userId,
        },
      });

      const updatedOriginal = await tx.stockTransaction.update({
        where: { id: original.id },
        data: {
          reversedAt: new Date(),
          reversedByUserId: userId,
        },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.REVERSE,
        entityType: auditLog.AuditEntityType.ITEM,
        entityId: String(entry.itemId),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Opening stock entry #${entry.id} reversed (ledger #${reversal.id})`,
        payload: {
          openingStockEntryId: entry.id,
          originalStockTransactionId: original.id,
          reversalStockTransactionId: reversal.id,
          qtyOut: qtyIn,
          stockBucket: bucket,
        },
        reason: reasonTrim,
      });

      return { original: updatedOriginal, reversal, openingStockEntry: entry };
    });

    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

module.exports = { openingStockRouter };

