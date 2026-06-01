const express = require("express");
const { z, ZodError } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getItemStockQty, STOCK_EPS } = require("../services/stockService");

const qcLegacyRejectedClassificationsRouter = express.Router();

/** ADMIN + QC: operational closure without editing historical QcEntry rows. */
const LEGACY_CLASSIFY_ROLES = ["ADMIN", "QA"];

/** Eligible: not reversed, has reject qty, no legacy classification row yet. Requires `QcLegacyRejectedClassification` in DB. */
const LEGACY_ELIGIBLE_WHERE = {
  reversedAt: null,
  rejectedQty: { gt: 0 },
  legacyRejectedClassification: { is: null },
};

/** Narrow selects only — no PurchaseBill / unrelated relations. */
const qcIncludeForEligibleList = {
  production: {
    include: {
      workOrderLine: {
        include: {
          fgItem: { select: { id: true, itemName: true } },
          workOrder: { select: { id: true, docNo: true, salesOrderId: true } },
        },
      },
    },
  },
};

/**
 * @param {import('@prisma/client').QcLegacyRejectedAction} action
 * @returns {import('@prisma/client').StockBucket}
 */
function actionToTargetBucket(action) {
  if (action === "APPROVE_TO_USABLE") return "USABLE";
  if (action === "MOVE_TO_HOLD") return "QC_HOLD";
  return "SCRAP";
}

/**
 * Where original QC reject stock was posted (legacy null → treat as QC_HOLD per migration notes).
 * @param {{ rejectedStockBucket: import('@prisma/client').StockBucket | null }} qc
 */
function resolveFromBucket(qc) {
  return qc.rejectedStockBucket ?? "QC_HOLD";
}

/**
 * GET /api/production/qc-legacy-classifications/eligible
 */
qcLegacyRejectedClassificationsRouter.get(
  "/qc-legacy-classifications/eligible",
  requireAuth,
  requireRole(LEGACY_CLASSIFY_ROLES),
  async (req, res, next) => {
    try {
      const take = Math.min(Number(req.query.limit) || 500, 1000);
      const rows = await prisma.qcEntry.findMany({
        where: LEGACY_ELIGIBLE_WHERE,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take,
        include: qcIncludeForEligibleList,
      });

      const mappedBase = rows.map((qe) => {
        const wol = qe.production?.workOrderLine;
        const fg = wol?.fgItem;
        const wo = wol?.workOrder;
        const fromBucket = resolveFromBucket(qe);
        return {
          qcEntryId: qe.id,
          docNo: qe.docNo,
          productionId: qe.productionId,
          date: qe.date.toISOString(),
          rejectedQty: Number(qe.rejectedQty),
          rejectedStockBucket: qe.rejectedStockBucket,
          itemId: fg?.id ?? null,
          itemName: fg?.itemName ?? null,
          workOrderId: wo?.id ?? null,
          workOrderDocNo: wo?.docNo ?? null,
          fromBucket,
        };
      });

      // Actionable eligibility requires that the ORIGINAL reject source bucket still has stock available to move out.
      // If stock was already moved (or is historically inconsistent), we keep the row out of the actionable list.
      /** @type {Array<any>} */
      const actionable = [];
      /** @type {Array<any>} */
      const historicalRows = [];

      // Cache stock reads per (itemId, bucket) to avoid repeated aggregates.
      /** @type {Map<string, number>} */
      const stockCache = new Map();
      const readStock = async (itemId, bucket) => {
        const key = `${Number(itemId)}:${String(bucket)}`;
        if (stockCache.has(key)) return stockCache.get(key);
        const v = await getItemStockQty(Number(itemId), prisma, { stockBucket: bucket });
        stockCache.set(key, v);
        return v;
      };

      for (const r of mappedBase) {
        if (!r.itemId) {
          historicalRows.push({
            ...r,
            availableSourceQty: 0,
            nonActionableReason: "Could not resolve finished good for this QC entry.",
          });
          continue;
        }
        const required = Number(r.rejectedQty);
        const fromBucket = r.fromBucket;
        const avail = await readStock(r.itemId, fromBucket);
        const ok = Number.isFinite(avail) && avail + STOCK_EPS >= required && required > STOCK_EPS;
        const out = {
          ...r,
          availableSourceQty: Number.isFinite(avail) ? avail : 0,
        };
        if (ok) {
          actionable.push(out);
        } else {
          historicalRows.push({
            ...out,
            nonActionableReason: "Stock already moved or unavailable for classification.",
          });
        }
      }

      return res.json({ rows: actionable, historicalRows });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[GET /api/production/qc-legacy-classifications/eligible]", {
        name: e?.name,
        code: e?.code,
        message: e?.message,
        meta: e?.meta,
      });
      if (process.env.NODE_ENV !== "production") {
        return res.status(503).json({
          error: {
            message: e?.message || String(e),
            code: e?.code || "ELIGIBLE_QUERY_FAILED",
            meta: e?.meta ?? null,
          },
        });
      }
      return next(e);
    }
  },
);

/**
 * GET /api/production/qc-legacy-classifications
 * Recent classifications (history).
 */
qcLegacyRejectedClassificationsRouter.get(
  "/qc-legacy-classifications",
  requireAuth,
  requireRole(LEGACY_CLASSIFY_ROLES),
  async (req, res, next) => {
    try {
      const take = Math.min(Number(req.query.limit) || 200, 500);
      const rows = await prisma.qcLegacyRejectedClassification.findMany({
        where: { voidedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        include: {
          sourceQcEntry: { select: { id: true, docNo: true, productionId: true, rejectedQty: true } },
          item: { select: { id: true, itemName: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
      return res.json({
        rows: rows.map((r) => ({
          id: r.id,
          sourceQcEntryId: r.sourceQcEntryId,
          qcDocNo: r.sourceQcEntry.docNo,
          itemId: r.itemId,
          itemName: r.item.itemName,
          qty: Number(r.qty),
          action: r.action,
          fromStockBucket: r.fromStockBucket,
          toStockBucket: r.toStockBucket,
          remarks: r.remarks,
          createdAt: r.createdAt.toISOString(),
          createdBy: r.createdBy,
        })),
      });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * POST /api/production/qc-legacy-classifications/:qcEntryId/classify
 * Stock/bucket helpers are required only here (lazy-loaded).
 */
qcLegacyRejectedClassificationsRouter.post(
  "/qc-legacy-classifications/:qcEntryId/classify",
  requireAuth,
  requireRole(LEGACY_CLASSIFY_ROLES),
  async (req, res, next) => {
    const { pairBucketTransferInTx } = require("../services/bucketTransferPair");
    const { lockQcEntryForUpdate } = require("../services/productionWriteLocks");
    const { lockItemForUpdate } = require("../services/dispatchWriteLocks");
    const { STOCK_EPS, assertSufficientStockForQtyOut } = require("../services/stockService");
    const auditLog = require("../services/auditLog");

    try {
      const qcEntryId = Number(req.params.qcEntryId);
      const schema = z
        .object({
          action: z.enum(["APPROVE_TO_USABLE", "MOVE_TO_HOLD", "SCRAP"]),
          remarks: z.string().max(2000).optional(),
        })
        .strict();
      const body = schema.parse(req.body);
      const userId = req.user.userId;
      const remarksTrim = typeof body.remarks === "string" ? body.remarks.trim() : "";

      const result = await prisma.$transaction(async (tx) => {
        await lockQcEntryForUpdate(tx, qcEntryId);

        const qc = await tx.qcEntry.findUnique({
          where: { id: qcEntryId },
          include: {
            production: {
              include: {
                workOrderLine: { include: { fgItem: true, workOrder: true } },
              },
            },
          },
        });

        if (!qc) {
          const err = new Error("QC entry not found");
          err.statusCode = 404;
          throw err;
        }
        if (qc.reversedAt != null) {
          const err = new Error("Cannot classify a reversed QC entry.");
          err.statusCode = 400;
          throw err;
        }
        if (Number(qc.rejectedQty) <= STOCK_EPS) {
          const err = new Error("This QC entry has no rejected quantity to classify.");
          err.statusCode = 400;
          throw err;
        }
        const existingClassification = await tx.qcLegacyRejectedClassification.findUnique({
          where: { sourceQcEntryId: qc.id },
        });
        if (existingClassification) {
          const err = new Error("This QC entry was already classified.");
          err.statusCode = 409;
          throw err;
        }

        const qty = Number(qc.rejectedQty);
        const fgItem = qc.production?.workOrderLine?.fgItem;
        const wo = qc.production?.workOrderLine?.workOrder;
        if (!fgItem?.id) {
          const err = new Error("Could not resolve finished good for this QC entry.");
          err.statusCode = 400;
          throw err;
        }

        await lockItemForUpdate(tx, fgItem.id);

        const item = await tx.item.findUnique({ where: { id: fgItem.id } });
        if (!item || item.itemType !== "FG") {
          const err = new Error("Item must be a finished good.");
          err.statusCode = 400;
          throw err;
        }

        const fromBucket = resolveFromBucket(qc);
        const toBucket = actionToTargetBucket(body.action);
        const detail = remarksTrim || `Legacy QC reject classification (QC #${qc.id})`;

        let stockMoved = false;
        if (fromBucket !== toBucket) {
          await pairBucketTransferInTx(tx, {
            itemId: fgItem.id,
            item,
            qty,
            fromBucket,
            toBucket,
            reasonDetail: `${detail} [from ${fromBucket} per original QC reject posting]`,
            userId,
            req,
            auditLogTitle: "Legacy QC reject classification",
          });
          stockMoved = true;
        }

        // IMPORTANT: MOVE_TO_HOLD must enter the real Hold Decision workflow (owned QC_HOLD + qcRejectedDisposition).
        // Legacy classification rows alone are history-only and do not create actionable hold decisions.
        if (body.action === "MOVE_TO_HOLD") {
          const createdDisp = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: qc.id,
              workOrderId: wo?.id ?? null,
              itemId: fgItem.id,
              qty: String(qty),
              remainingQty: String(qty),
              phase: "FIRST_QC",
              status: "HOLD",
              remarks: remarksTrim || `Legacy classify → HOLD (QC #${qc.id})`,
              createdByUserId: userId,
            },
          });

          // Attach ownership inside QC_HOLD: move qty from unowned QC_HOLD → owned QC_HOLD(dispositionId).
          // This keeps total QC_HOLD unchanged but makes the row actionable in Hold Decision queue.
          await assertSufficientStockForQtyOut(tx, fgItem.id, qty, "Legacy hold classification requires QC_HOLD stock.", {
            stockBucket: "QC_HOLD",
          });
          await tx.stockTransaction.create({
            data: {
              itemId: fgItem.id,
              transactionType: "BUCKET_TRANSFER",
              refId: qc.id,
              stockBucket: "QC_HOLD",
              qtyIn: "0",
              qtyOut: String(qty),
              reason: `${detail} — attach hold ownership (out from unowned QC_HOLD → disposition #${createdDisp.id})`,
              createdByUserId: userId,
            },
          });
          await tx.stockTransaction.create({
            data: {
              itemId: fgItem.id,
              transactionType: "BUCKET_TRANSFER",
              refId: qc.id,
              qcRejectedDispositionId: createdDisp.id,
              stockBucket: "QC_HOLD",
              qtyIn: String(qty),
              qtyOut: "0",
              reason: `${detail} — attach hold ownership (owned QC_HOLD for disposition #${createdDisp.id})`,
              createdByUserId: userId,
            },
          });
        }

        const created = await tx.qcLegacyRejectedClassification.create({
          data: {
            sourceQcEntryId: qc.id,
            workOrderId: wo?.id ?? null,
            itemId: fgItem.id,
            qty: String(qty),
            action: body.action,
            fromStockBucket: qc.rejectedStockBucket,
            toStockBucket: toBucket,
            remarks: remarksTrim || null,
            createdByUserId: userId,
          },
          include: {
            item: { select: { itemName: true } },
            createdBy: { select: { name: true, email: true } },
          },
        });

        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.QC_ENTRY,
          entityId: String(qc.id),
          actorUserId: userId,
          actorRole: req.user.role,
          summary: `Legacy classification for QC #${qc.id}: ${body.action} qty ${qty}${stockMoved ? ` (${fromBucket}→${toBucket})` : " (no bucket change)"}`,
          payload: {
            legacyClassificationId: created.id,
            action: body.action,
            qty,
            fromBucket,
            toBucket,
            stockMoved,
            remarks: remarksTrim || null,
          },
        });

        return {
          id: created.id,
          sourceQcEntryId: created.sourceQcEntryId,
          action: created.action,
          qty: Number(created.qty),
          fromStockBucket: created.fromStockBucket,
          toStockBucket: created.toStockBucket,
          remarks: created.remarks,
          createdAt: created.createdAt.toISOString(),
          stockMoved,
        };
      });

      return res.status(201).json(result);
    } catch (e) {
      if (e instanceof ZodError) return next(e);
      return next(e);
    }
  },
);

module.exports = { qcLegacyRejectedClassificationsRouter };
