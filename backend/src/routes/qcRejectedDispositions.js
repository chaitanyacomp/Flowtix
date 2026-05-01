const express = require("express");
const { z, ZodError } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  assertNonNegativeStockAfterNetChange,
  assertSufficientStockForQtyOut,
  getItemStockQty,
  STOCK_EPS,
} = require("../services/stockService");
const { pairBucketTransferInTx } = require("../services/bucketTransferPair");
const auditLog = require("../services/auditLog");
const { lockItemForUpdate } = require("../services/dispatchWriteLocks");
const { lockQcRejectedDispositionForUpdate } = require("../services/productionWriteLocks");

const qcRejectedDispositionsRouter = express.Router();

const QC_ROLES = ["ADMIN", "QC"];
const SUPERVISOR_ROLES = ["ADMIN", "SUPERVISOR"];
const QC_PAGE_ROLES = ["ADMIN", "QC", "SUPERVISOR"];

const dispInclude = {
  item: { select: { id: true, itemName: true, unit: true, itemType: true } },
  workOrder: { select: { id: true, docNo: true, salesOrderId: true, cycleId: true, cycle: { select: { cycleNo: true } } } },
  sourceQcEntry: { select: { id: true, docNo: true, productionId: true } },
};

/**
 * GET /api/production/qc-rejected-dispositions/queues
 */
qcRejectedDispositionsRouter.get(
  "/qc-rejected-dispositions/queues",
  requireAuth,
  requireRole(QC_PAGE_ROLES),
  async (req, res, next) => {
    try {
      const base = { voidedAt: null };
      const [reworkPendingSupervisor, reworkApprovedPendingExecution, readyForQcRecheck, holdStock, scrapRegister] = await Promise.all([
        prisma.qcRejectedDisposition.findMany({
          where: { ...base, status: "REWORK_PENDING_SUPERVISOR" },
          orderBy: [{ id: "desc" }],
          take: 200,
          include: dispInclude,
        }),
        prisma.qcRejectedDisposition.findMany({
          where: { ...base, status: "REWORK_APPROVED_PENDING_EXECUTION" },
          orderBy: [{ id: "desc" }],
          take: 200,
          include: dispInclude,
        }),
        prisma.qcRejectedDisposition.findMany({
          where: { ...base, status: "REWORK_READY_FOR_QC" },
          orderBy: [{ id: "desc" }],
          take: 200,
          include: dispInclude,
        }),
        prisma.qcRejectedDisposition.findMany({
          where: { ...base, status: "HOLD", remainingQty: { gt: 0 } },
          orderBy: [{ id: "desc" }],
          take: 200,
          include: dispInclude,
        }),
        prisma.qcRejectedDisposition.findMany({
          where: { ...base, status: "SCRAP" },
          orderBy: [{ closedAt: "desc" }, { id: "desc" }],
          take: 100,
          include: dispInclude,
        }),
      ]);

      // Ownership: compute disposition-owned QC_PENDING availability per disposition id.
      const readyIds = (readyForQcRecheck || []).map((d) => d.id).filter((id) => typeof id === "number" && id > 0);
      const qcPendingByDispId = new Map();
      if (readyIds.length) {
        const grouped = await prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: readyIds }, stockBucket: "QC_PENDING" },
          _sum: { qtyIn: true, qtyOut: true },
        });
        for (const g of grouped) {
          const id = g.qcRejectedDispositionId;
          if (id == null) continue;
          const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
          qcPendingByDispId.set(id, net);
        }
      }

      // Ownership: compute disposition-owned QC_HOLD availability per disposition id (for HOLD decision queue).
      const holdIds = (holdStock || []).map((d) => d.id).filter((id) => typeof id === "number" && id > 0);
      const qcHoldByDispId = new Map();
      if (holdIds.length) {
        const groupedHold = await prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: holdIds }, stockBucket: "QC_HOLD" },
          _sum: { qtyIn: true, qtyOut: true },
        });
        for (const g of groupedHold) {
          const id = g.qcRejectedDispositionId;
          if (id == null) continue;
          const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
          qcHoldByDispId.set(id, net);
        }
      }

      const mapRow = (d) => ({
        id: d.id,
        qty: Number(d.qty),
        remainingQty:
          d.status === "REWORK_READY_FOR_QC"
            ? Number(qcPendingByDispId.get(d.id) ?? 0)
            : d.status === "HOLD"
              ? Number(qcHoldByDispId.get(d.id) ?? 0)
              : Number(d.remainingQty),
        dispositionRemainingQty: Number(d.remainingQty),
        qcPendingQty: d.status === "REWORK_READY_FOR_QC" ? Number(qcPendingByDispId.get(d.id) ?? 0) : null,
        mismatch:
          d.status === "REWORK_READY_FOR_QC"
            ? Number(d.remainingQty) > STOCK_EPS && Number(qcPendingByDispId.get(d.id) ?? 0) <= STOCK_EPS
            : false,
        phase: d.phase,
        status: d.status,
        remarks: d.remarks,
        createdAt: d.createdAt.toISOString(),
        closedAt: d.closedAt ? d.closedAt.toISOString() : null,
        supervisorApprovedAt: d.supervisorApprovedAt ? d.supervisorApprovedAt.toISOString() : null,
        item: d.item,
        workOrder: d.workOrder,
        sourceQcEntry: d.sourceQcEntry,
        parentDispositionId: d.parentDispositionId,
      });

      return res.json({
        reworkPendingSupervisor: reworkPendingSupervisor.map(mapRow),
        reworkApprovedPendingExecution: reworkApprovedPendingExecution.map(mapRow),
        readyForQcRecheck: readyForQcRecheck
          .filter((d) => Number(qcPendingByDispId.get(d.id) ?? 0) > STOCK_EPS)
          .map(mapRow),
        // Admin-only: historical mismatch list for audit. Not actionable.
        ...(req.user?.role === "ADMIN"
          ? {
              readyForQcRecheckMismatches: readyForQcRecheck
                .filter((d) => Number(d.remainingQty) > STOCK_EPS && Number(qcPendingByDispId.get(d.id) ?? 0) <= STOCK_EPS)
                .map(mapRow),
            }
          : {}),
        // Only show HOLD decision rows when owned QC_HOLD stock exists (> 0).
        // Prevent ghost hold records after manual data edits/deletions.
        holdStock: holdStock.filter((d) => Number(qcHoldByDispId.get(d.id) ?? 0) > STOCK_EPS).map(mapRow),
        scrapRegister: scrapRegister.map(mapRow),
      });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * POST /api/production/qc-rejected-dispositions/:id/supervisor-decision
 */
qcRejectedDispositionsRouter.post(
  "/qc-rejected-dispositions/:id/supervisor-decision",
  requireAuth,
  requireRole(SUPERVISOR_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const schema = z
        .object({
          decision: z.enum(["APPROVE", "DENY"]),
          denyTo: z.enum(["HOLD", "SCRAP"]).optional(),
          remarks: z.string().max(2000).optional(),
        })
        .strict()
        .refine((b) => b.decision !== "DENY" || b.denyTo != null, {
          message: "denyTo is required when decision is DENY",
        });
      const body = schema.parse(req.body);
      const userId = req.user.userId;
      const remarksTrim = typeof body.remarks === "string" ? body.remarks.trim() : "";

      const result = await prisma.$transaction(async (tx) => {
        const d = await tx.qcRejectedDisposition.findFirst({
          where: { id, voidedAt: null },
          include: { item: true, workOrder: true, sourceQcEntry: true },
        });
        if (!d) {
          const err = new Error("Disposition not found");
          err.statusCode = 404;
          throw err;
        }
        if (d.status !== "REWORK_PENDING_SUPERVISOR") {
          const err = new Error("Only lots awaiting supervisor approval for rework can be actioned here.");
          err.statusCode = 400;
          throw err;
        }
        const qty = Number(d.remainingQty);
        if (qty <= STOCK_EPS) {
          const err = new Error("Nothing left to action on this disposition.");
          err.statusCode = 400;
          throw err;
        }

        await lockItemForUpdate(tx, d.itemId);

        if (body.decision === "APPROVE") {
          // TEMP DEBUG: stock movement visibility
          const qcHoldBefore = await getItemStockQty(d.itemId, tx, { stockBucket: "QC_HOLD" });
          const ownedQcHoldBefore = await getItemStockQty(d.itemId, tx, {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          const qcPendingBefore = await getItemStockQty(d.itemId, tx, {
            stockBucket: "QC_PENDING",
            qcRejectedDispositionId: d.id,
          });
          const ownedStockRowsBefore = await tx.stockTransaction.findMany({
            where: { qcRejectedDispositionId: d.id },
            orderBy: [{ id: "asc" }],
            select: { id: true, itemId: true, refId: true, stockBucket: true, qtyIn: true, qtyOut: true, reason: true, transactionType: true },
          });
          // eslint-disable-next-line no-console
          console.debug("[REWORK_SUPERVISOR_APPROVE_DEBUG]", {
            dispositionId: d.id,
            sourceQcEntryId: d.sourceQcEntryId,
            itemId: d.itemId,
            qty,
            filterUsedForOwnedHold: { itemId: d.itemId, stockBucket: "QC_HOLD", qcRejectedDispositionId: d.id },
            qcHoldBefore,
            ownedQcHoldBefore,
            ownedQcPendingBefore: qcPendingBefore,
            ownedStockRowsBefore,
          });
          // IMPORTANT: supervisor approval consumes OWNED QC_HOLD (by disposition id).
          await assertSufficientStockForQtyOut(tx, d.itemId, qty, "Insufficient quantity in source bucket.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty,
            fromBucket: "QC_HOLD",
            // Manual rework is outside ERP production. Supervisor approval means this lot can proceed
            // to final QC (awaiting-QC bucket), not an ERP production "rework" stage.
            toBucket: "QC_PENDING",
            reasonDetail: remarksTrim || `Supervisor approved manual rework → ready for final QC (disposition #${d.id})`,
            userId,
            req,
            auditLogTitle: "Rework supervisor approve",
            qcRejectedDispositionId: d.id,
          });
          const qcHoldAfter = await getItemStockQty(d.itemId, tx, { stockBucket: "QC_HOLD" });
          const ownedQcHoldAfter = await getItemStockQty(d.itemId, tx, {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          const qcPendingAfter = await getItemStockQty(d.itemId, tx, {
            stockBucket: "QC_PENDING",
            qcRejectedDispositionId: d.id,
          });
          const ownedStockRowsAfter = await tx.stockTransaction.findMany({
            where: { qcRejectedDispositionId: d.id },
            orderBy: [{ id: "asc" }],
            select: { id: true, itemId: true, refId: true, stockBucket: true, qtyIn: true, qtyOut: true, reason: true, transactionType: true },
          });
          // eslint-disable-next-line no-console
          console.debug("[REWORK_SUPERVISOR_APPROVE]", {
            dispositionId: d.id,
            itemId: d.itemId,
            qty,
            qcHoldBefore,
            qcHoldAfter,
            ownedQcHoldBefore,
            ownedQcHoldAfter,
            ownedQcPendingBefore: qcPendingBefore,
            ownedQcPendingAfter: qcPendingAfter,
            ownedStockRowsAfter,
          });
          const updated = await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              status: "REWORK_READY_FOR_QC",
              supervisorApprovedByUserId: userId,
              supervisorApprovedAt: new Date(),
              remarks: remarksTrim || d.remarks,
            },
            include: dispInclude,
          });
          await auditLog.write(tx, {
            action: auditLog.AuditAction.APPROVE,
            entityType: auditLog.AuditEntityType.QC_ENTRY,
            entityId: String(d.sourceQcEntryId),
            actorUserId: userId,
            actorRole: req.user.role,
            summary: `Supervisor approved rework for disposition #${d.id} (QC entry #${d.sourceQcEntryId})`,
            payload: { dispositionId: d.id, qty },
          });
          return updated;
        }

        // DENY
        if (body.denyTo === "HOLD") {
          const updated = await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              status: "HOLD",
              supervisorDeniedAt: new Date(),
              remarks: remarksTrim || d.remarks,
            },
            include: dispInclude,
          });
          await auditLog.write(tx, {
            action: auditLog.AuditAction.REJECT,
            entityType: auditLog.AuditEntityType.QC_ENTRY,
            entityId: String(d.sourceQcEntryId),
            actorUserId: userId,
            actorRole: req.user.role,
            summary: `Supervisor denied rework approval; moved to hold (disposition #${d.id})`,
            payload: { dispositionId: d.id },
          });
          return updated;
        }

        // DENY → SCRAP
        await assertSufficientStockForQtyOut(tx, d.itemId, qty, "Insufficient quantity in QC hold bucket.", {
          stockBucket: "QC_HOLD",
        });
        await pairBucketTransferInTx(tx, {
          itemId: d.itemId,
          item: d.item,
          qty,
          fromBucket: "QC_HOLD",
          toBucket: "SCRAP",
          reasonDetail: remarksTrim || `Supervisor denied rework → scrap (disposition #${d.id})`,
          userId,
          req,
          auditLogTitle: "Rework supervisor deny scrap",
          qcRejectedDispositionId: d.id,
        });
        const updated = await tx.qcRejectedDisposition.update({
          where: { id: d.id },
          data: {
            status: "SCRAP",
            remainingQty: "0",
            supervisorDeniedAt: new Date(),
            closedAt: new Date(),
            remarks: remarksTrim || d.remarks,
          },
          include: dispInclude,
        });
        await auditLog.write(tx, {
          action: auditLog.AuditAction.REJECT,
          entityType: auditLog.AuditEntityType.QC_ENTRY,
          entityId: String(d.sourceQcEntryId),
          actorUserId: userId,
          actorRole: req.user.role,
          summary: `Supervisor denied rework approval; scrapped (disposition #${d.id})`,
          payload: { dispositionId: d.id, qty },
        });
        return updated;
      });

      return res.status(200).json(result);
    } catch (e) {
      if (e instanceof ZodError) return next(e);
      return next(e);
    }
  },
);

/**
 * POST /api/production/qc-rejected-dispositions/:id/mark-rework-executed
 * After physical rework is done, move REWORK → QC_PENDING and allow QC recheck.
 */
qcRejectedDispositionsRouter.post(
  "/qc-rejected-dispositions/:id/mark-rework-executed",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION", "STORE", "SUPERVISOR"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z.object({ qty: z.number().positive().optional(), remarks: z.string().max(2000).optional() }).parse(req.body ?? {});
      const userId = req.user.userId;
      const remarksTrim = typeof body.remarks === "string" ? body.remarks.trim() : "";

      const out = await prisma.$transaction(async (tx) => {
        await lockQcRejectedDispositionForUpdate(tx, id);
        const d = await tx.qcRejectedDisposition.findFirst({
          where: { id, voidedAt: null },
          include: { item: true, workOrder: true, sourceQcEntry: true },
        });
        if (!d) {
          const err = new Error("Disposition not found");
          err.statusCode = 404;
          throw err;
        }
        if (d.status !== "REWORK_APPROVED_PENDING_EXECUTION") {
          const err = new Error(
            d.status === "REWORK_READY_FOR_QC"
              ? "This rework lot is already ready for QC recheck."
              : d.status === "CLOSED"
                ? "This rework lot is already closed."
                : "This rework lot is not pending execution.",
          );
          err.statusCode = 409;
          throw err;
        }
        const remaining = Number(d.remainingQty);
        if (!(remaining > STOCK_EPS)) {
          const err = new Error("No remaining quantity to send to QC recheck.");
          err.statusCode = 409;
          throw err;
        }
        const qty = Math.min(remaining, Number(body.qty ?? remaining));
        if (!(qty > STOCK_EPS)) {
          const err = new Error("Qty must be greater than 0.");
          err.statusCode = 400;
          throw err;
        }
        if (qty > remaining + STOCK_EPS) {
          const err = new Error(`Qty cannot exceed remaining (${remaining}).`);
          err.statusCode = 400;
          throw err;
        }

        await lockItemForUpdate(tx, d.itemId);
        await assertSufficientStockForQtyOut(tx, d.itemId, qty, "Insufficient quantity in rework bucket.", {
          stockBucket: "REWORK",
        });

        await pairBucketTransferInTx(tx, {
          itemId: d.itemId,
          item: d.item,
          qty,
          fromBucket: "REWORK",
          toBucket: "QC_PENDING",
          reasonDetail: remarksTrim || `Rework executed; sent to QC recheck (disposition #${d.id})`,
          userId,
          req,
          auditLogTitle: "Rework executed → QC recheck",
          qcRejectedDispositionId: d.id,
        });

        const updated = await tx.qcRejectedDisposition.update({
          where: { id: d.id },
          data: {
            status: "REWORK_READY_FOR_QC",
            remarks: remarksTrim || d.remarks,
          },
          include: dispInclude,
        });
        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.QC_ENTRY,
          entityId: String(d.sourceQcEntryId),
          actorUserId: userId,
          actorRole: req.user.role,
          summary: `Rework executed; disposition #${d.id} sent to QC recheck`,
          payload: { dispositionId: d.id, qty },
        });
        return updated;
      });

      return res.status(200).json(out);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * POST /api/production/qc-rejected-dispositions/:id/hold-action
 */
qcRejectedDispositionsRouter.post(
  "/qc-rejected-dispositions/:id/hold-action",
  requireAuth,
  requireRole(QC_PAGE_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const schema = z
        .object({
          action: z.enum(["TO_USABLE", "TO_REWORK", "SCRAP"]),
          qty: z.number().positive(),
          remarks: z.string().max(2000).optional(),
        })
        .strict();
      const body = schema.parse(req.body);
      const userId = req.user.userId;
      const remarksTrim = typeof body.remarks === "string" ? body.remarks.trim() : "";
      const q = Number(body.qty);

      const result = await prisma.$transaction(async (tx) => {
        const d = await tx.qcRejectedDisposition.findFirst({
          where: { id, voidedAt: null },
          include: { item: true, workOrder: true, sourceQcEntry: true },
        });
        if (!d) {
          const err = new Error("Disposition not found");
          err.statusCode = 404;
          throw err;
        }
        if (d.status !== "HOLD") {
          const err = new Error("This action applies to hold stock only.");
          err.statusCode = 400;
          throw err;
        }
        if (q > Number(d.remainingQty) + STOCK_EPS) {
          const err = new Error(`Quantity exceeds hold remaining (${Number(d.remainingQty)}).`);
          err.statusCode = 400;
          throw err;
        }

        await lockItemForUpdate(tx, d.itemId);

        // Ownership invariant: hold actions must consume this disposition's owned QC_HOLD stock.
        // Prevent "ghost" hold decisions when workflow row exists but stock was deleted/never posted.
        const ownedHoldAvail = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_HOLD",
          qcRejectedDispositionId: d.id,
        });
        if (!(ownedHoldAvail > STOCK_EPS)) {
          const err = new Error("Hold record exists but no stock available. Data inconsistency.");
          err.statusCode = 409;
          throw err;
        }
        if (q > ownedHoldAvail + STOCK_EPS) {
          const err = new Error(`Insufficient quantity in source bucket. Available: ${Number(ownedHoldAvail)}, required: ${q}`);
          err.statusCode = 409;
          throw err;
        }

        if (body.action === "TO_USABLE") {
          await assertSufficientStockForQtyOut(tx, d.itemId, q, "Insufficient quantity in QC hold bucket.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: q,
            fromBucket: "QC_HOLD",
            toBucket: "USABLE",
            reasonDetail: remarksTrim || `Hold release to usable (disposition #${d.id})`,
            userId,
            req,
            auditLogTitle: "Hold release usable",
            qcRejectedDispositionId: d.id,
          });
          const rem = Number(d.remainingQty) - q;
          const updated = await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              remainingQty: String(Math.max(0, rem)),
              status: rem <= STOCK_EPS ? "CLOSED" : "HOLD",
              closedAt: rem <= STOCK_EPS ? new Date() : d.closedAt,
              remarks: remarksTrim || d.remarks,
            },
            include: dispInclude,
          });
          return updated;
        }

        if (body.action === "TO_REWORK") {
          await assertSufficientStockForQtyOut(tx, d.itemId, q, "Insufficient quantity in QC hold bucket.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: q,
            fromBucket: "QC_HOLD",
            toBucket: "REWORK",
            reasonDetail: remarksTrim || `Hold → rework (disposition #${d.id})`,
            userId,
            req,
            auditLogTitle: "Hold → rework",
            qcRejectedDispositionId: d.id,
          });
          const rem = Number(d.remainingQty) - q;
          await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              remainingQty: String(Math.max(0, rem)),
              status: rem <= STOCK_EPS ? "CLOSED" : "HOLD",
              closedAt: rem <= STOCK_EPS ? new Date() : d.closedAt,
            },
          });
          const created = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: d.sourceQcEntryId,
              workOrderId: d.workOrderId,
              itemId: d.itemId,
              qty: String(q),
              remainingQty: String(q),
              phase: "FIRST_QC",
              status: "REWORK_PENDING_SUPERVISOR",
              remarks: remarksTrim || `From hold → rework queue (split from disposition #${d.id})`,
              createdByUserId: userId,
              parentDispositionId: d.id,
            },
            include: dispInclude,
          });
          await auditLog.write(tx, {
            action: auditLog.AuditAction.CREATE,
            entityType: auditLog.AuditEntityType.QC_ENTRY,
            entityId: String(d.sourceQcEntryId),
            actorUserId: userId,
            actorRole: req.user.role,
            summary: `Hold → rework pending supervisor (new disposition #${created.id})`,
            payload: { fromDispositionId: d.id, newDispositionId: created.id, qty: q },
          });
          return created;
        }

        // SCRAP from hold
        await assertSufficientStockForQtyOut(tx, d.itemId, q, "Insufficient quantity in QC hold bucket.", {
          stockBucket: "QC_HOLD",
          qcRejectedDispositionId: d.id,
        });
        await pairBucketTransferInTx(tx, {
          itemId: d.itemId,
          item: d.item,
          qty: q,
          fromBucket: "QC_HOLD",
          toBucket: "SCRAP",
          reasonDetail: remarksTrim || `Hold scrap (disposition #${d.id})`,
          userId,
          req,
          auditLogTitle: "Hold scrap",
          qcRejectedDispositionId: d.id,
        });
        const rem = Number(d.remainingQty) - q;
        const updated = await tx.qcRejectedDisposition.update({
          where: { id: d.id },
          data: {
            remainingQty: String(Math.max(0, rem)),
            status: rem <= STOCK_EPS ? "SCRAP" : "HOLD",
            closedAt: rem <= STOCK_EPS ? new Date() : d.closedAt,
            remarks: remarksTrim || d.remarks,
          },
          include: dispInclude,
        });
        return updated;
      });

      return res.status(200).json(result);
    } catch (e) {
      if (e instanceof ZodError) return next(e);
      return next(e);
    }
  },
);

/**
 * POST /api/production/qc-rejected-dispositions/:id/recheck
 * Consume approved rework (QC_PENDING) for this disposition line.
 */
qcRejectedDispositionsRouter.post(
  "/qc-rejected-dispositions/:id/recheck",
  requireAuth,
  requireRole(QC_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const schema = z
        .object({
          rejectedQty: z.number().nonnegative(),
          reason: z.string().max(2000).optional(),
        })
        .strict();
      const body = schema.parse(req.body);

      const userId = req.user.userId;
      const rejectedQty = Number(body.rejectedQty);
      const reasonNote = typeof body.reason === "string" ? body.reason.trim() : "";

      const result = await prisma.$transaction(async (tx) => {
        // Prevent duplicate/parallel rechecks: lock the disposition row first, then re-read the authoritative state.
        await lockQcRejectedDispositionForUpdate(tx, id);
        const d = await tx.qcRejectedDisposition.findFirst({
          where: { id, voidedAt: null },
          include: { item: true, workOrder: true, sourceQcEntry: true },
        });
        if (!d) {
          const err = new Error("Disposition not found");
          err.statusCode = 404;
          throw err;
        }
        if (d.status !== "REWORK_READY_FOR_QC") {
          const err = new Error(
            d.status === "CLOSED"
              ? "This rework QC line is already fully processed."
              : "This line is not ready for QC recheck. Refresh the page to see the latest status.",
          );
          err.statusCode = 409;
          throw err;
        }
        const latestRemaining = Number(d.remainingQty);
        if (!(latestRemaining > STOCK_EPS)) {
          const err = new Error("This rework QC line is already fully processed (no remaining quantity).");
          err.statusCode = 409;
          throw err;
        }

        await lockItemForUpdate(tx, d.itemId);

        const item = await tx.item.findUnique({ where: { id: d.itemId } });
        if (!item) {
          const err = new Error("Item not found");
          err.statusCode = 404;
          throw err;
        }

        // TEMP DEBUG: stock movement visibility
        const ownedQcPendingBefore = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d.id,
        });
        const usableBefore = await getItemStockQty(d.itemId, tx, { stockBucket: "USABLE" });
        const scrapBefore = await getItemStockQty(d.itemId, tx, { stockBucket: "SCRAP" });

        // Ownership rule: QC recheck must consume only this disposition's awaiting-QC qty (not pooled by item).
        const ownedQcPending = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d.id,
        });
        if (ownedQcPending <= STOCK_EPS) {
          const err = new Error("No awaiting-QC quantity is available for this rework line.");
          err.statusCode = 409;
          throw err;
        }
        // Final rework QC always applies to the full remaining qty.
        // Derive checkedQty server-side to avoid trusting client-entered checked quantity.
        if (ownedQcPending + STOCK_EPS < latestRemaining) {
          const err = new Error(
            `Data inconsistency: awaiting-QC stock (${Number(ownedQcPending)}) is less than disposition remaining (${Number(latestRemaining)}).`,
          );
          err.statusCode = 409;
          throw err;
        }
        const checkedQty = Number(latestRemaining);
        if (rejectedQty > checkedQty + 1e-9) {
          const err = new Error("Rejected qty cannot exceed remaining qty.");
          err.statusCode = 400;
          throw err;
        }
        const acceptedQty = checkedQty - rejectedQty;

        await assertSufficientStockForQtyOut(tx, d.itemId, checkedQty, "Insufficient quantity in awaiting-QC bucket.", {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d.id,
        });

        await assertNonNegativeStockAfterNetChange(
          tx,
          d.itemId,
          acceptedQty,
          "QC recheck would make usable stock negative; adjust quantities.",
          { stockBucket: "USABLE" },
        );

        // Final QC decision for reworked material:
        // - Accepted qty -> USABLE
        // - Rejected qty -> SCRAP
        if (rejectedQty > STOCK_EPS) {
          await assertNonNegativeStockAfterNetChange(
            tx,
            d.itemId,
            rejectedQty,
            "QC recheck would make scrap bucket negative.",
            { stockBucket: "SCRAP" },
          );
        }

        const stockBefore = await getItemStockQty(d.itemId, tx);

        const detail = reasonNote || "QC recheck";
        const outTxn = await tx.stockTransaction.create({
          data: {
            itemId: d.itemId,
            transactionType: "BUCKET_TRANSFER",
            refId: d.id,
            qcRejectedDispositionId: d.id,
            stockBucket: "QC_PENDING",
            qtyIn: "0",
            qtyOut: String(checkedQty),
            reason: `QC recheck (disposition #${d.id}): out from awaiting-QC — checked ${checkedQty} — ${detail}`,
            createdByUserId: userId,
          },
          include: { item: true },
        });

        if (acceptedQty > STOCK_EPS) {
          await tx.stockTransaction.create({
            data: {
              itemId: d.itemId,
              transactionType: "BUCKET_TRANSFER",
              refId: d.id,
              qcRejectedDispositionId: d.id,
              stockBucket: "USABLE",
              qtyIn: String(acceptedQty),
              qtyOut: "0",
              reason: `QC recheck (disposition #${d.id}): accepted to usable — ${detail}`,
              createdByUserId: userId,
            },
          });
        }

        if (rejectedQty > STOCK_EPS) {
          const ledgerBucket = "SCRAP";
          await tx.stockTransaction.create({
            data: {
              itemId: d.itemId,
              transactionType: "BUCKET_TRANSFER",
              refId: d.id,
              qcRejectedDispositionId: d.id,
              stockBucket: ledgerBucket,
              qtyIn: String(rejectedQty),
              qtyOut: "0",
              reason: `QC recheck (disposition #${d.id}): rejected → ${ledgerBucket} — ${detail}`,
              createdByUserId: userId,
            },
          });
        }

        const stockAfter = await getItemStockQty(d.itemId, tx);
        if (Math.abs(stockAfter - stockBefore) > STOCK_EPS) {
          const err = new Error("QC recheck left total on-hand inconsistent; operation aborted.");
          err.statusCode = 500;
          throw err;
        }

        const rem = Number(d.remainingQty) - checkedQty;
        await tx.qcRejectedDisposition.update({
          where: { id: d.id },
          data: {
            remainingQty: String(Math.max(0, rem)),
            status: rem <= STOCK_EPS ? "CLOSED" : "REWORK_READY_FOR_QC",
            closedAt: rem <= STOCK_EPS ? new Date() : null,
          },
        });

        const ownedQcPendingAfter = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d.id,
        });
        const usableAfter = await getItemStockQty(d.itemId, tx, { stockBucket: "USABLE" });
        const scrapAfter = await getItemStockQty(d.itemId, tx, { stockBucket: "SCRAP" });
        // eslint-disable-next-line no-console
        console.debug("[REWORK_FINAL_QC]", {
          dispositionId: d.id,
          itemId: d.itemId,
          checkedQty,
          acceptedQty,
          rejectedQty,
          ownedQcPendingBefore,
          ownedQcPendingAfter,
          usableBefore,
          usableAfter,
          scrapBefore,
          scrapAfter,
        });

        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.STOCK_ADJUSTMENT,
          entityId: String(outTxn.id),
          actorUserId: userId,
          actorRole: req.user.role,
          summary: `QC recheck disposition #${d.id}: checked ${checkedQty} (accepted ${acceptedQty}, rejected ${rejectedQty})`,
          payload: {
            dispositionId: d.id,
            sourceQcEntryId: d.sourceQcEntryId,
            checkedQty,
            acceptedQty,
            rejectedQty,
            rejectedStockBucket: rejectedQty > STOCK_EPS ? "SCRAP" : null,
          },
          reason: detail,
        });

        return {
          dispositionId: d.id,
          checkedQty,
          acceptedQty,
          rejectedQty,
          rejectedStockBucket: rejectedQty > STOCK_EPS ? "SCRAP" : null,
          remainingOnLine: Math.max(0, rem),
        };
      });

      return res.status(201).json(result);
    } catch (e) {
      if (e instanceof ZodError) return next(e);
      return next(e);
    }
  },
);

module.exports = { qcRejectedDispositionsRouter };
