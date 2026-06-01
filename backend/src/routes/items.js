const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
} = require("../services/masterNameNormalize");
const { normalizeHsnOnSave } = require("../services/hsnNormalize");

const ITEM_DELETE_BLOCKED = "This item is used in orders, stock, or manufacturing and cannot be deleted.";
const ITEM_DUPLICATE_NAME = "An item with this name already exists.";
const ITEM_TYPE_UNIT_LOCKED =
  "This item's type or unit cannot be changed because it is already used in orders, stock, or manufacturing.";

const itemRouter = express.Router();

const GST_RATE_MAX = 100;
const PCT_MAX = 100;
/** Coverage thresholds for production planning: stock/requirement% cutoffs. */
const DEFAULT_CRITICAL_COVERAGE_PERCENT = 50;
const DEFAULT_WARNING_COVERAGE_PERCENT = 80;

/** @param {unknown} v */
function normalizeOptionalHsn(v) {
  if (v === undefined) return undefined;
  return normalizeHsnOnSave(v);
}

/** @param {unknown} v */
function normalizeOptionalGstRatePct(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    v = t;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("GST rate % must be a non-negative number");
    err.statusCode = 400;
    throw err;
  }
  if (n > GST_RATE_MAX) {
    const err = new Error(`GST rate % cannot exceed ${GST_RATE_MAX}`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/** @param {unknown} v */
function normalizeOptionalPercent(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    v = t;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("Percent must be a non-negative number");
    err.statusCode = 400;
    throw err;
  }
  if (n > PCT_MAX) {
    const err = new Error(`Percent cannot exceed ${PCT_MAX}`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/** @param {unknown} v */
function normalizeOptionalQty(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    v = t;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("Quantity must be a non-negative number");
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * True if the item is referenced anywhere that blocks deletion (FK Restrict).
 */
async function itemHasBlockingReferences(itemId) {
  const [
    bomAsFg,
    bomLineAsRm,
    enquiryLines,
    quotationLines,
    poLines,
    soLines,
    rmPoLines,
    woLines,
    scrapRecords,
    dispatches,
    stockTxns,
  ] = await prisma.$transaction([
    prisma.bom.count({ where: { fgItemId: itemId } }),
    prisma.bomLine.count({ where: { rmItemId: itemId } }),
    prisma.enquiryLine.count({ where: { itemId } }),
    prisma.quotationLine.count({ where: { itemId } }),
    prisma.customerPOLine.count({ where: { itemId } }),
    prisma.salesOrderLine.count({ where: { itemId } }),
    prisma.rmPurchaseOrderLine.count({ where: { itemId } }),
    prisma.workOrderLine.count({ where: { fgItemId: itemId } }),
    prisma.scrapRecord.count({ where: { fgItemId: itemId } }),
    prisma.dispatch.count({ where: { itemId } }),
    prisma.stockTransaction.count({ where: { itemId } }),
  ]);

  return [
    bomAsFg,
    bomLineAsRm,
    enquiryLines,
    quotationLines,
    poLines,
    soLines,
    rmPoLines,
    woLines,
    scrapRecords,
    dispatches,
    stockTxns,
  ].some((c) => c > 0);
}

/** @param {string} displayName @param {number | null} excludeId */
async function itemNameTakenByOther(displayName, excludeId) {
  const target = normalizeMasterNameKey(displayName);
  if (!target) return false;
  const others = await prisma.item.findMany({
    where: excludeId != null ? { NOT: { id: excludeId } } : {},
    select: { id: true, itemName: true },
  });
  return others.some((it) => normalizeMasterNameKey(it.itemName) === target);
}

itemRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const { type } = req.query;
    const where = type ? { itemType: String(type) } : {};
    const rows = await prisma.item.findMany({
      where,
      orderBy: { id: "desc" },
      include: { unitRef: { select: { id: true, unitName: true } } },
    });
    return res.json(
      rows.map((r) => ({
        ...r,
        unitId: r.unitId ?? null,
        unitName: r.unitRef?.unitName ?? null,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

itemRouter.post("/", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const schema = z.object({
      itemName: z.string().min(1),
      itemType: z.enum(["RM", "FG", "SFG", "CONSUMABLE"]),
      unit: z.string().min(1).optional(),
      unitId: z.number().int().positive().optional().nullable(),
      minStockLevel: z.number().nonnegative().default(0),
      hsnCode: z.string().min(1),
      gstRate: z.union([z.number(), z.string()]),
      redThresholdPercent: z.union([z.number(), z.string(), z.null()]).optional(),
      yellowThresholdPercent: z.union([z.number(), z.string(), z.null()]).optional(),
      planningBufferPercent: z.union([z.number(), z.string(), z.null()]).optional(),
      minimumStockQty: z.union([z.number(), z.string(), z.null()]).optional(),
      reorderQty: z.union([z.number(), z.string(), z.null()]).optional(),
    });
    const body = schema.parse(req.body);
    body.itemName = normalizeMasterNameDisplay(body.itemName);
    if (!body.itemName) {
      const err = new Error("Name is required");
      err.statusCode = 400;
      throw err;
    }
    if (await itemNameTakenByOther(body.itemName, null)) {
      const err = new Error(ITEM_DUPLICATE_NAME);
      err.statusCode = 400;
      throw err;
    }
    let unitId = body.unitId ?? null;
    let unitDisplay = "";
    if (unitId != null) {
      const unit = await prisma.unit.findFirst({
        where: { id: unitId, isActive: true },
        select: { id: true, unitName: true },
      });
      if (!unit) {
        const err = new Error("Invalid unit");
        err.statusCode = 400;
        throw err;
      }
      unitId = unit.id;
      unitDisplay = unit.unitName;
    } else {
      unitDisplay = normalizeMasterNameDisplay(body.unit);
      if (!unitDisplay) {
        const err = new Error("Unit is required");
        err.statusCode = 400;
        throw err;
      }
    }
    const hsnCode = normalizeOptionalHsn(body.hsnCode);
    if (!hsnCode) {
      const err = new Error("HSN code is required");
      err.statusCode = 400;
      throw err;
    }
    const gstRate = normalizeOptionalGstRatePct(body.gstRate);
    if (gstRate == null) {
      const err = new Error("GST rate % is required");
      err.statusCode = 400;
      throw err;
    }
    const criticalPct = normalizeOptionalPercent(body.redThresholdPercent);
    const warningPct = normalizeOptionalPercent(body.yellowThresholdPercent);
    const created = await prisma.item.create({
      data: {
        itemName: body.itemName,
        itemType: body.itemType,
        unit: unitDisplay,
        unitId,
        minStockLevel: String(body.minStockLevel),
        hsnCode,
        gstRate: String(gstRate),
        // Business meaning (UI labels): critical/warning coverage thresholds for planning zones (stock/requirement%).
        redThresholdPercent: criticalPct == null ? DEFAULT_CRITICAL_COVERAGE_PERCENT : criticalPct,
        yellowThresholdPercent: warningPct == null ? DEFAULT_WARNING_COVERAGE_PERCENT : warningPct,
        planningBufferPercent: normalizeOptionalPercent(body.planningBufferPercent),
        minimumStockQty: (() => {
          const q = normalizeOptionalQty(body.minimumStockQty);
          return q != null ? String(q) : null;
        })(),
        reorderQty: (() => {
          const q = normalizeOptionalQty(body.reorderQty);
          return q != null ? String(q) : null;
        })(),
      },
      include: { unitRef: { select: { id: true, unitName: true } } },
    });
    return res.status(201).json({
      ...created,
      unitId: created.unitId ?? null,
      unitName: created.unitRef?.unitName ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

itemRouter.put("/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      itemName: z.string().min(1).optional(),
      itemType: z.enum(["RM", "FG"]).optional(),
      unit: z.string().min(1).optional(),
      unitId: z.number().int().positive().optional().nullable(),
      minStockLevel: z.number().nonnegative().optional(),
      hsnCode: z.union([z.string(), z.null()]).optional(),
      gstRate: z.union([z.number(), z.string(), z.null()]).optional(),
      redThresholdPercent: z.union([z.number(), z.string(), z.null()]).optional(),
      yellowThresholdPercent: z.union([z.number(), z.string(), z.null()]).optional(),
      planningBufferPercent: z.union([z.number(), z.string(), z.null()]).optional(),
      minimumStockQty: z.union([z.number(), z.string(), z.null()]).optional(),
      reorderQty: z.union([z.number(), z.string(), z.null()]).optional(),
    });
    const body = schema.parse(req.body);

    const existing = await prisma.item.findUnique({ where: { id }, include: { unitRef: true } });
    if (!existing) {
      const err = new Error("Item not found");
      err.statusCode = 404;
      throw err;
    }

    const inUse = await itemHasBlockingReferences(id);
    if (inUse) {
      if (body.itemType !== undefined && body.itemType !== existing.itemType) {
        const err = new Error(ITEM_TYPE_UNIT_LOCKED);
        err.statusCode = 409;
        throw err;
      }
      if (body.unitId !== undefined || body.unit !== undefined) {
        let nextUnitDisplay = existing.unit;
        if (body.unitId !== undefined) {
          const unitId = body.unitId;
          if (unitId == null) {
            nextUnitDisplay = existing.unit;
          } else {
            const unit = await prisma.unit.findFirst({
              where: { id: unitId, isActive: true },
              select: { id: true, unitName: true },
            });
            if (!unit) {
              const err = new Error("Invalid unit");
              err.statusCode = 400;
              throw err;
            }
            nextUnitDisplay = unit.unitName;
          }
        } else if (body.unit !== undefined) {
          const t = normalizeMasterNameDisplay(body.unit);
          if (!t) {
            const err = new Error("Unit is required");
            err.statusCode = 400;
            throw err;
          }
          nextUnitDisplay = t;
        }

        if (normalizeMasterNameKey(nextUnitDisplay) !== normalizeMasterNameKey(existing.unit)) {
          const err = new Error(ITEM_TYPE_UNIT_LOCKED);
          err.statusCode = 409;
          throw err;
        }
      }
    }

    if (body.itemName !== undefined) {
      body.itemName = normalizeMasterNameDisplay(body.itemName);
      if (!body.itemName) {
        const err = new Error("Name is required");
        err.statusCode = 400;
        throw err;
      }
      if (await itemNameTakenByOther(body.itemName, id)) {
        const err = new Error(ITEM_DUPLICATE_NAME);
        err.statusCode = 400;
        throw err;
      }
    }
    const patch = {};
    if (body.itemName !== undefined) patch.itemName = body.itemName;
    if (body.itemType !== undefined) patch.itemType = body.itemType;
    if (body.unitId !== undefined) {
      if (body.unitId == null) {
        patch.unitId = null;
      } else {
        const unit = await prisma.unit.findFirst({
          where: { id: body.unitId, isActive: true },
          select: { id: true, unitName: true },
        });
        if (!unit) {
          const err = new Error("Invalid unit");
          err.statusCode = 400;
          throw err;
        }
        patch.unitId = unit.id;
        patch.unit = unit.unitName;
      }
    } else if (body.unit !== undefined) {
      const nextUnit = normalizeMasterNameDisplay(body.unit);
      if (!nextUnit) {
        const err = new Error("Unit is required");
        err.statusCode = 400;
        throw err;
      }
      patch.unit = nextUnit;
    }
    if (body.minStockLevel !== undefined) patch.minStockLevel = String(body.minStockLevel);
    if (body.hsnCode !== undefined) {
      const h = normalizeOptionalHsn(body.hsnCode);
      if (!h) {
        const err = new Error("HSN code is required");
        err.statusCode = 400;
        throw err;
      }
      patch.hsnCode = h;
    }
    if (body.gstRate !== undefined) {
      const g = normalizeOptionalGstRatePct(body.gstRate);
      if (g == null) {
        const err = new Error("GST rate % is required");
        err.statusCode = 400;
        throw err;
      }
      patch.gstRate = String(g);
    }
    if (body.redThresholdPercent !== undefined) patch.redThresholdPercent = normalizeOptionalPercent(body.redThresholdPercent);
    if (body.yellowThresholdPercent !== undefined) patch.yellowThresholdPercent = normalizeOptionalPercent(body.yellowThresholdPercent);
    if (body.planningBufferPercent !== undefined) patch.planningBufferPercent = normalizeOptionalPercent(body.planningBufferPercent);
    if (body.minimumStockQty !== undefined) {
      const q = normalizeOptionalQty(body.minimumStockQty);
      patch.minimumStockQty = q != null ? String(q) : null;
    }
    if (body.reorderQty !== undefined) {
      const q = normalizeOptionalQty(body.reorderQty);
      patch.reorderQty = q != null ? String(q) : null;
    }
    const updated = await prisma.item.update({
      where: { id },
      data: patch,
      include: { unitRef: { select: { id: true, unitName: true } } },
    });
    return res.json({
      ...updated,
      unitId: updated.unitId ?? null,
      unitName: updated.unitRef?.unitName ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

itemRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing) {
      const err = new Error("Item not found");
      err.statusCode = 404;
      throw err;
    }

    if (await itemHasBlockingReferences(id)) {
      const err = new Error(ITEM_DELETE_BLOCKED);
      err.statusCode = 409;
      throw err;
    }

    try {
      await prisma.item.delete({ where: { id } });
    } catch (delErr) {
      if (delErr && delErr.code === "P2003") {
        const err = new Error(ITEM_DELETE_BLOCKED);
        err.statusCode = 409;
        throw err;
      }
      throw delErr;
    }

    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

module.exports = { itemRouter };

