const express = require("express");
const { z } = require("zod");
const { Prisma } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { assertNonNegativeStockAfterNetChange, getItemStockQty } = require("../services/stockService");
const {
  roundQty,
  approvedQtyToStock,
  replacementUsageByReturnId,
  buildCustomerReturnListPayload,
} = require("../services/customerReturnListPayload");
const { sumQcAcceptedForSoItem } = require("../services/dispatchQcCap");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("../services/salesOrderDispatchAllocation");
const auditLog = require("../services/auditLog");

const {
  CUSTOMER_RETURN_CREATE_ROLES,
  CUSTOMER_RETURN_APPROVE_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
} = require("../constants/erpRoles");

const customerReturnsRouter = express.Router();

const ACCESS_DENIED = "Access denied for Customer Returns.";
const READ_DENIED = "Customer Returns is visible to operational roles only.";
const CREATE_DENIED = "Only Admin and Store can record a customer return.";
const APPROVE_REPLACEMENT_DENIED =
  "Only Admin and Sales can create or open a replacement Sales Order for a return.";

/** Read-only screens: list, filters, queue views — broad operational visibility. */
const readRoles = requireRole(CUSTOMER_RETURN_READ_ROLES, READ_DENIED);
/** Store-owned write actions: create return, approve-to-stock, scrap, rework approval / completion. */
const createRoles = requireRole(CUSTOMER_RETURN_CREATE_ROLES, CREATE_DENIED);
/** Sales-owned: create/open a replacement Sales Order (customer-facing commercial commitment). */
const approveReplacementRoles = requireRole(
  CUSTOMER_RETURN_APPROVE_ROLES,
  APPROVE_REPLACEMENT_DENIED,
);

async function sumAlreadyReturnedQty(tx, dispatchId) {
  const agg = await tx.customerReturn.aggregate({
    where: { dispatchId, reversedAt: null },
    _sum: { returnedQty: true },
  });
  return Number(agg._sum.returnedQty ?? 0);
}

// Recent locked dispatches for a customer (customer-first picker).
customerReturnsRouter.get("/dispatches", requireAuth, readRoles, async (req, res, next) => {
  try {
    const customerId = Number(req.query.customerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      const err = new Error("Valid customer is required.");
      err.statusCode = 400;
      throw err;
    }
    const take = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));

    const rows = await prisma.dispatch.findMany({
      where: {
        workflowStatus: "LOCKED",
        reversalOfId: null,
        salesOrder: { customerId },
      },
      orderBy: { id: "desc" },
      take,
      include: {
        item: true,
        salesOrder: { select: { id: true, customer: { select: { id: true, name: true } } } },
      },
    });

    const dispatchIds = rows.map((d) => d.id);
    const returnedAgg = await prisma.customerReturn.groupBy({
      by: ["dispatchId"],
      where: { dispatchId: { in: dispatchIds }, reversedAt: null },
      _sum: { returnedQty: true },
    });
    const returnedByDispatchId = new Map(returnedAgg.map((r) => [r.dispatchId, Number(r._sum.returnedQty ?? 0)]));

    const payload = rows.map((d) => {
      const dispatchedQty = Number(d.dispatchedQty ?? 0);
      const returnedQty = returnedByDispatchId.get(d.id) ?? 0;
      const balance = Math.max(0, dispatchedQty - returnedQty);
      return {
        dispatchId: d.id,
        dispatchNo: `DSP-${String(d.id).padStart(6, "0")}`,
        date: d.date,
        customer: d.salesOrder?.customer ? { id: d.salesOrder.customer.id, name: d.salesOrder.customer.name } : null,
        salesOrderId: d.soId,
        salesOrderNo: `SO-${d.soId}`,
        itemId: d.itemId,
        itemName: d.item?.itemName ?? `Item #${d.itemId}`,
        unit: d.item?.unit ?? "",
        dispatchedQty,
        alreadyReturnedQty: returnedQty,
        returnableBalanceQty: balance,
      };
    });

    return res.json({ rows: payload });
  } catch (e) {
    return next(e);
  }
});

// History list
customerReturnsRouter.get("/", requireAuth, readRoles, async (req, res, next) => {
  try {
    const take = Math.max(1, Math.min(200, Number(req.query.limit ?? 200) || 200));
    const rows = await prisma.customerReturn.findMany({
      orderBy: { id: "desc" },
      take,
      include: {
        customer: true,
        item: true,
        dispatch: true,
      },
    });

    const payload = await buildCustomerReturnListPayload(prisma, rows);

    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

// Create or open replacement Sales Order for an approved-to-stock return.
customerReturnsRouter.post("/:id/replacement-order", requireAuth, approveReplacementRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid return id");
      err.statusCode = 400;
      throw err;
    }
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM CustomerReturn WHERE id = ${id} LIMIT 1 FOR UPDATE`);

      const r = await tx.customerReturn.findUnique({ where: { id } });
      if (!r || r.reversedAt != null) {
        const err = new Error("Return not found");
        err.statusCode = 404;
        throw err;
      }
      if (r.status !== "APPROVED_TO_STOCK") {
        const err = new Error("Replacement order can be created only after the return is approved to stock.");
        err.statusCode = 409;
        throw err;
      }

      const existingSo = await tx.salesOrder.findUnique({
        where: { customerReturnId: r.id },
        include: { lines: true, customer: true, po: { include: { customer: true } }, quotation: true, dispatch: true },
      });
      let available;
      if (existingSo) {
        const lineSum = roundQty((existingSo.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0));
        const dr = (existingSo.dispatch || []).filter((d) => Number(d.itemId) === Number(r.itemId));
        const netOp = roundQty(netDispatchedByItemId(dr, DISPATCH_ALLOC_MODE.OPERATIONAL).get(r.itemId) ?? 0);
        const alreadyUsed = roundQty(Math.max(lineSum, netOp));
        let qcAcc = roundQty(await sumQcAcceptedForSoItem(tx, existingSo.id, r.itemId));
        if (r.status === "APPROVED_TO_STOCK" && r.reversedAt == null) {
          qcAcc = roundQty(Math.max(qcAcc, roundQty(Number(r.returnedQty ?? 0))));
        }
        available = Math.max(0, roundQty(qcAcc - alreadyUsed));
      } else {
        const usedByReturnId = await replacementUsageByReturnId(tx, [r.id]);
        const used = usedByReturnId.get(r.id) ?? 0;
        const approved = approvedQtyToStock(r);
        available = Math.max(0, roundQty(approved - used));
      }
      if (!(available > 0)) {
        const err = new Error("No replacement quantity available for this return.");
        err.statusCode = 409;
        throw err;
      }

      if (existingSo) {
        return { salesOrderId: existingSo.id, salesOrder: existingSo, created: false, availableForReplacementQty: available };
      }

      const created = await tx.salesOrder.create({
        data: {
          orderType: "REPLACEMENT",
          customerId: r.customerId,
          customerReturnId: r.id,
          originalSalesOrderId: r.salesOrderId,
          originalDispatchId: r.dispatchId,
          internalStatus: "DRAFT",
          customerPoReference: null,
          remarks: `Replacement for RET-${String(r.id).padStart(6, "0")} (DSP-${String(r.dispatchId).padStart(6, "0")})`,
          lines: {
            create: [
              {
                itemId: r.itemId,
                qty: String(available),
                customerPoQty: String(available),
                bufferPercent: "0",
                quotationLineId: null,
                isFree: false,
              },
            ],
          },
        },
        include: { lines: { include: { item: true } }, customer: true, po: { include: { customer: true } }, quotation: true, dispatch: true },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SALES_ORDER,
        entityId: String(created.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Replacement sales order SO-${created.id} created from return #${r.id}`,
        payload: {
          orderType: "REPLACEMENT",
          salesOrderId: created.id,
          customerReturnId: r.id,
          originalSalesOrderId: r.salesOrderId,
          originalDispatchId: r.dispatchId,
          itemId: r.itemId,
          qty: available,
        },
      });

      return { salesOrderId: created.id, salesOrder: created, created: true, availableForReplacementQty: available };
    });

    return res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    return next(e);
  }
});

customerReturnsRouter.get("/by-dispatch/:id", requireAuth, readRoles, async (req, res, next) => {
  try {
    const dispatchId = Number(req.params.id);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      const err = new Error("Invalid dispatch id");
      err.statusCode = 400;
      throw err;
    }
    const rows = await prisma.customerReturn.findMany({
      where: { dispatchId },
      orderBy: { id: "desc" },
      include: { customer: true, item: true },
    });
    return res.json(
      rows.map((r) => ({
        id: r.id,
        returnNo: `RET-${String(r.id).padStart(6, "0")}`,
        date: r.returnDate,
        qty: Number(r.returnedQty ?? 0),
        disposition: r.disposition,
        reason: r.reason,
        remarks: r.remarks,
        reversedAt: r.reversedAt,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

// Bucket queues (QC_HOLD / REWORK) for scrap action screens.
customerReturnsRouter.get("/bucket/:bucket", requireAuth, readRoles, async (req, res, next) => {
  try {
    const bucket = String(req.params.bucket || "").toUpperCase();
    if (!(bucket === "QC_HOLD" || bucket === "REWORK")) {
      const err = new Error("Invalid bucket");
      err.statusCode = 400;
      throw err;
    }
    const take = Math.max(1, Math.min(200, Number(req.query.limit ?? 200) || 200));
    const wantStatus = bucket === "QC_HOLD" ? "IN_QC_HOLD" : "IN_REWORK";
    const rows = await prisma.customerReturn.findMany({
      where: { reversedAt: null, status: wantStatus },
      orderBy: { id: "desc" },
      take,
      include: { customer: true, item: true, dispatch: true },
    });
    return res.json(
      rows.map((r) => ({
        id: r.id,
        returnNo: `RET-${String(r.id).padStart(6, "0")}`,
        date: r.returnDate,
        customer: { id: r.customerId, name: r.customer?.name ?? "Unknown" },
        dispatchId: r.dispatchId,
        dispatchNo: `DSP-${String(r.dispatchId).padStart(6, "0")}`,
        item: { id: r.itemId, name: r.item?.itemName ?? `Item #${r.itemId}`, unit: r.item?.unit ?? "" },
        qty: Number(r.returnedQty ?? 0),
        disposition: r.disposition,
        currentBucket: r.currentBucket,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

// QC Entry page — returns awaiting customer-return QC (hold after intake or after external rework, plus active rework).
customerReturnsRouter.get("/qc-queue", requireAuth, readRoles, async (req, res, next) => {
  try {
    const take = Math.max(1, Math.min(200, Number(req.query.limit ?? 200) || 200));
    const rows = await prisma.customerReturn.findMany({
      where: {
        reversedAt: null,
        status: { in: ["IN_QC_HOLD", "IN_REWORK"] },
      },
      orderBy: { id: "desc" },
      take,
      include: { customer: true, item: true, dispatch: true },
    });
    return res.json(
      rows.map((r) => ({
        id: r.id,
        returnNo: `RET-${String(r.id).padStart(6, "0")}`,
        date: r.returnDate,
        customer: { id: r.customerId, name: r.customer?.name ?? "Unknown" },
        dispatchId: r.dispatchId,
        dispatchNo: `DSP-${String(r.dispatchId).padStart(6, "0")}`,
        item: { id: r.itemId, name: r.item?.itemName ?? `Item #${r.itemId}`, unit: r.item?.unit ?? "" },
        qty: Number(r.returnedQty ?? 0),
        disposition: r.disposition,
        currentBucket: r.currentBucket,
        status: r.status,
      })),
    );
  } catch (e) {
    return next(e);
  }
});

// Scrap action: scrap from the current bucket (QC_HOLD or REWORK).
customerReturnsRouter.post("/:id/scrap", requireAuth, createRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid return id");
      err.statusCode = 400;
      throw err;
    }
    const body = z.object({ qty: z.number().positive().optional(), reason: z.string().optional().nullable() }).parse(req.body ?? {});
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM CustomerReturn WHERE id = ${id} LIMIT 1 FOR UPDATE`);
      const r = await tx.customerReturn.findUnique({ where: { id } });
      if (!r || r.reversedAt != null) {
        const err = new Error("Return not found");
        err.statusCode = 404;
        throw err;
      }
      if (!(r.status === "IN_QC_HOLD" || r.status === "IN_REWORK")) {
        const err = new Error("This return is already closed.");
        err.statusCode = 409;
        throw err;
      }
      if (!(r.currentBucket === "QC_HOLD" || r.currentBucket === "REWORK")) {
        const err = new Error("Scrap is allowed only from Hold for Checking or Rework.");
        err.statusCode = 400;
        throw err;
      }

      const reqQty = body.qty != null ? Number(body.qty) : Number(r.returnedQty);
      if (!Number.isFinite(reqQty) || reqQty <= 0) {
        const err = new Error("Valid scrap qty is required.");
        err.statusCode = 400;
        throw err;
      }
      if (reqQty > Number(r.returnedQty) + 1e-6) {
        const err = new Error("Scrap qty exceeds returned qty.");
        err.statusCode = 400;
        throw err;
      }

      // Ensure bucket stock is not negative after scrap.
      await assertNonNegativeStockAfterNetChange(
        tx,
        r.itemId,
        -reqQty,
        "Stock cannot go negative in this bucket.",
        { stockBucket: r.currentBucket },
      );

      const stockBefore = await getItemStockQty(r.itemId, tx, { stockBucket: r.currentBucket });
      const scrapTxn = await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "SCRAP",
          refId: r.id,
          stockBucket: r.currentBucket,
          qtyIn: "0",
          qtyOut: String(reqQty),
        },
      });

      const updated = await tx.customerReturn.update({
        where: { id: r.id },
        data: { status: "SCRAPPED", closedAt: new Date() },
      });

      const stockAfter = await getItemStockQty(r.itemId, tx, { stockBucket: r.currentBucket });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.CUSTOMER_RETURN,
        entityId: String(r.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Customer return #${r.id} scrapped (${roundQty(reqQty)} qty)`,
        payload: {
          returnId: r.id,
          dispatchId: r.dispatchId,
          itemId: r.itemId,
          bucket: r.currentBucket,
          qty: reqQty,
          stockBefore,
          stockAfter,
          stockTxnId: scrapTxn.id,
        },
        reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 512) : undefined,
      });

      return { customerReturn: updated, stockTxnId: scrapTxn.id };
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

// Rework completed: move stock REWORK -> QC_HOLD and mark QC pending.
customerReturnsRouter.post("/:id/rework-completed", requireAuth, createRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid return id");
      err.statusCode = 400;
      throw err;
    }
    const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM CustomerReturn WHERE id = ${id} LIMIT 1 FOR UPDATE`);
      const r = await tx.customerReturn.findUnique({ where: { id } });
      if (!r || r.reversedAt != null) {
        const err = new Error("Return not found");
        err.statusCode = 404;
        throw err;
      }
      if (r.status !== "IN_REWORK") {
        const err = new Error("This return is not in an active rework state.");
        err.statusCode = 409;
        throw err;
      }
      if (r.currentBucket !== "REWORK") {
        const err = new Error("Rework Completed is allowed only from Rework.");
        err.statusCode = 400;
        throw err;
      }

      const qty = Number(r.returnedQty);
      await assertNonNegativeStockAfterNetChange(
        tx,
        r.itemId,
        -qty,
        "Rework stock cannot go negative.",
        { stockBucket: "REWORK" },
      );

      // Transfer REWORK -> QC_HOLD
      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "REWORK",
          qtyIn: "0",
          qtyOut: String(qty),
        },
      });
      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "QC_HOLD",
          qtyIn: String(qty),
          qtyOut: "0",
        },
      });

      const updated = await tx.customerReturn.update({
        where: { id: r.id },
        data: { currentBucket: "QC_HOLD", status: "IN_QC_HOLD" },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.CUSTOMER_RETURN,
        entityId: String(r.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Customer return #${r.id} moved from Rework to Hold for Checking`,
        payload: { returnId: r.id, itemId: r.itemId, qty, fromBucket: "REWORK", toBucket: "QC_HOLD" },
        reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 512) : undefined,
      });

      return { customerReturn: updated };
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

// One-step rework QC: REWORK bucket -> QC_HOLD -> USABLE, same outcome as rework-completed + approve (no production).
customerReturnsRouter.post("/:id/approve-rework", requireAuth, createRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid return id");
      err.statusCode = 400;
      throw err;
    }
    const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM CustomerReturn WHERE id = ${id} LIMIT 1 FOR UPDATE`);
      const r = await tx.customerReturn.findUnique({ where: { id } });
      if (!r || r.reversedAt != null) {
        const err = new Error("Return not found");
        err.statusCode = 404;
        throw err;
      }
      if (r.status !== "IN_REWORK") {
        const err = new Error("Approve rework is only for returns in external rework (IN_REWORK).");
        err.statusCode = 409;
        throw err;
      }
      if (r.currentBucket !== "REWORK") {
        const err = new Error("Approve rework is allowed only while stock is in the Rework bucket.");
        err.statusCode = 400;
        throw err;
      }

      const qty = Number(r.returnedQty);
      await assertNonNegativeStockAfterNetChange(
        tx,
        r.itemId,
        -qty,
        "Rework stock cannot go negative.",
        { stockBucket: "REWORK" },
      );

      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "REWORK",
          qtyIn: "0",
          qtyOut: String(qty),
        },
      });
      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "QC_HOLD",
          qtyIn: String(qty),
          qtyOut: "0",
        },
      });

      await assertNonNegativeStockAfterNetChange(
        tx,
        r.itemId,
        -qty,
        "Hold stock cannot go negative.",
        { stockBucket: "QC_HOLD" },
      );

      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "QC_HOLD",
          qtyIn: "0",
          qtyOut: String(qty),
        },
      });
      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "USABLE",
          qtyIn: String(qty),
          qtyOut: "0",
        },
      });

      const updated = await tx.customerReturn.update({
        where: { id: r.id },
        data: { currentBucket: "USABLE", status: "APPROVED_TO_STOCK", closedAt: new Date() },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.CUSTOMER_RETURN,
        entityId: String(r.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Customer return #${r.id} rework approved to stock (REWORK → USABLE in one step)`,
        payload: { returnId: r.id, itemId: r.itemId, qty, fromBucket: "REWORK", toBucket: "USABLE" },
        reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 512) : undefined,
      });

      return { customerReturn: updated };
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

// QC approve: move stock QC_HOLD -> USABLE and close.
customerReturnsRouter.post("/:id/approve", requireAuth, createRoles, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid return id");
      err.statusCode = 400;
      throw err;
    }
    const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body ?? {});
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM CustomerReturn WHERE id = ${id} LIMIT 1 FOR UPDATE`);
      const r = await tx.customerReturn.findUnique({ where: { id } });
      if (!r || r.reversedAt != null) {
        const err = new Error("Return not found");
        err.statusCode = 404;
        throw err;
      }
      if (r.status !== "IN_QC_HOLD") {
        const err = new Error("This return is already closed.");
        err.statusCode = 409;
        throw err;
      }
      if (r.currentBucket !== "QC_HOLD") {
        const err = new Error("Approve is allowed only from Hold for Checking.");
        err.statusCode = 400;
        throw err;
      }

      const qty = Number(r.returnedQty);
      await assertNonNegativeStockAfterNetChange(
        tx,
        r.itemId,
        -qty,
        "Hold stock cannot go negative.",
        { stockBucket: "QC_HOLD" },
      );

      // Transfer QC_HOLD -> USABLE
      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "QC_HOLD",
          qtyIn: "0",
          qtyOut: String(qty),
        },
      });
      await tx.stockTransaction.create({
        data: {
          itemId: r.itemId,
          transactionType: "CUSTOMER_RETURN",
          refId: r.id,
          stockBucket: "USABLE",
          qtyIn: String(qty),
          qtyOut: "0",
        },
      });

      const updated = await tx.customerReturn.update({
        where: { id: r.id },
        data: { currentBucket: "USABLE", status: "APPROVED_TO_STOCK", closedAt: new Date() },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.CUSTOMER_RETURN,
        entityId: String(r.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Customer return #${r.id} approved and returned to stock`,
        payload: { returnId: r.id, itemId: r.itemId, qty, fromBucket: "QC_HOLD", toBucket: "USABLE" },
        reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 512) : undefined,
      });

      return { customerReturn: updated };
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

// Create return (posts stock movements per disposition)
customerReturnsRouter.post("/", requireAuth, createRoles, async (req, res, next) => {
  try {
    const schema = z
      .object({
        dispatchId: z.number().int(),
        returnedQty: z.number().positive(),
        reason: z.string().trim().min(1, "Reason is required"),
        // SCRAP accepted for backward compatibility; treated as "Hold for Checking" + immediate scrap.
        disposition: z.enum(["QC_HOLD", "REWORK", "TO_STOCK", "SCRAP"]),
        remarks: z.string().optional().nullable(),
        returnDate: z.coerce.date().optional(),
      })
      .strict();
    const body = schema.parse(req.body);
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      // Lock dispatch row to prevent race conditions on returnable balance.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM Dispatch WHERE id = ${body.dispatchId} LIMIT 1 FOR UPDATE`,
      );

      const dispatch = await tx.dispatch.findUnique({
        where: { id: body.dispatchId },
        include: { salesOrder: true },
      });
      if (!dispatch) {
        const err = new Error("Dispatch not found");
        err.statusCode = 404;
        throw err;
      }
      if (dispatch.reversalOfId != null) {
        const err = new Error("Cannot return against a reversal dispatch row.");
        err.statusCode = 400;
        throw err;
      }
      if (dispatch.workflowStatus !== "LOCKED") {
        const err = new Error("Cannot return against an unconfirmed dispatch.");
        err.statusCode = 409;
        throw err;
      }
      const dispatchedQty = Number(dispatch.dispatchedQty ?? 0);
      if (!(dispatchedQty > 0)) {
        const err = new Error("Invalid dispatch quantity");
        err.statusCode = 400;
        throw err;
      }

      const alreadyReturned = await sumAlreadyReturnedQty(tx, dispatch.id);
      const returnable = Math.max(0, dispatchedQty - alreadyReturned);
      const reqQty = Number(body.returnedQty);
      if (reqQty > returnable + 1e-6) {
        const err = new Error(`Returned qty exceeds available balance (${roundQty(returnable)})`);
        err.statusCode = 400;
        throw err;
      }

      const soId = dispatch.soId;
      const itemId = dispatch.itemId;
      const so = dispatch.salesOrder;
      const customerId = so?.customerId;
      if (!customerId) {
        const err = new Error("Sales order customer not found");
        err.statusCode = 400;
        throw err;
      }

      const returnDate = body.returnDate ?? new Date();
      const normalizedDisposition = body.disposition === "SCRAP" ? "QC_HOLD" : body.disposition;
      const currentBucket =
        normalizedDisposition === "TO_STOCK" ? "USABLE" : normalizedDisposition === "REWORK" ? "REWORK" : "QC_HOLD";
      const status =
        normalizedDisposition === "TO_STOCK"
          ? "APPROVED_TO_STOCK"
          : normalizedDisposition === "QC_HOLD"
            ? "IN_QC_HOLD"
            : "IN_REWORK";
      const closedAt = status === "APPROVED_TO_STOCK" ? new Date() : null;

      const cr = await tx.customerReturn.create({
        data: {
          customerId,
          dispatchId: dispatch.id,
          salesOrderId: soId,
          itemId,
          returnedQty: String(reqQty),
          reason: body.reason.trim(),
          returnDate,
          disposition: normalizedDisposition,
          currentBucket,
          status,
          closedAt,
          remarks: body.remarks?.trim() || null,
        },
      });

      // Stock movements:
      // - TO_STOCK: qtyIn USABLE (and close)
      // - QC_HOLD: qtyIn QC_HOLD (active)
      // - REWORK: qtyIn REWORK (active)
      // - SCRAP (compat): qtyIn QC_HOLD then qtyOut QC_HOLD (SCRAP) and close as SCRAPPED.
      const stockBeforeUsable = await getItemStockQty(itemId, tx, { stockBucket: "USABLE" });
      const stockBeforeHold = await getItemStockQty(itemId, tx, { stockBucket: "QC_HOLD" });
      const stockBeforeRework = await getItemStockQty(itemId, tx, { stockBucket: "REWORK" });

      if (normalizedDisposition === "TO_STOCK") {
        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "CUSTOMER_RETURN",
            refId: cr.id,
            stockBucket: "USABLE",
            qtyIn: String(reqQty),
            qtyOut: "0",
          },
        });
      } else if (normalizedDisposition === "QC_HOLD") {
        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "CUSTOMER_RETURN",
            refId: cr.id,
            stockBucket: "QC_HOLD",
            qtyIn: String(reqQty),
            qtyOut: "0",
          },
        });
      } else if (normalizedDisposition === "REWORK") {
        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "CUSTOMER_RETURN",
            refId: cr.id,
            stockBucket: "REWORK",
            qtyIn: String(reqQty),
            qtyOut: "0",
          },
        });
      }

      if (body.disposition === "SCRAP") {
        // Backward compatibility: return comes back physically, but is scrapped from QC_HOLD bucket.
        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "CUSTOMER_RETURN",
            refId: cr.id,
            stockBucket: "QC_HOLD",
            qtyIn: String(reqQty),
            qtyOut: "0",
          },
        });
        await assertNonNegativeStockAfterNetChange(
          tx,
          itemId,
          -reqQty,
          "QC hold stock cannot go negative",
          { stockBucket: "QC_HOLD" },
        );
        await tx.stockTransaction.create({
          data: {
            itemId,
            transactionType: "SCRAP",
            refId: cr.id,
            stockBucket: "QC_HOLD",
            qtyIn: "0",
            qtyOut: String(reqQty),
          },
        });
        await tx.customerReturn.update({
          where: { id: cr.id },
          data: { status: "SCRAPPED", closedAt: new Date(), currentBucket: "QC_HOLD" },
        });
      }

      const stockAfterUsable = await getItemStockQty(itemId, tx, { stockBucket: "USABLE" });
      const stockAfterHold = await getItemStockQty(itemId, tx, { stockBucket: "QC_HOLD" });
      const stockAfterRework = await getItemStockQty(itemId, tx, { stockBucket: "REWORK" });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.CUSTOMER_RETURN,
        entityId: String(cr.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Customer return #${cr.id} recorded (DSP-${dispatch.id}, ${roundQty(reqQty)} qty)`,
        payload: {
          dispatchId: dispatch.id,
          salesOrderId: soId,
          itemId,
          returnedQty: reqQty,
          disposition: body.disposition,
          stockBuckets: {
            before: { USABLE: stockBeforeUsable, QC_HOLD: stockBeforeHold, REWORK: stockBeforeRework },
            after: { USABLE: stockAfterUsable, QC_HOLD: stockAfterHold, REWORK: stockAfterRework },
          },
        },
        reason: body.reason.trim(),
      });

      return { customerReturn: cr, dispatchedQty, alreadyReturned, returnable };
    });

    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

module.exports = { customerReturnsRouter, ACCESS_DENIED };

