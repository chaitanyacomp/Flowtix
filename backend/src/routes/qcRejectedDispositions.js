const express = require("express");
const { z, ZodError } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  assertSufficientStockForQtyOut,
  getItemStockQty,
  STOCK_EPS,
} = require("../services/stockService");
const { pairBucketTransferInTx } = require("../services/bucketTransferPair");
const auditLog = require("../services/auditLog");
const { lockItemForUpdate } = require("../services/dispatchWriteLocks");
const { lockQcRejectedDispositionForUpdate } = require("../services/productionWriteLocks");
const { reconcileStaleSupervisorReworkDispositions } = require("../services/qcDispositionReconcile");
const { QC_REWORK_APPROVE_ROLES } = require("../constants/erpRoles");

const qcRejectedDispositionsRouter = express.Router();

const QC_ROLES = ["ADMIN", "QA"];
/**
 * Rework approval (Phase 1 corrected): PRODUCTION owns "Approve rework" / "Send For Rework".
 * ADMIN remains as an override. QC enters rejects; QC handles final recheck after rework.
 *
 * Local alias kept so the existing `supervisor-decision` route path and `SUPERVISOR_ROLES`
 * variable name stay stable — the legacy disposition status `REWORK_PENDING_SUPERVISOR`
 * is a domain status (not a role) and is intentionally not renamed.
 */
const SUPERVISOR_ROLES = QC_REWORK_APPROVE_ROLES;
const QC_PAGE_ROLES = ["ADMIN", "QA"];

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
      await prisma.$transaction(async (tx) => {
        await reconcileStaleSupervisorReworkDispositions(tx);
      });
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

      // Ownership: qty available for final rework QC per disposition = REWORK + legacy QC_PENDING.
      const readyIds = (readyForQcRecheck || []).map((d) => d.id).filter((id) => typeof id === "number" && id > 0);
      const reworkQcAvailByDispId = new Map();
      if (readyIds.length) {
        const [groupRework, groupLegacyPending] = await Promise.all([
          prisma.stockTransaction.groupBy({
            by: ["qcRejectedDispositionId"],
            where: { qcRejectedDispositionId: { in: readyIds }, stockBucket: "REWORK", reversedAt: null },
            _sum: { qtyIn: true, qtyOut: true },
          }),
          prisma.stockTransaction.groupBy({
            by: ["qcRejectedDispositionId"],
            where: { qcRejectedDispositionId: { in: readyIds }, stockBucket: "QC_PENDING", reversedAt: null },
            _sum: { qtyIn: true, qtyOut: true },
          }),
        ]);
        const addNet = (grouped) => {
          for (const g of grouped) {
            const dispId = g.qcRejectedDispositionId;
            if (dispId == null) continue;
            const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
            reworkQcAvailByDispId.set(dispId, (reworkQcAvailByDispId.get(dispId) || 0) + net);
          }
        };
        addNet(groupRework);
        addNet(groupLegacyPending);
      }

      // Ownership: compute disposition-owned QC_HOLD availability per disposition id (for HOLD decision queue).
      const holdIds = (holdStock || []).map((d) => d.id).filter((id) => typeof id === "number" && id > 0);
      const qcHoldByDispId = new Map();
      if (holdIds.length) {
        const groupedHold = await prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: holdIds }, stockBucket: "QC_HOLD", reversedAt: null },
          _sum: { qtyIn: true, qtyOut: true },
        });
        for (const g of groupedHold) {
          const id = g.qcRejectedDispositionId;
          if (id == null) continue;
          const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
          qcHoldByDispId.set(id, net);
        }
      }

      const legacySupervisorIds = (reworkPendingSupervisor || []).map((d) => d.id).filter((id) => typeof id === "number" && id > 0);
      const qcHoldSupervisorQueueByDispId = new Map();
      if (legacySupervisorIds.length) {
        const groupedSupHold = await prisma.stockTransaction.groupBy({
          by: ["qcRejectedDispositionId"],
          where: { qcRejectedDispositionId: { in: legacySupervisorIds }, stockBucket: "QC_HOLD", reversedAt: null },
          _sum: { qtyIn: true, qtyOut: true },
        });
        for (const g of groupedSupHold) {
          const dispId = g.qcRejectedDispositionId;
          if (dispId == null) continue;
          const net = Number(g._sum.qtyIn || 0) - Number(g._sum.qtyOut || 0);
          qcHoldSupervisorQueueByDispId.set(dispId, net);
        }
      }

      const mapRow = (d) => ({
        id: d.id,
        qty: Number(d.qty),
        remainingQty:
          d.status === "REWORK_READY_FOR_QC"
            ? Number(reworkQcAvailByDispId.get(d.id) ?? 0)
            : d.status === "HOLD"
              ? Number(qcHoldByDispId.get(d.id) ?? 0)
              : d.status === "REWORK_PENDING_SUPERVISOR"
                ? Number(qcHoldSupervisorQueueByDispId.get(d.id) ?? 0)
                : Number(d.remainingQty),
        dispositionRemainingQty: Number(d.remainingQty),
        qcPendingQty: d.status === "REWORK_READY_FOR_QC" ? Number(reworkQcAvailByDispId.get(d.id) ?? 0) : null,
        mismatch:
          d.status === "REWORK_READY_FOR_QC"
            ? Number(d.remainingQty) > STOCK_EPS && Number(reworkQcAvailByDispId.get(d.id) ?? 0) <= STOCK_EPS
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

      const reworkQcPendingRows = readyForQcRecheck
        .filter((d) => Number(reworkQcAvailByDispId.get(d.id) ?? 0) > STOCK_EPS)
        .map(mapRow);
      const holdDecisionRows = holdStock.filter((d) => Number(qcHoldByDispId.get(d.id) ?? 0) > STOCK_EPS).map(mapRow);
      const legacyReworkApprovalRows = reworkPendingSupervisor
        .filter((d) => Number(qcHoldSupervisorQueueByDispId.get(d.id) ?? 0) > STOCK_EPS)
        .map(mapRow);

      return res.json({
        reworkQcPending: reworkQcPendingRows,
        holdDecisionsPending: holdDecisionRows,
        legacyReworkApprovalPending: legacyReworkApprovalRows,
        reworkPendingSupervisor: legacyReworkApprovalRows,
        reworkApprovedPendingExecution: reworkApprovedPendingExecution.map(mapRow),
        readyForQcRecheck: reworkQcPendingRows,
        // Admin-only: historical mismatch list for audit. Not actionable.
        ...(req.user?.role === "ADMIN"
          ? {
              readyForQcRecheckMismatches: readyForQcRecheck
                .filter((d) => Number(d.remainingQty) > STOCK_EPS && Number(reworkQcAvailByDispId.get(d.id) ?? 0) <= STOCK_EPS)
                .map(mapRow),
            }
          : {}),
        holdStock: holdDecisionRows,
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
        await lockQcRejectedDispositionForUpdate(tx, id);
        await reconcileStaleSupervisorReworkDispositions(tx);

        const d0 = await tx.qcRejectedDisposition.findFirst({
          where: { id, voidedAt: null },
          include: { item: true, workOrder: true, sourceQcEntry: true },
        });
        if (!d0) {
          const err = new Error("Disposition not found");
          err.statusCode = 404;
          throw err;
        }

        if (body.decision === "APPROVE" && d0.status === "REWORK_READY_FOR_QC") {
          return await tx.qcRejectedDisposition.findFirst({
            where: { id, voidedAt: null },
            include: dispInclude,
          });
        }

        if (d0.status !== "REWORK_PENDING_SUPERVISOR") {
          const err = new Error(
            d0.status === "REWORK_READY_FOR_QC"
              ? "This rework batch is already in Rework QC stage."
              : "Only lots awaiting supervisor approval for rework can be actioned here.",
          );
          err.statusCode = 409;
          throw err;
        }

        const remainingDb = Number(d0.remainingQty);
        if (remainingDb <= STOCK_EPS) {
          const err = new Error("Nothing left to action on this disposition.");
          err.statusCode = 400;
          throw err;
        }

        const ownedHold = await getItemStockQty(d0.itemId, tx, {
          stockBucket: "QC_HOLD",
          qcRejectedDispositionId: d0.id,
          excludeReversed: true,
        });
        const ownedPending = await getItemStockQty(d0.itemId, tx, {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d0.id,
          excludeReversed: true,
        });
        const ownedReworkStock = await getItemStockQty(d0.itemId, tx, {
          stockBucket: "REWORK",
          qcRejectedDispositionId: d0.id,
          excludeReversed: true,
        });

        if (body.decision === "APPROVE" && ownedHold <= STOCK_EPS && (ownedPending > STOCK_EPS || ownedReworkStock > STOCK_EPS)) {
          const updated = await tx.qcRejectedDisposition.update({
            where: { id: d0.id },
            data: {
              status: "REWORK_READY_FOR_QC",
              supervisorApprovedByUserId: userId,
              supervisorApprovedAt: new Date(),
              remarks: remarksTrim || d0.remarks,
            },
            include: dispInclude,
          });
          await auditLog.write(tx, {
            action: auditLog.AuditAction.APPROVE,
            entityType: auditLog.AuditEntityType.QC_ENTRY,
            entityId: String(d0.sourceQcEntryId),
            actorUserId: userId,
            actorRole: req.user.role,
            summary: `Supervisor approved rework for disposition #${d0.id} — stock already in rework QC pipeline (no bucket move)`,
            payload: {
              dispositionId: d0.id,
              ownedLegacyPendingQty: ownedPending,
              ownedReworkQty: ownedReworkStock,
            },
          });
          return updated;
        }

        await lockItemForUpdate(tx, d0.itemId);

        const d = d0;

        if (body.decision === "APPROVE") {
          const transferQty = Math.min(remainingDb, ownedHold);
          if (transferQty <= STOCK_EPS) {
            const err = new Error("This rework batch is already in Rework QC stage.");
            err.statusCode = 409;
            throw err;
          }
          await assertSufficientStockForQtyOut(tx, d.itemId, transferQty, "This rework quantity is no longer available. Please refresh.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
            excludeReversed: true,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: transferQty,
            fromBucket: "QC_HOLD",
            toBucket: "REWORK",
            reasonDetail: remarksTrim || `Supervisor approved manual rework → rework bucket (disposition #${d.id})`,
            userId,
            req,
            auditLogTitle: "Rework supervisor approve",
            qcRejectedDispositionId: d.id,
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
            payload: { dispositionId: d.id, qty: transferQty },
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
        const scrapQty = Math.min(remainingDb, ownedHold);
        if (scrapQty <= STOCK_EPS) {
          const err = new Error("This rework batch is already in Rework QC stage.");
          err.statusCode = 409;
          throw err;
        }
        await assertSufficientStockForQtyOut(tx, d.itemId, scrapQty, "This rework quantity is no longer available. Please refresh.", {
          stockBucket: "QC_HOLD",
          qcRejectedDispositionId: d.id,
          excludeReversed: true,
        });
        await pairBucketTransferInTx(tx, {
          itemId: d.itemId,
          item: d.item,
          qty: scrapQty,
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
          payload: { dispositionId: d.id, qty: scrapQty },
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
 * Legacy endpoint: manual rework happens outside ERP production—stock stays in the rework bucket until final rework QC.
 * Promotes REWORK_APPROVED_PENDING_EXECUTION → REWORK_READY_FOR_QC without moving buckets.
 */
qcRejectedDispositionsRouter.post(
  "/qc-rejected-dispositions/:id/mark-rework-executed",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION", "STORE"]),
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
        if (d.status === "REWORK_READY_FOR_QC") {
          return await tx.qcRejectedDisposition.findFirst({
            where: { id, voidedAt: null },
            include: dispInclude,
          });
        }
        if (d.status !== "REWORK_APPROVED_PENDING_EXECUTION") {
          const err = new Error(
            d.status === "CLOSED"
              ? "This rework lot is already closed."
              : "This rework lot is not pending execution.",
          );
          err.statusCode = 409;
          throw err;
        }
        const remaining = Number(d.remainingQty);
        if (!(remaining > STOCK_EPS)) {
          const err = new Error("No remaining quantity for this rework disposition.");
          err.statusCode = 409;
          throw err;
        }

        await lockItemForUpdate(tx, d.itemId);

        const ownedRework = await getItemStockQty(d.itemId, tx, {
          stockBucket: "REWORK",
          qcRejectedDispositionId: d.id,
          excludeReversed: true,
        });
        const ownedLegacyPending = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d.id,
          excludeReversed: true,
        });
        if (ownedRework <= STOCK_EPS && ownedLegacyPending <= STOCK_EPS) {
          const err = new Error(
            "No rework quantity found for this disposition in REWORK (or legacy awaiting-QC). Refresh or contact support.",
          );
          err.statusCode = 409;
          throw err;
        }

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
          summary: `Rework marked ready for final QC (disposition #${d.id}); stock unchanged in rework pipeline`,
          payload: { dispositionId: d.id, ownedReworkQty: ownedRework, ownedLegacyPendingQty: ownedLegacyPending },
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
          const rem = Number(d.remainingQty) - q;
          const created = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: d.sourceQcEntryId,
              workOrderId: d.workOrderId,
              itemId: d.itemId,
              qty: String(q),
              remainingQty: String(q),
              phase: "FIRST_QC",
              status: "REWORK_READY_FOR_QC",
              remarks: remarksTrim || `From hold → rework bucket (split from disposition #${d.id})`,
              createdByUserId: userId,
              parentDispositionId: d.id,
            },
            include: dispInclude,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: q,
            fromBucket: "QC_HOLD",
            toBucket: "REWORK",
            reasonDetail: remarksTrim || `Hold → rework bucket (parent #${d.id} → child #${created.id})`,
            userId,
            req,
            auditLogTitle: "Hold → rework bucket",
            qcRejectedDispositionId: d.id,
            toQcRejectedDispositionId: created.id,
          });
          await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              remainingQty: String(Math.max(0, rem)),
              status: rem <= STOCK_EPS ? "CLOSED" : "HOLD",
              closedAt: rem <= STOCK_EPS ? new Date() : d.closedAt,
            },
          });
          await auditLog.write(tx, {
            action: auditLog.AuditAction.CREATE,
            entityType: auditLog.AuditEntityType.QC_ENTRY,
            entityId: String(d.sourceQcEntryId),
            actorUserId: userId,
            actorRole: req.user.role,
            summary: `Hold → rework bucket (new disposition #${created.id})`,
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
 * POST /api/production/qc-rejected-dispositions/:id/hold-save-combined
 * Apply To Usable / To Rework / To Scrap in one transaction (operator hold card).
 */
qcRejectedDispositionsRouter.post(
  "/qc-rejected-dispositions/:id/hold-save-combined",
  requireAuth,
  requireRole(QC_PAGE_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          toUsable: z.number().nonnegative(),
          toRework: z.number().nonnegative(),
          toScrap: z.number().nonnegative(),
          remarks: z.string().max(2000).optional(),
        })
        .strict()
        .parse(req.body ?? {});
      const remarksTrim = typeof body.remarks === "string" ? body.remarks.trim() : "";
      const u = Number(body.toUsable);
      const r = Number(body.toRework);
      const s = Number(body.toScrap);
      const sum = u + r + s;
      if (!(sum > STOCK_EPS)) {
        const err = new Error("Enter at least one positive quantity for usable, rework, or scrap.");
        err.statusCode = 400;
        throw err;
      }
      const userId = req.user.userId;

      const out = await prisma.$transaction(async (tx) => {
        const loadDisp = async () => {
          const row = await tx.qcRejectedDisposition.findFirst({
            where: { id, voidedAt: null },
            include: { item: true, workOrder: true, sourceQcEntry: true },
          });
          if (!row) {
            const err = new Error("Disposition not found");
            err.statusCode = 404;
            throw err;
          }
          if (row.status !== "HOLD") {
            const err = new Error("This action applies to hold stock only.");
            err.statusCode = 400;
            throw err;
          }
          return row;
        };

        let d = await loadDisp();
        await lockItemForUpdate(tx, d.itemId);
        let ownedHoldAvail = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_HOLD",
          qcRejectedDispositionId: d.id,
        });
        if (!(ownedHoldAvail > STOCK_EPS)) {
          const err = new Error("This hold quantity is no longer available. Please refresh.");
          err.statusCode = 409;
          throw err;
        }
        if (sum > ownedHoldAvail + STOCK_EPS || sum > Number(d.remainingQty) + STOCK_EPS) {
          const err = new Error("Total quantity exceeds pending hold quantity.");
          err.statusCode = 400;
          throw err;
        }

        const assertOwned = async (qty) => {
          const avail = await getItemStockQty(d.itemId, tx, {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          if (qty > avail + STOCK_EPS) {
            const err = new Error("Pending hold quantity is lower than entered quantity. Please refresh.");
            err.statusCode = 409;
            throw err;
          }
        };

        if (r > STOCK_EPS) {
          await assertOwned(r);
          await assertSufficientStockForQtyOut(tx, d.itemId, r, "This hold quantity is no longer available. Please refresh.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          const rem0 = Number(d.remainingQty) - r;
          const created = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: d.sourceQcEntryId,
              workOrderId: d.workOrderId,
              itemId: d.itemId,
              qty: String(r),
              remainingQty: String(r),
              phase: "FIRST_QC",
              status: "REWORK_READY_FOR_QC",
              remarks: remarksTrim || `From hold → rework bucket (split from disposition #${d.id})`,
              createdByUserId: userId,
              parentDispositionId: d.id,
            },
            include: dispInclude,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: r,
            fromBucket: "QC_HOLD",
            toBucket: "REWORK",
            reasonDetail: remarksTrim || `Hold → rework bucket (parent #${d.id} → child #${created.id})`,
            userId,
            req,
            auditLogTitle: "Hold → rework bucket",
            qcRejectedDispositionId: d.id,
            toQcRejectedDispositionId: created.id,
          });
          await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              remainingQty: String(Math.max(0, rem0)),
              status: rem0 <= STOCK_EPS ? "CLOSED" : "HOLD",
              closedAt: rem0 <= STOCK_EPS ? new Date() : d.closedAt,
            },
          });
          const nd = await tx.qcRejectedDisposition.findFirst({ where: { id }, include: dispInclude });
          if (!nd || nd.status !== "HOLD" || Number(nd.remainingQty) <= STOCK_EPS) {
            return nd;
          }
          d = nd;
        }

        if (s > STOCK_EPS) {
          await assertOwned(s);
          await assertSufficientStockForQtyOut(tx, d.itemId, s, "This hold quantity is no longer available. Please refresh.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: s,
            fromBucket: "QC_HOLD",
            toBucket: "SCRAP",
            reasonDetail: remarksTrim || `Hold scrap (disposition #${d.id})`,
            userId,
            req,
            auditLogTitle: "Hold scrap",
            qcRejectedDispositionId: d.id,
          });
          const rem1 = Number(d.remainingQty) - s;
          await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              remainingQty: String(Math.max(0, rem1)),
              status: rem1 <= STOCK_EPS ? "SCRAP" : "HOLD",
              closedAt: rem1 <= STOCK_EPS ? new Date() : d.closedAt,
              remarks: remarksTrim || d.remarks,
            },
          });
          const nd2 = await tx.qcRejectedDisposition.findFirst({ where: { id }, include: dispInclude });
          if (!nd2 || nd2.status !== "HOLD" || Number(nd2.remainingQty) <= STOCK_EPS) {
            return nd2;
          }
          d = nd2;
        }

        if (u > STOCK_EPS) {
          await assertOwned(u);
          await assertSufficientStockForQtyOut(tx, d.itemId, u, "This hold quantity is no longer available. Please refresh.", {
            stockBucket: "QC_HOLD",
            qcRejectedDispositionId: d.id,
          });
          await pairBucketTransferInTx(tx, {
            itemId: d.itemId,
            item: d.item,
            qty: u,
            fromBucket: "QC_HOLD",
            toBucket: "USABLE",
            reasonDetail: remarksTrim || `Hold release to usable (disposition #${d.id})`,
            userId,
            req,
            auditLogTitle: "Hold release usable",
            qcRejectedDispositionId: d.id,
          });
          const rem2 = Number(d.remainingQty) - u;
          await tx.qcRejectedDisposition.update({
            where: { id: d.id },
            data: {
              remainingQty: String(Math.max(0, rem2)),
              status: rem2 <= STOCK_EPS ? "CLOSED" : "HOLD",
              closedAt: rem2 <= STOCK_EPS ? new Date() : d.closedAt,
              remarks: remarksTrim || d.remarks,
            },
          });
        }

        return tx.qcRejectedDisposition.findFirst({ where: { id }, include: dispInclude });
      });

      return res.status(200).json(out);
    } catch (e) {
      if (e instanceof ZodError) return next(e);
      return next(e);
    }
  },
);

/**
 * POST /api/production/qc-rejected-dispositions/:id/recheck
 * Final rework QC: consume disposition-owned REWORK (and legacy QC_PENDING if present) → USABLE / SCRAP.
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
              ? "This rework batch was already processed."
              : "This rework batch is not available for QC. Please refresh.",
          );
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

        const ownedRework = await getItemStockQty(d.itemId, tx, {
          stockBucket: "REWORK",
          qcRejectedDispositionId: d.id,
          excludeReversed: true,
        });
        const ownedLegacyPending = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_PENDING",
          qcRejectedDispositionId: d.id,
          excludeReversed: true,
        });
        const pooledQcPending = await getItemStockQty(d.itemId, tx, {
          stockBucket: "QC_PENDING",
          excludeReversed: true,
        });
        const pooledRework = await getItemStockQty(d.itemId, tx, {
          stockBucket: "REWORK",
          excludeReversed: true,
        });
        if (ownedRework <= STOCK_EPS && ownedLegacyPending <= STOCK_EPS) {
          const err = new Error("This rework quantity is no longer available. Please refresh.");
          err.statusCode = 409;
          throw err;
        }

        /** Authoritative rework lot size — disposition-owned REWORK + legacy QC_PENDING (not pooled, not remainingQty). */
        const pendingQty = ownedRework + ownedLegacyPending;
        const checkedQty = pendingQty;
        if (rejectedQty > checkedQty + STOCK_EPS) {
          const err = new Error("Rejected quantity cannot exceed pending rework quantity.");
          err.statusCode = 400;
          throw err;
        }
        const acceptedQty = checkedQty - rejectedQty;

        console.debug("[QC_RECHECK]", {
          dispositionId: d.id,
          dispositionRemainingQty: Number(d.remainingQty),
          ownedReworkQty: ownedRework,
          ownedLegacyPendingQty: ownedLegacyPending,
          pooledReworkQty: pooledRework,
          pooledQcPendingQty: pooledQcPending,
          checkedQty,
          acceptedQty,
          rejectedQty,
        });

        if (ownedRework > STOCK_EPS) {
          await assertSufficientStockForQtyOut(tx, d.itemId, ownedRework, "This rework quantity is no longer available. Please refresh.", {
            stockBucket: "REWORK",
            qcRejectedDispositionId: d.id,
            excludeReversed: true,
          });
        }
        if (ownedLegacyPending > STOCK_EPS) {
          await assertSufficientStockForQtyOut(tx, d.itemId, ownedLegacyPending, "This rework quantity is no longer available. Please refresh.", {
            stockBucket: "QC_PENDING",
            qcRejectedDispositionId: d.id,
            excludeReversed: true,
          });
        }

        const stockBefore = await getItemStockQty(d.itemId, tx);

        const detail = reasonNote || "QC recheck";
        /** @type {import("@prisma/client").StockTransaction | null} */
        let outTxn = null;
        if (ownedRework > STOCK_EPS) {
          outTxn = await tx.stockTransaction.create({
            data: {
              itemId: d.itemId,
              transactionType: "BUCKET_TRANSFER",
              refId: d.id,
              qcRejectedDispositionId: d.id,
              stockBucket: "REWORK",
              qtyIn: "0",
              qtyOut: String(ownedRework),
              reason: `QC recheck (disposition #${d.id}): out from REWORK — ${ownedRework} of ${checkedQty} — ${detail}`,
              createdByUserId: userId,
            },
            include: { item: true },
          });
        }
        if (ownedLegacyPending > STOCK_EPS) {
          const legOut = await tx.stockTransaction.create({
            data: {
              itemId: d.itemId,
              transactionType: "BUCKET_TRANSFER",
              refId: d.id,
              qcRejectedDispositionId: d.id,
              stockBucket: "QC_PENDING",
              qtyIn: "0",
              qtyOut: String(ownedLegacyPending),
              reason: `QC recheck (disposition #${d.id}): out from legacy awaiting-QC — ${ownedLegacyPending} of ${checkedQty} — ${detail}`,
              createdByUserId: userId,
            },
            include: { item: true },
          });
          if (!outTxn) outTxn = legOut;
        }
        if (!outTxn) {
          const err = new Error("Rework QC could not be saved (no stock out row). Please contact support.");
          err.statusCode = 500;
          throw err;
        }

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
          await tx.scrapRecord.create({
            data: {
              fgItemId: d.itemId,
              workOrderId: d.workOrderId,
              rejectedQty: String(rejectedQty),
              reason: `Rework final QC (disposition #${d.id})`,
              qcEntryId: d.sourceQcEntryId,
            },
          });
        }

        const stockAfter = await getItemStockQty(d.itemId, tx);
        if (Math.abs(stockAfter - stockBefore) > STOCK_EPS) {
          const err = new Error("Rework QC could not be saved (stock totals mismatch). Please contact support.");
          err.statusCode = 500;
          throw err;
        }

        const rem = Math.max(0, pendingQty - checkedQty);
        await tx.qcRejectedDisposition.update({
          where: { id: d.id },
          data: {
            remainingQty: String(rem),
            status: rem <= STOCK_EPS ? "CLOSED" : "REWORK_READY_FOR_QC",
            closedAt: rem <= STOCK_EPS ? new Date() : null,
          },
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
