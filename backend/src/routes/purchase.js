const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const auditLog = require("../services/auditLog");
const {
  QUEUE_EPS,
  sumReceivedByRmPoLineFromGrns,
  recalcRmPoStatus,
  assertAllItemsAreRm,
  hasActiveGrn,
} = require("../services/rmPurchaseHelpers");
const { getRmRequirementShortagesUsable } = require("../services/rmRequirementService");
const { assertSufficientStockForQtyOut } = require("../services/stockService");
const {
  isTestingModeRelaxed,
  resolveLineTaxFromItem,
  computeLineAmount,
  resolveSupplierSnapshots,
  assertPositiveRate,
} = require("../services/rmPoTaxFields");
const { repairRmPurchaseTaxData } = require("../services/rmPoTaxRepair");

const purchaseRouter = express.Router();

function uniqueWarnings(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function buildResolvedRmLine(item, l, relaxed) {
  assertPositiveRate(l.rate);
  const resolved = resolveLineTaxFromItem(item, { relaxed });
  const amount = computeLineAmount(l.qty, l.rate);
  return {
    row: {
      itemId: l.itemId,
      qty: String(l.qty),
      rate: String(l.rate),
      unit: resolved.unit,
      hsn: resolved.hsn,
      gstRate: String(resolved.gstRate),
      amount: String(amount),
    },
    warnings: resolved.warnings,
  };
}

const lineInSchema = z.object({
  id: z.number().int().optional(),
  itemId: z.number().int(),
  qty: z.number().positive(),
  rate: z.number().positive(),
});

purchaseRouter.get("/rm-requirements", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const rows = await getRmRequirementShortagesUsable();
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

purchaseRouter.get("/rm-pos", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const rows = await prisma.rmPurchaseOrder.findMany({
      orderBy: { id: "desc" },
      include: {
        supplier: true,
        lines: { include: { item: true }, orderBy: { id: "asc" } },
        grns: { include: { lines: true }, orderBy: { id: "desc" } },
      },
    });
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

purchaseRouter.get("/rm-pos/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      const err = new Error("Invalid id");
      err.statusCode = 400;
      throw err;
    }
    const row = await prisma.rmPurchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: { include: { item: true }, orderBy: { id: "asc" } },
        grns: { include: { lines: true }, orderBy: { id: "desc" } },
      },
    });
    if (!row) {
      const err = new Error("RM PO not found");
      err.statusCode = 404;
      throw err;
    }

    // Read-only aggregates for UI clarity: separate stock vs billing.
    // Billing numbers use bill status:
    // - FINALIZED locks quantities (billed)
    // - CANCELLED re-opens quantities (rebillable)
    const poLineIds = (row.lines || []).map((l) => l.id);
    const billedLines = await prisma.purchaseBillLine.findMany({
      where: {
        OR: [{ rmPoId: id }, { rmPoLineId: { in: poLineIds } }],
      },
      select: {
        rmPoLineId: true,
        qty: true,
        purchaseBill: { select: { status: true } },
      },
    });
    const finalizedByLineId = {};
    const cancelledByLineId = {};
    for (const ln of billedLines || []) {
      const lineId = ln.rmPoLineId;
      if (!lineId) continue;
      const q = Number(ln.qty);
      if (!Number.isFinite(q) || q <= 0) continue;
      const st = ln.purchaseBill?.status;
      if (st === "FINALIZED") {
        finalizedByLineId[lineId] = (finalizedByLineId[lineId] || 0) + q;
      } else if (st === "CANCELLED") {
        cancelledByLineId[lineId] = (cancelledByLineId[lineId] || 0) + q;
      }
    }

    return res.json({
      ...row,
      billingSummary: {
        finalizedBilledQtyByPoLineId: finalizedByLineId,
        cancelledBilledQtyByPoLineId: cancelledByLineId,
      },
    });
  } catch (e) {
    return next(e);
  }
});

/** One-time / maintenance: realign stored status with net received (active GRNs only). Admin only. */
purchaseRouter.post(
  "/rm-pos/recompute-statuses",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const pos = await prisma.rmPurchaseOrder.findMany({
        where: { status: { not: "CANCELLED" } },
        select: { id: true },
      });
      await prisma.$transaction(async (tx) => {
        for (const { id } of pos) {
          await recalcRmPoStatus(tx, id);
        }
      });
      return res.json({ ok: true, recomputed: pos.length });
    } catch (e) {
      return next(e);
    }
  },
);

/** Purchase module flags (e.g. testing-mode relaxed tax fallbacks). */
purchaseRouter.get("/meta", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    return res.json({
      testingModeRelaxedTaxFields: isTestingModeRelaxed(),
    });
  } catch (e) {
    return next(e);
  }
});

/** Idempotent backfill of unit/HSN/GST/amount on PO lines and supplier snapshots. Admin only. */
purchaseRouter.post(
  "/rm-pos/repair-tax-data",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const result = await repairRmPurchaseTaxData();
      return res.json({ ok: true, ...result });
    } catch (e) {
      return next(e);
    }
  },
);

purchaseRouter.post("/rm-pos", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const schema = z.object({
      supplierId: z.number().int(),
      remarks: z.string().max(4000).optional().nullable(),
      lines: z
        .array(
          z.object({
            itemId: z.number().int(),
            qty: z.number().positive(),
            rate: z.number().positive(),
          }),
        )
        .min(1),
    });
    const body = schema.parse(req.body);

    const userId = req.user?.userId;
    const relaxed = isTestingModeRelaxed();
    const { po, taxWarnings } = await prisma.$transaction(async (tx) => {
      await assertAllItemsAreRm(
        tx,
        body.lines.map((l) => l.itemId),
      );

      const supplier = await tx.supplier.findUnique({
        where: { id: body.supplierId },
        include: { stateRef: { select: { stateName: true, stateCode: true } } },
      });
      if (!supplier) {
        const err = new Error("Supplier not found");
        err.statusCode = 404;
        throw err;
      }

      const itemIds = [...new Set(body.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({
        where: { id: { in: itemIds } },
        include: { unitRef: { select: { unitName: true } } },
      });
      const itemById = new Map(items.map((i) => [i.id, i]));

      const warn = [];
      const snap = resolveSupplierSnapshots(supplier, { relaxed });
      warn.push(...snap.warnings);

      const lineCreates = [];
      for (const l of body.lines) {
        const it = itemById.get(l.itemId);
        if (!it) {
          const err = new Error(`Unknown item ${l.itemId}`);
          err.statusCode = 400;
          throw err;
        }
        assertPositiveRate(l.rate);
        const resolved = resolveLineTaxFromItem(it, { relaxed });
        warn.push(...resolved.warnings);
        const amount = computeLineAmount(l.qty, l.rate);
        lineCreates.push({
          itemId: l.itemId,
          qty: String(l.qty),
          rate: String(l.rate),
          unit: resolved.unit,
          hsn: resolved.hsn,
          gstRate: String(resolved.gstRate),
          amount: String(amount),
        });
      }

      const created = await tx.rmPurchaseOrder.create({
        data: {
          supplierId: body.supplierId,
          status: "PENDING",
          remarks: body.remarks?.trim() || null,
          supplierStateSnapshot: snap.supplierStateSnapshot,
          supplierStateCodeSnapshot: snap.supplierStateCodeSnapshot,
          lines: { create: lineCreates },
        },
        include: { supplier: true, lines: { include: { item: true } } },
      });
      if (typeof userId === "number" && Number.isFinite(userId)) {
        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `RM_PO:${created.id}`,
          actorUserId: userId,
          actorRole: req.user?.role,
          summary: `RM purchase order RMPO-${created.id} created (${created.lines.length} lines)`,
          payload: {
            module: "PURCHASE",
            actionLabel: "CREATE",
            ref: { type: "RM_PO", id: String(created.id), no: `RMPO-${created.id}` },
            snapshot: {
              supplierId: created.supplierId,
              supplierName: created.supplier?.name ?? null,
              lineCount: created.lines.length,
            },
            status: { from: null, to: created.status },
          },
        });
      }
      return { po: created, taxWarnings: uniqueWarnings(warn) };
    });
    return res.status(201).json({ ...po, taxWarnings });
  } catch (e) {
    return next(e);
  }
});

/**
 * PENDING, no GRNs: replace all lines.
 * PENDING with GRN rows (e.g. all reversed): update/delete/add lines without dropping lines referenced by GRNs.
 * PARTIAL: same line ids + itemIds; qty >= received; remarks/supplier optional.
 */
purchaseRouter.put("/rm-pos/:id", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      supplierId: z.number().int().optional(),
      remarks: z.string().max(4000).optional().nullable(),
      lines: z.array(lineInSchema).min(1),
    });
    const body = schema.parse(req.body);

    const userId = req.user?.userId;
    const result = await prisma.$transaction(async (tx) => {
      const rmPo = await tx.rmPurchaseOrder.findUnique({
        where: { id },
        include: { lines: true, grns: { include: { lines: true } } },
      });
      if (!rmPo) {
        const err = new Error("RM PO not found");
        err.statusCode = 404;
        throw err;
      }
      if (rmPo.status === "COMPLETED" || rmPo.status === "CANCELLED") {
        const err = new Error("Cannot edit a completed or cancelled RM PO");
        err.statusCode = 400;
        throw err;
      }

      const hasAnyGrn = rmPo.grns.length > 0;
      const receivedByLine = sumReceivedByRmPoLineFromGrns(rmPo.grns);
      const useInPlaceLineEdit = rmPo.status === "PARTIAL" || hasAnyGrn;

      if (useInPlaceLineEdit) {
        const lineIdsWithGrn = new Set();
        for (const g of rmPo.grns) {
          for (const gl of g.lines) lineIdsWithGrn.add(gl.rmPoLineId);
        }

        if (rmPo.status === "PARTIAL") {
          if (body.lines.length !== rmPo.lines.length) {
            const err = new Error("Partial PO: line count must match; adjust quantities on existing lines only");
            err.statusCode = 400;
            throw err;
          }
          const byId = new Map(body.lines.map((l) => [l.id, l]));
          for (const el of rmPo.lines) {
            const bl = byId.get(el.id);
            if (!bl || bl.id !== el.id) {
              const err = new Error("Partial PO: each existing line must be sent with its id");
              err.statusCode = 400;
              throw err;
            }
            if (bl.itemId !== el.itemId) {
              const err = new Error("Cannot change item on a line that has receipts");
              err.statusCode = 400;
              throw err;
            }
            const rec = receivedByLine.get(el.id) || 0;
            if (bl.qty + QUEUE_EPS < rec) {
              const err = new Error(`Line ${el.id}: quantity cannot be below received (${rec})`);
              err.statusCode = 400;
              throw err;
            }
          }
        } else {
          const receivedActive = sumReceivedByRmPoLineFromGrns(rmPo.grns);
          for (const l of body.lines) {
            if (l.id == null) continue;
            const own = rmPo.lines.find((x) => x.id === l.id);
            if (!own) {
              const err = new Error(`Unknown line id ${l.id}`);
              err.statusCode = 400;
              throw err;
            }
            if (lineIdsWithGrn.has(l.id) && l.itemId !== own.itemId) {
              const err = new Error("Cannot change item on a line that has GRN history");
              err.statusCode = 400;
              throw err;
            }
            const rec = receivedActive.get(l.id) || 0;
            if (l.qty + QUEUE_EPS < rec) {
              const err = new Error(`Line ${l.id}: quantity cannot be below received (${rec})`);
              err.statusCode = 400;
              throw err;
            }
          }
        }

        await assertAllItemsAreRm(
          tx,
          body.lines.map((l) => l.itemId),
        );

        const relaxed = isTestingModeRelaxed();
        const itemIds = [...new Set(body.lines.map((l) => l.itemId))];
        const items = await tx.item.findMany({
          where: { id: { in: itemIds } },
          include: { unitRef: { select: { unitName: true } } },
        });
        const itemById = new Map(items.map((i) => [i.id, i]));
        const taxWarnings = [];

        const incomingIds = new Set(body.lines.map((l) => l.id).filter((x) => x != null));

        for (const existing of rmPo.lines) {
          if (incomingIds.has(existing.id)) continue;
          if (lineIdsWithGrn.has(existing.id)) {
            const err = new Error("Cannot remove a PO line that has GRN history");
            err.statusCode = 400;
            throw err;
          }
          await tx.rmPurchaseOrderLine.delete({ where: { id: existing.id } });
        }

        for (const l of body.lines) {
          const it = itemById.get(l.itemId);
          if (!it) {
            const err = new Error(`Unknown item ${l.itemId}`);
            err.statusCode = 400;
            throw err;
          }
          const { row, warnings } = buildResolvedRmLine(it, l, relaxed);
          taxWarnings.push(...warnings);

          if (l.id != null) {
            const own = rmPo.lines.find((x) => x.id === l.id);
            if (!own) {
              const err = new Error(`Unknown line id ${l.id}`);
              err.statusCode = 400;
              throw err;
            }
            await tx.rmPurchaseOrderLine.update({
              where: { id: l.id },
              data: row,
            });
          } else {
            await tx.rmPurchaseOrderLine.create({
              data: { rmPoId: id, ...row },
            });
          }
        }

        const effectiveSupplierId = body.supplierId ?? rmPo.supplierId;
        const supplierRow = await tx.supplier.findUnique({
          where: { id: effectiveSupplierId },
          include: { stateRef: { select: { stateName: true, stateCode: true } } },
        });
        if (!supplierRow) {
          const err = new Error("Supplier not found");
          err.statusCode = 404;
          throw err;
        }
        const snap = resolveSupplierSnapshots(supplierRow, { relaxed });
        taxWarnings.push(...snap.warnings);

        const data = {
          supplierStateSnapshot: snap.supplierStateSnapshot,
          supplierStateCodeSnapshot: snap.supplierStateCodeSnapshot,
        };
        if (body.supplierId != null) data.supplierId = body.supplierId;
        if (body.remarks !== undefined) data.remarks = body.remarks?.trim() || null;
        await tx.rmPurchaseOrder.update({ where: { id }, data });

        await recalcRmPoStatus(tx, id);
        const out = await tx.rmPurchaseOrder.findUnique({
          where: { id },
          include: { supplier: true, lines: { include: { item: true }, orderBy: { id: "asc" } }, grns: { include: { lines: true } } },
        });
        if (out && typeof userId === "number" && Number.isFinite(userId)) {
          await auditLog.write(tx, {
            action: auditLog.AuditAction.UPDATE,
            entityType: auditLog.AuditEntityType.SETTINGS,
            entityId: `RM_PO:${out.id}`,
            actorUserId: userId,
            actorRole: req.user?.role,
            summary: `RM purchase order RMPO-${out.id} updated`,
            payload: {
              module: "PURCHASE",
              actionLabel: "UPDATE",
              ref: { type: "RM_PO", id: String(out.id), no: `RMPO-${out.id}` },
              changes: { status: { from: rmPo.status, to: out.status } },
            },
          });
        }
        return { out, taxWarnings: uniqueWarnings(taxWarnings) };
      }

      const relaxed = isTestingModeRelaxed();
      const itemIds = [...new Set(body.lines.map((l) => l.itemId))];
      const items = await tx.item.findMany({
        where: { id: { in: itemIds } },
        include: { unitRef: { select: { unitName: true } } },
      });
      const itemById = new Map(items.map((i) => [i.id, i]));
      const taxWarnings = [];

      await assertAllItemsAreRm(
        tx,
        body.lines.map((l) => l.itemId),
      );

      const lineCreates = [];
      for (const l of body.lines) {
        const it = itemById.get(l.itemId);
        if (!it) {
          const err = new Error(`Unknown item ${l.itemId}`);
          err.statusCode = 400;
          throw err;
        }
        const { row, warnings } = buildResolvedRmLine(it, l, relaxed);
        taxWarnings.push(...warnings);
        lineCreates.push(row);
      }

      const effectiveSupplierId = body.supplierId ?? rmPo.supplierId;
      const supplierRow = await tx.supplier.findUnique({
        where: { id: effectiveSupplierId },
        include: { stateRef: { select: { stateName: true, stateCode: true } } },
      });
      if (!supplierRow) {
        const err = new Error("Supplier not found");
        err.statusCode = 404;
        throw err;
      }
      const snap = resolveSupplierSnapshots(supplierRow, { relaxed });
      taxWarnings.push(...snap.warnings);

      await tx.rmPurchaseOrderLine.deleteMany({ where: { rmPoId: id } });
      await tx.rmPurchaseOrder.update({
        where: { id },
        data: {
          supplierId: body.supplierId ?? undefined,
          remarks: body.remarks !== undefined ? body.remarks?.trim() || null : undefined,
          supplierStateSnapshot: snap.supplierStateSnapshot,
          supplierStateCodeSnapshot: snap.supplierStateCodeSnapshot,
          lines: {
            create: lineCreates,
          },
        },
      });
      await recalcRmPoStatus(tx, id);
      const out = await tx.rmPurchaseOrder.findUnique({
        where: { id },
        include: { supplier: true, lines: { include: { item: true }, orderBy: { id: "asc" } }, grns: { include: { lines: true } } },
      });
      if (out && typeof userId === "number" && Number.isFinite(userId)) {
        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `RM_PO:${out.id}`,
          actorUserId: userId,
          actorRole: req.user?.role,
          summary: `RM purchase order RMPO-${out.id} updated`,
          payload: {
            module: "PURCHASE",
            actionLabel: "UPDATE",
            ref: { type: "RM_PO", id: String(out.id), no: `RMPO-${out.id}` },
            changes: { status: { from: rmPo.status, to: out.status } },
          },
        });
      }
      return { out, taxWarnings: uniqueWarnings(taxWarnings) };
    });
    return res.json({ ...result.out, taxWarnings: result.taxWarnings || [] });
  } catch (e) {
    return next(e);
  }
});

purchaseRouter.delete("/rm-pos/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rmPo = await prisma.rmPurchaseOrder.findUnique({ where: { id }, include: { grns: true } });
    if (!rmPo) {
      const err = new Error("Not found");
      err.statusCode = 404;
      throw err;
    }
    if (hasActiveGrn(rmPo.grns)) {
      const err = new Error(
        "Cannot delete this order while a goods receipt is active. Reverse the receipt first, or cancel the order if it is still open.",
      );
      err.statusCode = 400;
      throw err;
    }
    await prisma.rmPurchaseOrder.delete({ where: { id } });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

purchaseRouter.post("/rm-pos/:id/cancel", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      reason: z.string().max(2000).optional().nullable(),
    });
    const body = schema.parse(req.body ?? {});

    const updated = await prisma.$transaction(async (tx) => {
      const rmPo = await tx.rmPurchaseOrder.findUnique({
        where: { id },
        include: { lines: true, grns: { include: { lines: true } } },
      });
      if (!rmPo) {
        const err = new Error("RM PO not found");
        err.statusCode = 404;
        throw err;
      }
      if (rmPo.status === "CANCELLED") {
        const err = new Error("PO is already cancelled");
        err.statusCode = 400;
        throw err;
      }
      if (rmPo.status === "COMPLETED") {
        const err = new Error("Cannot cancel a completed PO");
        err.statusCode = 400;
        throw err;
      }

      const receivedByLine = sumReceivedByRmPoLineFromGrns(rmPo.grns);
      const reasonTrim = body.reason?.trim();

      if (rmPo.status === "PARTIAL") {
        for (const line of rmPo.lines) {
          const rec = receivedByLine.get(line.id) || 0;
          await tx.rmPurchaseOrderLine.update({
            where: { id: line.id },
            data: { qty: String(rec) },
          });
        }
      }

      let newRemarks = rmPo.remarks;
      if (reasonTrim) {
        newRemarks = [rmPo.remarks?.trim(), `Cancelled: ${reasonTrim}`].filter(Boolean).join("\n") || `Cancelled: ${reasonTrim}`;
      }

      await tx.rmPurchaseOrder.update({
        where: { id },
        data: {
          status: "CANCELLED",
          remarks: newRemarks?.trim() || null,
        },
      });

      return tx.rmPurchaseOrder.findUnique({
        where: { id },
        include: { supplier: true, lines: { include: { item: true }, orderBy: { id: "asc" } }, grns: { include: { lines: true } } },
      });
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

purchaseRouter.post("/grns", requireAuth, requireRole(["ADMIN", "STORE"]), async (req, res, next) => {
  try {
    const schema = z.object({
      rmPoId: z.number().int(),
      lines: z
        .array(
          z.object({
            rmPoLineId: z.number().int(),
            receivedQty: z.number().positive(),
          }),
        )
        .min(1),
    });
    const body = schema.parse(req.body);

    const userId = req.user?.userId;
    const result = await prisma.$transaction(async (tx) => {
      const rmPo = await tx.rmPurchaseOrder.findUnique({
        where: { id: body.rmPoId },
        include: { lines: true, grns: { include: { lines: true } } },
      });
      if (!rmPo) {
        const err = new Error("RM PO not found");
        err.statusCode = 404;
        throw err;
      }
      if (rmPo.status === "CANCELLED" || rmPo.status === "COMPLETED") {
        const err = new Error("Cannot post GRN for a cancelled or completed PO");
        err.statusCode = 400;
        throw err;
      }

      const receivedByLine = sumReceivedByRmPoLineFromGrns(rmPo.grns);

      for (const ln of body.lines) {
        const poLine = rmPo.lines.find((l) => l.id === ln.rmPoLineId);
        if (!poLine) {
          const err = new Error(`Invalid rmPoLineId ${ln.rmPoLineId}`);
          err.statusCode = 400;
          throw err;
        }
        const rate = Number(poLine.rate);
        if (!Number.isFinite(rate) || rate <= 0) {
          const err = new Error("Cannot create GRN because one or more purchase lines are missing rate.");
          err.statusCode = 400;
          throw err;
        }
        const already = receivedByLine.get(poLine.id) || 0;
        const remaining = Number(poLine.qty) - already;
        if (ln.receivedQty > remaining + QUEUE_EPS) {
          const err = new Error(`Line ${poLine.id}: received exceeds remaining (${Math.max(0, remaining)})`);
          err.statusCode = 400;
          throw err;
        }
      }

      const grn = await tx.grn.create({
        data: {
          rmPoId: rmPo.id,
          lines: {
            create: body.lines.map((l) => ({
              rmPoLineId: l.rmPoLineId,
              receivedQty: String(l.receivedQty),
              rateSnapshot: String(rmPo.lines.find((x) => x.id === l.rmPoLineId)?.rate ?? 0),
            })),
          },
        },
        include: { lines: true },
      });

      for (const gl of grn.lines) {
        const poLine = rmPo.lines.find((l) => l.id === gl.rmPoLineId);
        await tx.stockTransaction.create({
          data: {
            itemId: poLine.itemId,
            transactionType: "GRN",
            refId: gl.id,
            stockBucket: "USABLE",
            qtyIn: String(gl.receivedQty),
            qtyOut: "0",
          },
        });
      }

      await recalcRmPoStatus(tx, rmPo.id);
      if (typeof userId === "number" && Number.isFinite(userId)) {
        await auditLog.write(tx, {
          action: auditLog.AuditAction.CREATE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `GRN:${grn.id}`,
          actorUserId: userId,
          actorRole: req.user?.role,
          summary: `GRN GRN-${grn.id} created for RMPO-${rmPo.id}`,
          payload: {
            module: "PURCHASE",
            actionLabel: "CREATE",
            ref: { type: "GRN", id: String(grn.id), no: `GRN-${grn.id}` },
            snapshot: { rmPoId: rmPo.id, rmPoNo: `RMPO-${rmPo.id}`, lineCount: grn.lines.length },
          },
        });
      }
      return { grn };
    });

    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

purchaseRouter.post("/grns/:id/reverse", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const grnId = Number(req.params.id);
    const schema = z.object({
      reason: z.string().min(1).max(2000),
    });
    const body = schema.parse(req.body);

    const userId = req.user?.userId;
    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      const err = new Error("Unauthorized");
      err.statusCode = 401;
      throw err;
    }

    const out = await prisma.$transaction(async (tx) => {
      const grn = await tx.grn.findUnique({
        where: { id: grnId },
        include: { lines: true, rmPo: true, purchaseBills: { select: { id: true, status: true } } },
      });
      if (!grn) {
        const err = new Error("GRN not found");
        err.statusCode = 404;
        throw err;
      }
      const hasFinalizedPurchaseBill = (grn.purchaseBills || []).some((b) => b.status === "FINALIZED");
      if (hasFinalizedPurchaseBill) {
        const err = new Error("This GRN is linked to a finalized purchase bill and cannot be reversed.");
        err.statusCode = 400;
        throw err;
      }
      if (grn.reversedAt) {
        const err = new Error("GRN already reversed");
        err.statusCode = 400;
        throw err;
      }
      if (grn.rmPo.status === "CANCELLED") {
        const err = new Error("Cannot reverse GRN on a cancelled PO");
        err.statusCode = 400;
        throw err;
      }

      for (const gl of grn.lines) {
        const forward = await tx.stockTransaction.findFirst({
          where: {
            transactionType: "GRN",
            refId: gl.id,
            reversedAt: null,
            reversalOfId: null,
          },
        });
        if (!forward) {
          const err = new Error(`Stock transaction for GRN line ${gl.id} not found`);
          err.statusCode = 400;
          throw err;
        }
        const qIn = Number(forward.qtyIn);
        await assertSufficientStockForQtyOut(
          tx,
          forward.itemId,
          qIn,
          `Cannot reverse GRN: insufficient USABLE stock for item #${forward.itemId}.`,
          { stockBucket: "USABLE" },
        );

        await tx.stockTransaction.create({
          data: {
            itemId: forward.itemId,
            transactionType: "ADJUSTMENT",
            refId: 0,
            stockBucket: "USABLE",
            qtyIn: "0",
            qtyOut: String(qIn),
            reason: `GRN #${grn.id} reversal (line ${gl.id}): ${body.reason.trim()}`,
            reversalOfId: forward.id,
            createdByUserId: userId,
          },
        });

        await tx.stockTransaction.update({
          where: { id: forward.id },
          data: { reversedAt: new Date(), reversedByUserId: userId },
        });
      }

      await tx.grn.update({
        where: { id: grnId },
        data: {
          reversedAt: new Date(),
          reversalReason: body.reason.trim(),
        },
      });

      await recalcRmPoStatus(tx, grn.rmPoId);

      const outRow = await tx.grn.findUnique({
        where: { id: grnId },
        include: { lines: true, rmPo: { include: { lines: { include: { item: true } } } } },
      });
      if (outRow) {
        await auditLog.write(tx, {
          action: auditLog.AuditAction.REVERSE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `GRN:${outRow.id}`,
          actorUserId: userId,
          actorRole: req.user?.role,
          summary: `GRN GRN-${outRow.id} reversed`,
          reason: body.reason.trim(),
          payload: {
            module: "PURCHASE",
            actionLabel: "REVERSE",
            ref: { type: "GRN", id: String(outRow.id), no: `GRN-${outRow.id}` },
            snapshot: { rmPoId: grn.rmPoId, rmPoNo: `RMPO-${grn.rmPoId}` },
            status: { from: "ACTIVE", to: "REVERSED" },
          },
        });
      }
      return outRow;
    });

    return res.json(out);
  } catch (e) {
    return next(e);
  }
});

module.exports = { purchaseRouter };
