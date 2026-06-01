const express = require("express");
const { z, ZodError } = require("zod");
const { Prisma } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getStrictInventoryControl, getStockAdjustmentPolicy } = require("../services/appSettings");
const {
  assertUserCanCreateStockAdjustment,
  assertUserCanReverseStockAdjustment,
  assertReverseWithinPolicyWindow,
} = require("../services/stockAdjustmentPolicy");
const {
  assertNonNegativeStockAfterNetChange,
  assertSufficientStockForQtyOut,
  getItemStockQty,
  getUsableItemStockQty,
  loadStockByItemIdUsableMap,
  buildStockSummaryBucketsRows,
  loadStockBucketsByItemIdMap,
  loadStockUsableByItemAndLocation,
  STOCK_EPS,
} = require("../services/stockService");
const { UNASSIGNED_LOCATION_LABEL } = require("../services/grnLocationService");
const auditLog = require("../services/auditLog");
const { lockItemForUpdate } = require("../services/dispatchWriteLocks");
const { assertAnyAdminPassword } = require("../services/adminPasswordAuth");

const stockRouter = express.Router();

/**
 * Paired BUCKET_TRANSFER rows: qty out from fromBucket, qty in to toBucket. Total physical on-hand unchanged.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ itemId: number, item: import('@prisma/client').Item, qty: number, fromBucket: import('@prisma/client').StockBucket, toBucket: import('@prisma/client').StockBucket, reasonDetail: string, userId: number, req: import('express').Request, auditLogTitle?: string }} args
 */
async function pairBucketTransferInTx(tx, { itemId, item, qty, fromBucket, toBucket, reasonDetail, userId, req, auditLogTitle }) {
  const detail = String(reasonDetail || "").trim() || "—";
  const reasonNote = `Bucket ${fromBucket}→${toBucket}: ${detail}`;
  await assertSufficientStockForQtyOut(tx, itemId, qty, "Insufficient quantity in source bucket.", {
    stockBucket: fromBucket,
  });
  const stockBefore = await getItemStockQty(itemId, tx);
  const outTxn = await tx.stockTransaction.create({
    data: {
      itemId,
      transactionType: "BUCKET_TRANSFER",
      refId: 0,
      stockBucket: fromBucket,
      qtyIn: "0",
      qtyOut: String(qty),
      reason: `${reasonNote} (out)`,
      createdByUserId: userId,
    },
    include: { item: true },
  });
  await tx.stockTransaction.create({
    data: {
      itemId,
      transactionType: "BUCKET_TRANSFER",
      refId: 0,
      stockBucket: toBucket,
      qtyIn: String(qty),
      qtyOut: "0",
      reason: `${reasonNote} (in)`,
      createdByUserId: userId,
    },
  });
  const stockAfter = await getItemStockQty(itemId, tx);
  if (Math.abs(stockAfter - stockBefore) > STOCK_EPS) {
    const err = new Error("Bucket transfer left total on-hand inconsistent; operation aborted.");
    err.statusCode = 500;
    throw err;
  }
  const title = auditLogTitle || "Bucket transfer";
  await auditLog.write(tx, {
    action: auditLog.AuditAction.CREATE,
    entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
    entityId: String(outTxn.id),
    actorUserId: userId,
    actorRole: req.user.role,
    summary: `${title} #${outTxn.id}: ${item.itemName} ${fromBucket}→${toBucket} qty ${qty}`,
    payload: {
      snapshot: {
        itemId,
        itemName: item.itemName,
        qty,
        fromBucket,
        toBucket,
      },
      stockBefore,
      stockAfter,
    },
    reason: detail,
  });
  return outTxn;
}

const STRICT_ADJUSTMENT_FORBIDDEN = "Stock adjustment is not allowed in strict inventory mode";
/** Shared with createApp /api/stock-adjustment alias */
const STOCK_ADJUSTMENT_ACCESS_DENIED = "Access denied. Only Admin and Store roles can post stock adjustments.";
const STOCK_READ_ACCESS_DENIED = "Access denied. Only Admin and Store roles can view stock data.";
const ADJUSTMENT_IMMUTABLE_MSG =
  "Stock adjustments cannot be edited or deleted. Use POST /api/stock/adjustments/:id/reverse to reverse an adjustment.";

async function assertStockAdjustmentAllowed() {
  if (await getStrictInventoryControl()) {
    const err = new Error(STRICT_ADJUSTMENT_FORBIDDEN);
    err.statusCode = 403;
    throw err;
  }
}

const adjustmentRoles = requireRole(["ADMIN", "STORE"], STOCK_ADJUSTMENT_ACCESS_DENIED);
/**
 * Stock summary / ledger reads — broad operational visibility (Phase 1 step 8).
 * Write operations (`adjustmentRoles`) remain Admin+Store only.
 */
const stockReadRoles = requireRole(
  ["ADMIN", "STORE", "PRODUCTION", "QA", "ADMIN"],
  STOCK_READ_ACCESS_DENIED,
);
/** Move quantity between stock buckets (USABLE / QC_HOLD / QC_PENDING / REWORK / SCRAP) for an FG item. */
const bucketTransferRoles = requireRole(["ADMIN", "STORE", "QA"], STOCK_READ_ACCESS_DENIED);
const qcReworkRoles = requireRole(["ADMIN", "QA"], "Access denied. Only Admin and QA can manage the rework QC queue.");

// Summary per item: sum(qtyIn - qtyOut)
stockRouter.get("/summary", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const stockMap = await loadStockByItemIdUsableMap(prisma);
    const itemIds = [...stockMap.keys()];
    const items = itemIds.length
      ? await prisma.item.findMany({ where: { id: { in: itemIds } } })
      : [];
    const itemsById = new Map(items.map((i) => [i.id, i]));

    const result = itemIds
      .map((itemId) => ({
        itemId,
        item: itemsById.get(itemId),
        qty: stockMap.get(itemId) ?? 0,
      }))
      .sort((a, b) => (b.itemId || 0) - (a.itemId || 0));

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

// Summary per item with buckets: USABLE / QC_HOLD / QC_PENDING / REWORK / SCRAP
stockRouter.get("/summary-buckets", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const result = await buildStockSummaryBucketsRows(prisma);
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/stock/godown-overview
 * Godown-wise USABLE (by location type) + QC_HOLD + SCRAP buckets per item (read-only).
 */
stockRouter.get("/godown-overview", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const itemTypeRaw = req.query.itemType != null ? String(req.query.itemType).trim().toUpperCase() : "ALL";
    const itemType = itemTypeRaw === "RM" || itemTypeRaw === "FG" ? itemTypeRaw : "ALL";
    const q = req.query.q != null ? String(req.query.q) : "";
    const data = await buildGodownStockOverview(prisma, { itemType, q });
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/stock/items/:itemId/drilldown
 * Item operational positions + flow summary + recent movements (read-only).
 */
stockRouter.get("/items/:itemId/drilldown", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      const err = new Error("Invalid item id");
      err.statusCode = 400;
      throw err;
    }
    const data = await buildItemStockDrilldown(prisma, itemId);
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

/** USABLE qty per item per location (operational view; does not replace item-level summary). */
stockRouter.get("/summary-by-location", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const rows = await loadStockUsableByItemAndLocation(prisma);
    const locationIds = [...new Set(rows.map((r) => r.locationId).filter((id) => id != null))];
    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const [locations, items] = await Promise.all([
      locationIds.length
        ? prisma.location.findMany({ where: { id: { in: locationIds } } })
        : [],
      itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds } } }) : [],
    ]);
    const locById = new Map(locations.map((l) => [l.id, l]));
    const itemById = new Map(items.map((i) => [i.id, i]));

    const result = rows
      .filter((r) => r.qty > STOCK_EPS)
      .map((r) => {
        const loc = r.locationId != null ? locById.get(r.locationId) : null;
        return {
          itemId: r.itemId,
          item: itemById.get(r.itemId) ?? null,
          locationId: r.locationId,
          locationName: loc?.locationName ?? UNASSIGNED_LOCATION_LABEL,
          locationCode: loc?.locationCode ?? null,
          qty: r.qty,
        };
      })
      .sort((a, b) => {
        const nameA = a.item?.itemName ?? "";
        const nameB = b.item?.itemName ?? "";
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return (a.locationName || "").localeCompare(b.locationName || "");
      });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/stock/bucket-transfer — move FG quantity from one stock bucket to another (paired ADJUSTMENT rows; total on-hand unchanged).
 */
stockRouter.post("/bucket-transfer", requireAuth, bucketTransferRoles, async (req, res, next) => {
  try {
    const schema = z
      .object({
        itemId: z.number().int().positive(),
        qty: z.number().positive(),
        fromBucket: z.enum(["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"]),
        toBucket: z.enum(["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"]),
        reason: z.string().min(1).max(500),
      })
      .strict()
      .refine((b) => b.fromBucket !== b.toBucket, { message: "fromBucket and toBucket must differ" });
    const body = schema.parse(req.body);

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) {
      const err = new Error("Item not found");
      err.statusCode = 404;
      throw err;
    }
    if (item.itemType !== "FG") {
      const err = new Error("Bucket transfer applies to finished goods only.");
      err.statusCode = 400;
      throw err;
    }

    const qty = Number(body.qty);
    const reasonDetail = body.reason.trim();

    const outRow = await prisma.$transaction(async (tx) => {
      return pairBucketTransferInTx(tx, {
        itemId: body.itemId,
        item,
        qty,
        fromBucket: body.fromBucket,
        toBucket: body.toBucket,
        reasonDetail,
        userId,
        req,
        auditLogTitle: "Bucket transfer",
      });
    });

    return res.status(201).json({
      outTransactionId: outRow.id,
      itemId: body.itemId,
      qty,
      fromBucket: body.fromBucket,
      toBucket: body.toBucket,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/stock/move-hold — move quantity from QC_HOLD to USABLE, REWORK, or SCRAP (Stock summary flow).
 */
stockRouter.post("/move-hold", requireAuth, bucketTransferRoles, async (req, res, next) => {
  try {
    const schema = z
      .object({
        itemId: z.number().int().positive(),
        qty: z.number().positive(),
        action: z.enum(["USABLE", "REWORK", "SCRAP"]),
        remarks: z.string().max(2000).optional(),
      })
      .strict();
    const body = schema.parse(req.body);

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) {
      const err = new Error("Item not found");
      err.statusCode = 404;
      throw err;
    }

    const qty = Number(body.qty);
    const holdOnHand = await getItemStockQty(body.itemId, prisma, { stockBucket: "QC_HOLD" });
    if (qty > holdOnHand + STOCK_EPS) {
      const err = new Error(`Quantity exceeds hold on hand. Hold available: ${holdOnHand}, requested: ${qty}.`);
      err.statusCode = 400;
      throw err;
    }

    const remarksTrim = typeof body.remarks === "string" ? body.remarks.trim() : "";
    const reasonDetail = remarksTrim || "Stock summary";

    const toBucket = body.action;
    const outRow = await prisma.$transaction(async (tx) => {
      return pairBucketTransferInTx(tx, {
        itemId: body.itemId,
        item,
        qty,
        fromBucket: "QC_HOLD",
        toBucket,
        reasonDetail,
        userId,
        req,
        auditLogTitle: "Hold move",
      });
    });

    return res.status(201).json({
      outTransactionId: outRow.id,
      itemId: body.itemId,
      qty,
      fromBucket: "QC_HOLD",
      toBucket,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/stock/process-rework — after internal rework, move REWORK → QC_PENDING (QC re-check queue) or → SCRAP.
 * QC_PENDING is not QC_HOLD (Hold for Checking). QC page lists QC_PENDING via GET /rework-qc-queue.
 */
stockRouter.post("/process-rework", requireAuth, bucketTransferRoles, async (req, res, next) => {
  let parsedAction = null;
  try {
    const schema = z
      .object({
        itemId: z.number().int().positive(),
        qty: z.number().positive(),
        action: z.enum(["SEND_TO_QC", "SCRAP"]),
        remarks: z
          .string()
          .max(2000)
          .refine((s) => String(s).trim().length > 0, { message: "Rework / approval remarks are required" }),
      })
      .strict();
    const body = schema.parse(req.body);
    parsedAction = body.action;

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    const remarksTrim = String(body.remarks ?? "").trim();

    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) {
      const err = new Error("Item not found");
      err.statusCode = 404;
      throw err;
    }

    const qty = Number(body.qty);
    /** Rework → Send to QC → QC_PENDING (QC Entry “Rework re-check”). Not QC_HOLD (Hold for Checking). */
    const toBucket = body.action === "SEND_TO_QC" ? "QC_PENDING" : "SCRAP";
    const reasonDetail =
      body.action === "SEND_TO_QC"
        ? `Rework→QC re-check queue — ${remarksTrim}`
        : `Rework→Scrap — ${remarksTrim}`;

    const outRow = await prisma.$transaction(async (tx) => {
      return pairBucketTransferInTx(tx, {
        itemId: body.itemId,
        item,
        qty,
        fromBucket: "REWORK",
        toBucket,
        reasonDetail,
        userId,
        req,
        auditLogTitle: "Rework process",
      });
    });

    return res.status(201).json({
      outTransactionId: outRow.id,
      itemId: body.itemId,
      qty,
      fromBucket: "REWORK",
      toBucket,
      action: body.action,
    });
  } catch (e) {
    if (e instanceof ZodError) return next(e);
    const sc = e && typeof e.statusCode === "number" ? e.statusCode : 0;
    if (sc > 0 && sc < 500) return next(e);

    // eslint-disable-next-line no-console
    console.error(
      "[POST /api/stock/process-rework]",
      e,
      "\nIf this involved SEND_TO_QC, ensure migrations are applied so StockTransaction.stockBucket allows QC_PENDING (npx prisma migrate deploy).",
    );
    const friendly =
      parsedAction === "SEND_TO_QC"
        ? "Could not send rework stock to QC. Please contact Admin."
        : "Could not process rework stock. Please contact Admin.";
    return res.status(503).json({ error: { message: friendly, code: "PROCESS_REWORK_FAILED" } });
  }
});

/** Items with stock in QC_PENDING (rework re-check queue) for QC Entry page */
stockRouter.get("/rework-qc-queue", requireAuth, qcReworkRoles, async (req, res, next) => {
  try {
    // Default: exclude disposition-owned QC_PENDING so item-level queue stays meaningful
    // and doesn't mix with WO/disposition-owned rework QC.
    const includeOwned = req.query.includeOwned === "1" || req.query.includeOwned === "true";
    const rows = await prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: {
        stockBucket: "QC_PENDING",
        ...(includeOwned ? {} : { qcRejectedDispositionId: null }),
      },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const pending = [];
    for (const r of rows) {
      const net = Number(r._sum.qtyIn || 0) - Number(r._sum.qtyOut || 0);
      if (net > STOCK_EPS) pending.push({ itemId: r.itemId, qcPendingQty: net });
    }
    const itemIds = pending.map((p) => p.itemId);
    const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds } } }) : [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const result = pending
      .map((p) => {
        const it = byId.get(p.itemId);
        if (!it) return null;
        return {
          itemId: p.itemId,
          qcPendingQty: p.qcPendingQty,
          item: { itemName: it.itemName, itemType: it.itemType, unit: it.unit },
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.itemId || 0) - (a.itemId || 0));
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/stock/complete-rework-qc — inspect qty from QC_PENDING; post accepted → USABLE, rejected → chosen bucket.
 */
stockRouter.post("/complete-rework-qc", requireAuth, qcReworkRoles, async (req, res, next) => {
  try {
    const schema = z
      .object({
        itemId: z.number().int().positive(),
        checkedQty: z.number().positive(),
        rejectedQty: z.number().nonnegative(),
        rejectedStockBucket: z.enum(["USABLE", "QC_HOLD", "REWORK", "SCRAP"]).optional(),
        reason: z.string().max(2000).optional(),
      })
      .strict()
      .refine((b) => b.rejectedQty <= b.checkedQty + 1e-9, {
        message: "Rejected quantity cannot exceed checked quantity",
      });
    const body = schema.parse(req.body);

    if (body.rejectedQty > STOCK_EPS && body.rejectedStockBucket == null) {
      const err = new Error(
        "When rejected quantity is greater than zero, choose a rejected stock action: Rework, Hold, Usable, or Scrap.",
      );
      err.statusCode = 400;
      throw err;
    }

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    const checkedQty = Number(body.checkedQty);
    const rejectedQty = Number(body.rejectedQty);
    const acceptedQty = checkedQty - rejectedQty;
    if (acceptedQty < -STOCK_EPS) {
      const err = new Error("Accepted quantity cannot be negative.");
      err.statusCode = 400;
      throw err;
    }

    /** @type {"USABLE" | "QC_HOLD" | "REWORK" | "SCRAP" | null} */
    const rejectedStockBucket = rejectedQty > STOCK_EPS ? body.rejectedStockBucket : null;

    const reasonNote = typeof body.reason === "string" ? body.reason.trim() : "";
    const detail = reasonNote || "Rework QC";

    const dispAwaiting = await prisma.qcRejectedDisposition.findMany({
      where: { voidedAt: null, status: "REWORK_READY_FOR_QC", itemId: body.itemId },
      select: { id: true },
      take: 500,
    });
    for (const row of dispAwaiting) {
      const netRework = await getItemStockQty(body.itemId, prisma, {
        stockBucket: "REWORK",
        qcRejectedDispositionId: row.id,
      });
      const netLegacyPending = await getItemStockQty(body.itemId, prisma, {
        stockBucket: "QC_PENDING",
        qcRejectedDispositionId: row.id,
      });
      if (netRework > STOCK_EPS || netLegacyPending > STOCK_EPS) {
        const err = new Error(
          "This item has rework waiting in the QC work queue. Complete rework QC there before using internal stock rework.",
        );
        err.statusCode = 409;
        throw err;
      }
    }

    await prisma.$transaction(async (tx) => {
      await lockItemForUpdate(tx, body.itemId);

      const item = await tx.item.findUnique({ where: { id: body.itemId } });
      if (!item) {
        const err = new Error("Item not found");
        err.statusCode = 404;
        throw err;
      }

      await assertSufficientStockForQtyOut(tx, body.itemId, checkedQty, "Insufficient quantity in awaiting-QC bucket.", {
        stockBucket: "QC_PENDING",
      });

      await assertNonNegativeStockAfterNetChange(
        tx,
        body.itemId,
        acceptedQty,
        "Cannot complete internal rework QC with these quantities. Refresh or use the QC work queue.",
        { stockBucket: "USABLE" },
      );
      if (rejectedStockBucket === "USABLE") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          body.itemId,
          rejectedQty,
          "Cannot complete internal rework QC with these quantities. Refresh or use the QC work queue.",
          { stockBucket: "USABLE" },
        );
      } else if (rejectedStockBucket === "QC_HOLD") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          body.itemId,
          rejectedQty,
          "Cannot complete internal rework QC with these quantities. Refresh or use the QC work queue.",
          { stockBucket: "QC_HOLD" },
        );
      } else if (rejectedStockBucket === "REWORK") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          body.itemId,
          rejectedQty,
          "Cannot complete internal rework QC with these quantities. Refresh or use the QC work queue.",
          { stockBucket: "REWORK" },
        );
      } else if (rejectedStockBucket === "SCRAP") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          body.itemId,
          rejectedQty,
          "Cannot complete internal rework QC with these quantities. Refresh or use the QC work queue.",
          { stockBucket: "SCRAP" },
        );
      }

      const stockBefore = await getItemStockQty(body.itemId, tx);

      const outTxn = await tx.stockTransaction.create({
        data: {
          itemId: body.itemId,
          transactionType: "BUCKET_TRANSFER",
          refId: 0,
          stockBucket: "QC_PENDING",
          qtyIn: "0",
          qtyOut: String(checkedQty),
          reason: `Rework QC: out from awaiting-QC — checked ${checkedQty}, accepted ${acceptedQty}, rejected ${rejectedQty} — ${detail}`,
          createdByUserId: userId,
        },
        include: { item: true },
      });

      if (acceptedQty > STOCK_EPS) {
        await tx.stockTransaction.create({
          data: {
            itemId: body.itemId,
            transactionType: "BUCKET_TRANSFER",
            refId: 0,
            stockBucket: "USABLE",
            qtyIn: String(acceptedQty),
            qtyOut: "0",
            reason: `Rework QC: accepted to usable — ${detail}`,
            createdByUserId: userId,
          },
        });
      }
      if (rejectedQty > STOCK_EPS && rejectedStockBucket) {
        await tx.stockTransaction.create({
          data: {
            itemId: body.itemId,
            transactionType: "BUCKET_TRANSFER",
            refId: 0,
            stockBucket: rejectedStockBucket,
            qtyIn: String(rejectedQty),
            qtyOut: "0",
            reason: `Rework QC: rejected → ${rejectedStockBucket} — ${detail}`,
            createdByUserId: userId,
          },
        });
      }

      const stockAfter = await getItemStockQty(body.itemId, tx);
      if (Math.abs(stockAfter - stockBefore) > STOCK_EPS) {
        const err = new Error("Rework QC left total on-hand inconsistent; operation aborted.");
        err.statusCode = 500;
        throw err;
      }

      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
        entityId: String(outTxn.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Rework QC #${outTxn.id}: ${item.itemName} from QC_PENDING checked ${checkedQty} (accepted ${acceptedQty}, rejected ${rejectedQty})`,
        payload: {
          snapshot: {
            itemId: body.itemId,
            itemName: item.itemName,
            fromBucket: "QC_PENDING",
            checkedQty,
            acceptedQty,
            rejectedQty,
            rejectedStockBucket,
          },
          stockBefore,
          stockAfter,
        },
        reason: detail,
      });
    });

    return res.status(201).json({
      itemId: body.itemId,
      checkedQty,
      acceptedQty,
      rejectedQty,
      rejectedStockBucket,
    });
  } catch (e) {
    if (e instanceof ZodError) return next(e);
    const sc = e && typeof e.statusCode === "number" ? e.statusCode : 0;
    if (sc > 0 && sc < 500) return next(e);

    // eslint-disable-next-line no-console
    console.error("[POST /api/stock/complete-rework-qc]", e);
    return res.status(503).json({
      error: {
        message: "Could not complete rework QC. Please contact Admin.",
        code: "COMPLETE_REWORK_QC_FAILED",
      },
    });
  }
});

/** Physical stock correction; ledger row transactionType ADJUSTMENT + optional legacy reason null */
async function postStockAdjustment(req, res, next) {
  try {
    await assertStockAdjustmentAllowed();
    const policy = await getStockAdjustmentPolicy();
    assertUserCanCreateStockAdjustment(req.user.role, policy);
    const schema = z
      .object({
        itemId: z.number().int(),
        qtyIn: z.number().nonnegative().default(0),
        qtyOut: z.number().nonnegative().default(0),
        reason: z.any().optional(),
        adminPassword: z.any().optional(),
      })
      .strict()
      .refine((b) => (b.qtyIn > 0 && b.qtyOut === 0) || (b.qtyOut > 0 && b.qtyIn === 0), {
        message: "Set exactly one of qtyIn or qtyOut as a positive amount",
      });
    const body = schema.parse(req.body);

    const reason = typeof body.reason === "string" ? body.reason.trim() : String(body.reason ?? "").trim();
    if (!reason) {
      const err = new Error("Reason is required");
      err.statusCode = 400;
      throw err;
    }

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    // Sensitive: always require an ADMIN password to post adjustments (even if the actor is STORE).
    // Do not log password; return 401 on mismatch.
    const approvingAdminUserId = await assertAnyAdminPassword(prisma, { password: body.adminPassword });

    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) {
      const err = new Error("Item not found");
      err.statusCode = 404;
      throw err;
    }

    const txn = await prisma.$transaction(async (tx) => {
      const stockBefore = await getItemStockQty(body.itemId, tx, { stockBucket: "USABLE" });
      await assertNonNegativeStockAfterNetChange(
        tx,
        body.itemId,
        body.qtyIn - body.qtyOut,
        "Stock cannot go negative",
        { stockBucket: "USABLE" },
      );
      const created = await tx.stockTransaction.create({
        data: {
          itemId: body.itemId,
          transactionType: "ADJUSTMENT",
          refId: 0,
          stockBucket: "USABLE",
          qtyIn: String(body.qtyIn),
          qtyOut: String(body.qtyOut),
          reason,
          createdByUserId: userId,
          approvedByUserId: approvingAdminUserId,
        },
        include: { item: true },
      });
      const stockAfter = await getItemStockQty(body.itemId, tx, { stockBucket: "USABLE" });
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
        entityId: String(created.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Stock adjustment #${created.id}: ${item.itemName}`,
        payload: {
          snapshot: {
            itemId: body.itemId,
            itemName: item.itemName,
            qtyIn: body.qtyIn,
            qtyOut: body.qtyOut,
            approvedByUserId: approvingAdminUserId,
          },
          stockBefore,
          stockAfter,
        },
        reason,
      });
      return created;
    });

    return res.status(201).json(txn);
  } catch (e) {
    return next(e);
  }
}

/** Full reversal of a forward ADJUSTMENT row; creates opposite movement and marks original reversed */
async function postReverseAdjustment(req, res, next) {
  try {
    await assertStockAdjustmentAllowed();
    const policy = await getStockAdjustmentPolicy();
    assertUserCanReverseStockAdjustment(req.user.role, policy);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Stock transaction not found");
      err.statusCode = 404;
      throw err;
    }

    const schema = z.object({ reason: z.any().optional(), adminPassword: z.any().optional() }).strict();
    const body = schema.parse(req.body);
    const reason = typeof body.reason === "string" ? body.reason.trim() : String(body.reason ?? "").trim();
    if (!reason) {
      const err = new Error("Reason is required");
      err.statusCode = 400;
      throw err;
    }

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    // Sensitive: reversal also changes inventory directly — require ADMIN password every time.
    const approvingAdminUserId = await assertAnyAdminPassword(prisma, { password: body.adminPassword });

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM StockTransaction WHERE id = ${id} LIMIT 1 FOR UPDATE`);

      const original = await tx.stockTransaction.findUnique({ where: { id } });
      if (!original) {
        const err = new Error("Stock transaction not found");
        err.statusCode = 404;
        throw err;
      }
      if (original.transactionType !== "ADJUSTMENT") {
        const err = new Error("Reversal not allowed for this transaction");
        err.statusCode = 400;
        throw err;
      }
      if (original.reversalOfId != null) {
        const err = new Error("Reversal not allowed for this transaction");
        err.statusCode = 400;
        throw err;
      }
      if (original.reversedAt != null) {
        const err = new Error("Adjustment already reversed");
        err.statusCode = 400;
        throw err;
      }

      assertReverseWithinPolicyWindow(original.date, new Date(), policy);

      const qIn = Number(original.qtyIn);
      const qOut = Number(original.qtyOut);
      const revIn = qOut;
      const revOut = qIn;
      const netChange = revIn - revOut;
      const adjBucket = original.stockBucket || "USABLE";

      await assertNonNegativeStockAfterNetChange(tx, original.itemId, netChange, "Stock cannot go negative", {
        stockBucket: adjBucket,
      });

      const stockBefore = await getItemStockQty(original.itemId, tx, { stockBucket: adjBucket });

      const reversal = await tx.stockTransaction.create({
        data: {
          itemId: original.itemId,
          transactionType: "ADJUSTMENT",
          refId: 0,
          stockBucket: adjBucket,
          qtyIn: String(revIn),
          qtyOut: String(revOut),
          reason,
          reversalOfId: original.id,
          createdByUserId: userId,
          approvedByUserId: approvingAdminUserId,
        },
        include: { item: true },
      });

      const updatedOriginal = await tx.stockTransaction.update({
        where: { id: original.id },
        data: {
          reversedAt: new Date(),
          reversedByUserId: userId,
        },
        include: { item: true },
      });

      const stockAfter = await getItemStockQty(original.itemId, tx, { stockBucket: adjBucket });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.REVERSE,
        entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
        entityId: String(reversal.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Stock adjustment #${original.id} reversed (new row #${reversal.id})`,
        payload: {
          reversedOf: {
            entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
            entityId: String(original.id),
          },
          reason,
          snapshot: {
            itemId: original.itemId,
            itemName: reversal.item?.itemName,
            forward: { qtyIn: qIn, qtyOut: qOut },
            reversal: { qtyIn: revIn, qtyOut: revOut },
            approvedByUserId: approvingAdminUserId,
          },
          stockBefore,
          stockAfter,
        },
        reason,
      });

      return { original: updatedOriginal, reversal };
    });

    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
}

stockRouter.post("/adjustment", requireAuth, adjustmentRoles, postStockAdjustment);
stockRouter.post("/adjustments/:id/reverse", requireAuth, adjustmentRoles, postReverseAdjustment);

// List adjustments (ADMIN + STORE)
stockRouter.get("/adjustments", requireAuth, adjustmentRoles, async (req, res, next) => {
  try {
    const txns = await prisma.stockTransaction.findMany({
      where: { transactionType: "ADJUSTMENT" },
      orderBy: { id: "desc" },
      take: 200,
      include: {
        item: true,
        createdBy: { select: { id: true, name: true, email: true } },
        reversedBy: { select: { id: true, name: true, email: true } },
        reversalParent: { select: { id: true } },
      },
    });
    return res.json(txns);
  } catch (e) {
    return next(e);
  }
});

// Immutable after creation — use a compensating ADJUSTMENT with a reason.
stockRouter.put("/adjustments/:id", requireAuth, adjustmentRoles, (req, res) => {
  return res.status(403).json({ error: { message: ADJUSTMENT_IMMUTABLE_MSG } });
});

stockRouter.delete("/adjustments/:id", requireAuth, adjustmentRoles, (req, res) => {
  return res.status(403).json({ error: { message: ADJUSTMENT_IMMUTABLE_MSG } });
});

/** @param {string | import('express').Query | undefined} raw */
function parseLedgerDateStart(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** @param {string | import('express').Query | undefined} raw */
function parseLedgerDateEnd(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

const LEDGER_STOCK_TXN_TYPES = new Set([
  "OPENING",
  "OPENING_REVERSAL",
  "GRN",
  "ISSUE",
  "PRODUCTION",
  "QA",
  "STORE",
  "SCRAP",
  "ADJUSTMENT",
  "BUCKET_TRANSFER",
  "LOCATION_TRANSFER",
  "DISPATCH_REVERSAL",
  "QC_REVERSAL",
  "CUSTOMER_RETURN",
]);

const { listMovementHistory } = require("../services/stockMovementLedgerService");
const {
  buildGodownStockOverview,
  buildItemStockDrilldown,
} = require("../services/stockVisibilityService");

/**
 * GET /api/stock/movement-history
 * Operational stock movement ledger (read-only). Query: itemId?, locationId?, movement (filter),
 * transactionType?, itemType?, stockBucket?, dateFrom, dateTo, page, pageSize, sort.
 */
stockRouter.get("/movement-history", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const itemIdRaw = req.query.itemId;
    const itemId =
      itemIdRaw !== undefined && itemIdRaw !== null && String(itemIdRaw).trim() !== ""
        ? Number(itemIdRaw)
        : null;
    const locationIdRaw = req.query.locationId;
    const locationId =
      locationIdRaw !== undefined && locationIdRaw !== null && String(locationIdRaw).trim() !== ""
        ? Number(locationIdRaw)
        : null;

    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const limitLegacy = Number(req.query.limit);
    const psRaw =
      req.query.pageSize != null ? Number(req.query.pageSize) : Number.isFinite(limitLegacy) ? limitLegacy : 50;
    const pageSize = Math.max(1, Math.min(200, Math.floor(psRaw) || 50));
    const sort = String(req.query.sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    const data = await listMovementHistory({
      itemId: Number.isFinite(itemId) && itemId > 0 ? itemId : null,
      locationId: Number.isFinite(locationId) && locationId > 0 ? locationId : null,
      itemType: req.query.itemType != null ? String(req.query.itemType) : null,
      movement: req.query.movement != null ? String(req.query.movement) : "ALL",
      transactionType: req.query.transactionType != null ? String(req.query.transactionType) : null,
      stockBucket: req.query.stockBucket != null ? String(req.query.stockBucket) : null,
      dateFrom: parseLedgerDateStart(req.query.dateFrom),
      dateTo: parseLedgerDateEnd(req.query.dateTo),
      page,
      pageSize,
      sort,
    });
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/stock/ledger
 * Optional: itemId, itemType (FG|RM), transactionType, dateFrom, dateTo (YYYY-MM-DD),
 * page (default 1), pageSize|limit (default 50, max 200), sort=asc|desc (default desc).
 * Response envelope: { items, total, page, pageSize, sort, totals, openingBalanceAllBuckets, openingBalanceUsable }.
 * Legacy: returns same envelope; clients should read `.items`.
 */
stockRouter.get("/ledger", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const itemIdRaw = req.query.itemId;
    const itemId =
      itemIdRaw !== undefined && itemIdRaw !== null && String(itemIdRaw).trim() !== ""
        ? Number(itemIdRaw)
        : null;

    const itemTypeRaw = req.query.itemType != null ? String(req.query.itemType).trim().toUpperCase() : "";
    const txnRaw = req.query.transactionType != null ? String(req.query.transactionType).trim().toUpperCase() : "";

    const dateFrom = parseLedgerDateStart(req.query.dateFrom);
    const dateTo = parseLedgerDateEnd(req.query.dateTo);

    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const limitLegacy = Number(req.query.limit);
    const psRaw = req.query.pageSize != null ? Number(req.query.pageSize) : Number.isFinite(limitLegacy) ? limitLegacy : 50;
    const pageSize = Math.max(1, Math.min(200, Math.floor(psRaw) || 50));

    const sort = String(req.query.sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    /** @type {import('@prisma/client').Prisma.StockTransactionWhereInput} */
    const where = {};

    if (itemId != null && Number.isFinite(itemId) && itemId > 0) {
      where.itemId = itemId;
    }

    if (itemTypeRaw === "FG" || itemTypeRaw === "RM") {
      where.item = { itemType: itemTypeRaw };
    }

    if (txnRaw && LEDGER_STOCK_TXN_TYPES.has(txnRaw)) {
      where.transactionType = txnRaw;
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom;
      if (dateTo) where.date.lte = dateTo;
    }

    const orderBy =
      sort === "asc"
        ? [{ date: "asc" }, { id: "asc" }]
        : [{ date: "desc" }, { id: "desc" }];

    const skip = (page - 1) * pageSize;

    const [total, sumsAgg, rows] = await Promise.all([
      prisma.stockTransaction.count({ where }),
      prisma.stockTransaction.aggregate({
        where,
        _sum: { qtyIn: true, qtyOut: true },
      }),
      prisma.stockTransaction.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: { item: true },
      }),
    ]);

    const totals = {
      qtyInSum: Number(sumsAgg._sum.qtyIn || 0),
      qtyOutSum: Number(sumsAgg._sum.qtyOut || 0),
    };

    let openingBalanceAllBuckets = null;
    let openingBalanceUsable = null;

    if (sort === "asc" && rows.length > 0) {
      const first = rows[0];
      const openingWhere = {
        AND: [
          where,
          {
            OR: [{ date: { lt: first.date } }, { AND: [{ date: first.date }, { id: { lt: first.id } }] }],
          },
        ],
      };
      const openAgg = await prisma.stockTransaction.aggregate({
        where: openingWhere,
        _sum: { qtyIn: true, qtyOut: true },
      });
      openingBalanceAllBuckets = Number(openAgg._sum.qtyIn || 0) - Number(openAgg._sum.qtyOut || 0);

      // Usable-bucket running is used by the Stock Movement UI for operational clarity.
      // This does not change stock logic; it's purely a reporting projection.
      const openUsableAgg = await prisma.stockTransaction.aggregate({
        where: { ...openingWhere, stockBucket: "USABLE" },
        _sum: { qtyIn: true, qtyOut: true },
      });
      openingBalanceUsable = Number(openUsableAgg._sum.qtyIn || 0) - Number(openUsableAgg._sum.qtyOut || 0);

      let running = openingBalanceAllBuckets;
      let runningUsable = openingBalanceUsable;
      const items = rows.map((r) => {
        running += Number(r.qtyIn) - Number(r.qtyOut);
        if (String(r.stockBucket).toUpperCase() === "USABLE") {
          runningUsable += Number(r.qtyIn) - Number(r.qtyOut);
        }
        return { ...r, runningBalanceAfter: running, runningUsableAfter: runningUsable };
      });

      return res.json({
        items,
        total,
        page,
        pageSize,
        sort,
        totals,
        openingBalanceAllBuckets,
        openingBalanceUsable,
      });
    }

    const items = rows.map((r) => ({ ...r, runningBalanceAfter: null, runningUsableAfter: null }));

    return res.json({
      items,
      total,
      page,
      pageSize,
      sort,
      totals,
      openingBalanceAllBuckets,
      openingBalanceUsable,
    });
  } catch (e) {
    return next(e);
  }
});

const RM_LEDGER_MOVEMENT = new Set([
  "ALL",
  "GRN",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_RETURN",
  "RM_WASTAGE",
  "STOCK_INCREASE",
  "STOCK_DECREASE",
  "REVERSAL",
  "CUSTOMER_RETURN",
]);

/**
 * @param {string} movement
 * @returns {import('@prisma/client').Prisma.StockTransactionWhereInput}
 */
function buildRmLedgerMovementWhere(movement) {
  const m = String(movement || "ALL").toUpperCase();
  if (!RM_LEDGER_MOVEMENT.has(m) || m === "ALL") return {};
  if (m === "GRN") return { transactionType: "GRN" };
  if (m === "PRODUCTION_CONSUMPTION") return { transactionType: "ISSUE", qtyOut: { gt: 0 } };
  if (m === "PRODUCTION_RETURN") return { transactionType: "ISSUE", qtyIn: { gt: 0 } };
  if (m === "RM_WASTAGE") return { transactionType: "SCRAP" };
  if (m === "STOCK_INCREASE")
    return { transactionType: "ADJUSTMENT", qtyIn: { gt: 0 }, reversalOfId: null };
  if (m === "STOCK_DECREASE")
    return { transactionType: "ADJUSTMENT", qtyOut: { gt: 0 }, reversalOfId: null };
  if (m === "REVERSAL")
    return {
      OR: [
        { transactionType: "QC_REVERSAL" },
        { transactionType: "DISPATCH_REVERSAL" },
        { transactionType: "OPENING_REVERSAL" },
        { AND: [{ transactionType: "ADJUSTMENT" }, { reversalOfId: { not: null } }] },
      ],
    };
  if (m === "CUSTOMER_RETURN") return { transactionType: "CUSTOMER_RETURN" };
  return {};
}

/**
 * @param {{ transactionType: string, qtyIn: unknown, qtyOut: unknown, reversalOfId: number | null }} row
 */
function rmLedgerActivityLabel(row) {
  const t = row.transactionType;
  const qIn = Number(row.qtyIn);
  const qOut = Number(row.qtyOut);
  if (t === "GRN") return "GRN Receipt";
  if (t === "ISSUE") {
    if (qOut > 0) return "Production Consumption";
    if (qIn > 0) return "Production Return";
    return "Production Issue";
  }
  if (t === "SCRAP") return "RM Wastage";
  if (t === "ADJUSTMENT") {
    if (row.reversalOfId != null) {
      if (qIn > 0 && qOut <= 0) return "Stock Increase (Reversal)";
      if (qOut > 0 && qIn <= 0) return "Stock Decrease (Reversal)";
      return "Adjustment Reversal";
    }
    if (qIn > 0 && qOut <= 0) return "Stock Increase";
    if (qOut > 0 && qIn <= 0) return "Stock Decrease";
    return "Stock Adjustment";
  }
  if (t === "OPENING") return "Opening Stock";
  if (t === "QC_REVERSAL") return "QC Reversal";
  if (t === "DISPATCH_REVERSAL") return "Dispatch Reversal";
  if (t === "OPENING_REVERSAL") return "Opening Reversal";
  if (t === "CUSTOMER_RETURN") return "Customer Return";
  if (t === "PRODUCTION") return "Production";
  if (t === "QA") return "QC Posting";
  if (t === "STORE") return "STORE";
  if (t === "BUCKET_TRANSFER") return "Bucket transfer";
  return String(t).replace(/_/g, " ");
}

/**
 * @param {string} t
 */
function rmLedgerRefType(t) {
  const map = {
    OPENING: "Opening stock",
    GRN: "GRN",
    ISSUE: "Production batch",
    SCRAP: "Scrap",
    ADJUSTMENT: "Adjustment",
    QC_REVERSAL: "QC Reversal",
    DISPATCH_REVERSAL: "Dispatch Reversal",
    OPENING_REVERSAL: "Opening Reversal",
    BUCKET_TRANSFER: "Bucket transfer",
    CUSTOMER_RETURN: "Customer Return",
    PRODUCTION: "Production",
    QC: "QA",
    DISPATCH: "STORE",
  };
  return map[t] || String(t).replace(/_/g, " ");
}

/**
 * GET /api/stock/rm-ledger
 * Usable-bucket RM stock transactions only. Query: itemId?, dateFrom, dateTo, movement (see RM_LEDGER_MOVEMENT),
 * q (item name, ignored when itemId set), page, pageSize, sort=asc|desc.
 * Running balance (per row) only when itemId is set and sort=asc (chronological).
 */
stockRouter.get("/rm-ledger", requireAuth, stockReadRoles, async (req, res, next) => {
  try {
    const itemIdRaw = req.query.itemId;
    const itemId =
      itemIdRaw !== undefined && itemIdRaw !== null && String(itemIdRaw).trim() !== ""
        ? Number(itemIdRaw)
        : null;

    const movementRaw = String(req.query.movement || "ALL").trim().toUpperCase();
    const movement = RM_LEDGER_MOVEMENT.has(movementRaw) ? movementRaw : "ALL";

    const q = String(req.query.q || "").trim();

    const dateFrom = parseLedgerDateStart(req.query.dateFrom);
    const dateTo = parseLedgerDateEnd(req.query.dateTo);

    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const limitLegacy = Number(req.query.limit);
    const psRaw = req.query.pageSize != null ? Number(req.query.pageSize) : Number.isFinite(limitLegacy) ? limitLegacy : 50;
    const pageSize = Math.max(1, Math.min(200, Math.floor(psRaw) || 50));

    const sort = String(req.query.sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    /** @type {import('@prisma/client').Prisma.StockTransactionWhereInput} */
    const where = {
      stockBucket: "USABLE",
      item: { itemType: "RM" },
      ...buildRmLedgerMovementWhere(movement),
    };

    if (itemId != null && Number.isFinite(itemId) && itemId > 0) {
      where.itemId = itemId;
    } else if (q) {
      where.item = { itemType: "RM", itemName: { contains: q, mode: "insensitive" } };
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom;
      if (dateTo) where.date.lte = dateTo;
    }

    const orderBy =
      sort === "asc"
        ? [{ date: "asc" }, { id: "asc" }]
        : [{ date: "desc" }, { id: "desc" }];

    const skip = (page - 1) * pageSize;

    const [total, sumsAgg, rows] = await Promise.all([
      prisma.stockTransaction.count({ where }),
      prisma.stockTransaction.aggregate({
        where,
        _sum: { qtyIn: true, qtyOut: true },
      }),
      prisma.stockTransaction.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: { item: true },
      }),
    ]);

    const totalInward = Number(sumsAgg._sum.qtyIn || 0);
    const totalOutward = Number(sumsAgg._sum.qtyOut || 0);

    let currentBalance = null;
    if (itemId != null && Number.isFinite(itemId) && itemId > 0) {
      currentBalance = await getUsableItemStockQty(itemId, prisma);
    }

    const runningBalanceActive =
      itemId != null && Number.isFinite(itemId) && itemId > 0 && sort === "asc" && rows.length > 0;

    let openingBalanceUsable = null;
    /** @type {Array<Record<string, unknown>>} */
    let items = rows.map((r) => {
      const inwardQty = Number(r.qtyIn);
      const outwardQty = Number(r.qtyOut);
      const reason = (r.reason || "").trim();
      return {
        id: r.id,
        date: r.date,
        itemId: r.itemId,
        itemName: r.item?.itemName ?? "",
        unit: r.item?.unit ?? "",
        activity: rmLedgerActivityLabel(r),
        inwardQty,
        outwardQty,
        runningBalanceAfter: null,
        refType: rmLedgerRefType(r.transactionType),
        refNo: r.refId,
        notes: reason || null,
        transactionType: r.transactionType,
        source: null,
      };
    });

    // Drill-down routing hints (UI convenience only; stock math unchanged)
    // - GRN: refId is GrnLine.id → map to GRN and RM PO for navigation
    // - ISSUE: refId is ProductionEntry.id (navigation goes to /production list)
    try {
      const grnLineIds = rows.filter((r) => r.transactionType === "GRN" && r.refId > 0).map((r) => r.refId);
      const grnLineRows =
        grnLineIds.length > 0
          ? await prisma.grnLine.findMany({
              where: { id: { in: grnLineIds } },
              select: { id: true, grnId: true, grn: { select: { rmPoId: true } } },
            })
          : [];
      const grnLineById = new Map(grnLineRows.map((g) => [g.id, g]));

      items = items.map((it) => {
        const t = String(it.transactionType || "");
        const refNo = Number(it.refNo || 0);
        if (t === "GRN" && refNo > 0) {
          const gl = grnLineById.get(refNo);
          const grnId = gl?.grnId ?? null;
          const rmPoId = gl?.grn?.rmPoId ?? null;
          if (grnId && rmPoId) {
            return {
              ...it,
              source: { type: "GRN", id: grnId, route: `/rm-po-grn/${rmPoId}`, label: `GRN-${grnId}` },
            };
          }
          return { ...it, source: { type: "GRN", id: grnId, route: null, label: grnId ? `GRN-${grnId}` : null } };
        }
        if (t === "ISSUE" && refNo > 0) {
          return { ...it, source: { type: "PRODUCTION", id: refNo, route: "/production", label: `Production #${refNo}` } };
        }
        return it;
      });
    } catch {
      // Keep ledger functional even if lookup fails (do not block response).
    }

    if (runningBalanceActive) {
      const first = rows[0];
      const openingWhere = {
        AND: [
          where,
          {
            OR: [{ date: { lt: first.date } }, { AND: [{ date: first.date }, { id: { lt: first.id } }] }],
          },
        ],
      };
      const openAgg = await prisma.stockTransaction.aggregate({
        where: openingWhere,
        _sum: { qtyIn: true, qtyOut: true },
      });
      openingBalanceUsable = Number(openAgg._sum.qtyIn || 0) - Number(openAgg._sum.qtyOut || 0);
      let running = openingBalanceUsable;
      items = rows.map((r, i) => {
        running += Number(r.qtyIn) - Number(r.qtyOut);
        const base = items[i];
        return { ...base, runningBalanceAfter: running };
      });
    }

    const runningBalanceNote = !itemId
      ? "Select an RM item and sort oldest-first to show balance after each transaction."
      : sort !== "asc"
        ? "Sort oldest-first to show balance after each transaction."
        : null;

    return res.json({
      items,
      total,
      page,
      pageSize,
      sort,
      movement,
      summary: {
        totalInward,
        totalOutward,
        currentBalance,
        runningBalanceNote,
        runningBalanceActive,
      },
      openingBalanceUsable,
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = { stockRouter, postStockAdjustment, STOCK_ADJUSTMENT_ACCESS_DENIED };
