const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const auditLog = require("../services/auditLog");
const { buildQuotationPdf } = require("../services/quotationPdf");
const { resolveSalesIntraState } = require("../services/salesStateCompare");

const quotationRouter = express.Router();

const RATE_EPS = 1e-6;

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

const quoteLineSchema = z.object({
  itemId: z.number().int(),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
  discountPct: z.number().nonnegative().default(0),
  /** Optional: when omitted, server may use item.gstRate as default. */
  gstPct: z.number().nonnegative().optional(),
  /** Omitted in older clients — treated as false. */
  isFree: z.boolean().optional().default(false),
});

const MSG_RATE_POSITIVE = "Rate must be greater than zero for non-free items.";
const MSG_FREE_ZERO_RATE = "Free items must have zero rate.";

/**
 * @param {Array<{ isFree?: boolean; rate: number }>} lines
 */
function assertQuotationLinePricing(lines) {
  for (const l of lines) {
    const isFree = Boolean(l.isFree);
    const rate = Number(l.rate);
    if (isFree) {
      if (Math.abs(rate) > RATE_EPS) {
        const err = new Error(MSG_FREE_ZERO_RATE);
        err.statusCode = 400;
        throw err;
      }
    } else if (rate <= RATE_EPS) {
      const err = new Error(MSG_RATE_POSITIVE);
      err.statusCode = 400;
      throw err;
    }
  }
}

function computeLineParts(qty, rate, discountPct, gstPct) {
  const base = Number(qty) * Number(rate) * (1 - Number(discountPct) / 100);
  const gst = base * (Number(gstPct) / 100);
  const lineTotal = Math.round((base + gst) * 100) / 100;
  return { base, gst, lineTotal };
}

function computeLineTaxBreakup(qty, rate, discountPct, gstPct, intraState) {
  const { base, gst, lineTotal } = computeLineParts(qty, rate, discountPct, gstPct);
  const gst2 = round2(gst);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState) {
    cgst = round2(gst2 / 2);
    sgst = round2(gst2 - cgst);
  } else {
    igst = gst2;
  }
  return {
    baseAmount: round2(base),
    gstAmount: gst2,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    lineTotal: round2(lineTotal),
  };
}

function withQuotationTaxBreakup(q, { intraState, companyState }) {
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const nextLines = (q.lines || []).map((ln) => {
    const qty = Number(ln.qty);
    const rate = Number(ln.rate);
    const discountPct = Number(ln.discountPct);
    const gstPct = Number(ln.gstPct);
    const calc = computeLineTaxBreakup(qty, rate, discountPct, gstPct, intraState);
    totalCgst += calc.cgstAmount;
    totalSgst += calc.sgstAmount;
    totalIgst += calc.igstAmount;
    return {
      ...ln,
      baseAmount: String(calc.baseAmount.toFixed(2)),
      gstAmount: String(calc.gstAmount.toFixed(2)),
      cgstAmount: String(calc.cgstAmount.toFixed(2)),
      sgstAmount: String(calc.sgstAmount.toFixed(2)),
      igstAmount: String(calc.igstAmount.toFixed(2)),
    };
  });

  return {
    ...q,
    taxIntraState: intraState,
    companyGstin: companyState?.companyGstin ?? null,
    companyStateName: companyState?.companyStateRef?.stateName ?? null,
    companyStateCode: companyState?.companyStateRef?.stateCode ?? null,
    customerGstin: q?.enquiry?.customer?.gst ?? null,
    customerStateName: q?.enquiry?.customer?.stateRef?.stateName ?? null,
    customerStateCode: q?.enquiry?.customer?.stateRef?.stateCode ?? null,
    totalCgst: String(round2(totalCgst).toFixed(2)),
    totalSgst: String(round2(totalSgst).toFixed(2)),
    totalIgst: String(round2(totalIgst).toFixed(2)),
    lines: nextLines,
  };
}

const includeQuotation = {
  enquiry: { include: { customer: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } } } },
  lines: { include: { item: true } },
  salesOrder: true,
};

async function getCompanyState(prismaOrTx) {
  const row = await prismaOrTx.appSetting.findUnique({
    where: { id: 1 },
    select: {
      companyState: true,
      companyGstin: true,
      companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
    },
  });
  return row ?? { companyState: null, companyStateRef: null };
}

async function lineRowsFromPayload(tx, lines) {
  let subtotal = 0;
  let gstTotal = 0;
  const items = await tx.item.findMany({
    where: { id: { in: lines.map((l) => l.itemId) } },
    select: { id: true, gstRate: true },
  });
  const itemRate = new Map(items.map((it) => [it.id, it.gstRate != null ? Number(it.gstRate) : null]));
  const rows = lines.map((l) => {
    const isFree = Boolean(l.isFree);
    const rate = isFree ? 0 : Number(l.rate);
    const gstPct =
      l.gstPct !== undefined
        ? Number(l.gstPct)
        : itemRate.get(l.itemId) != null
          ? Number(itemRate.get(l.itemId))
          : 0;
    const { base, gst, lineTotal } = computeLineParts(l.qty, rate, l.discountPct, gstPct);
    if (!Number.isFinite(base) || !Number.isFinite(gst) || !Number.isFinite(lineTotal)) {
      const err = new Error(
        "Invalid amounts computed for a quotation line. Check quantity, rate, discount %, and GST % are valid numbers.",
      );
      err.statusCode = 400;
      throw err;
    }
    subtotal += base;
    gstTotal += gst;
    return {
      itemId: l.itemId,
      qty: String(l.qty),
      rate: String(rate),
      discountPct: String(l.discountPct),
      gstPct: String(gstPct),
      lineTotal: String(lineTotal.toFixed(2)),
      isFree,
    };
  });
  if (!Number.isFinite(subtotal) || !Number.isFinite(gstTotal)) {
    const err = new Error("Invalid quotation totals. Check all line amounts.");
    err.statusCode = 400;
    throw err;
  }
  const totalAmount = Math.round((subtotal + gstTotal) * 100) / 100;
  return {
    rows,
    subtotal: subtotal.toFixed(2),
    gstTotal: gstTotal.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}

quotationRouter.get("/", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  try {
    const companyState = await getCompanyState(prisma);
    const rows = await prisma.quotation.findMany({
      orderBy: { id: "desc" },
      include: includeQuotation,
    });

    // Repair/sync: if a quotation is approved, the linked enquiry must be QUOTED.
    // This handles legacy rows that were approved before the sync rule existed.
    const toFix = rows.filter((q) => q.workflowStatus === "APPROVED" && q.enquiryId != null && q.enquiry?.status !== "QUOTED");
    if (toFix.length) {
      await prisma.$transaction(
        toFix.map((q) =>
          prisma.enquiry.update({
            where: { id: q.enquiryId },
            data: { status: "QUOTED" },
          }),
        ),
      );
      for (const q of toFix) {
        console.log("Enquiry updated to QUOTED:", q.enquiryId);
      }
    }
    return res.json(
      rows.map((q) => {
        const customer = q.enquiry?.customer ?? null;
        const cmp = resolveSalesIntraState({ company: companyState, customer });
        return withQuotationTaxBreakup(q, { intraState: cmp.intraState, companyState });
      }),
    );
  } catch (e) {
    return next(e);
  }
});

quotationRouter.get("/:id/pdf", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({
      where: { id },
      include: includeQuotation,
    });
    if (!q) {
      const err = new Error("Quotation not found");
      err.statusCode = 404;
      throw err;
    }
    if (q.workflowStatus !== "APPROVED") {
      const err = new Error("Only approved quotations can be downloaded.");
      err.statusCode = 403;
      throw err;
    }
    const buf = await buildQuotationPdf(q);
    const name = `Quotation-${q.quotationNo || q.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    return res.send(buf);
  } catch (e) {
    return next(e);
  }
});

quotationRouter.get("/:id", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const companyState = await getCompanyState(prisma);
    const row = await prisma.quotation.findUnique({
      where: { id },
      include: includeQuotation,
    });
    if (!row) {
      const err = new Error("Quotation not found");
      err.statusCode = 404;
      throw err;
    }
    const customer = row.enquiry?.customer ?? null;
    const cmp = resolveSalesIntraState({ company: companyState, customer });
    return res.json(withQuotationTaxBreakup(row, { intraState: cmp.intraState, companyState }));
  } catch (e) {
    return next(e);
  }
});

quotationRouter.post("/", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const schema = z.object({
      enquiryId: z.number().int(),
      lines: z.array(quoteLineSchema).min(1),
      terms: z.string().optional(),
    });
    const body = schema.parse(req.body);
    assertQuotationLinePricing(body.lines);

    const result = await prisma.$transaction(async (tx) => {
      const enquiry = await tx.enquiry.findUnique({
        where: { id: body.enquiryId },
        include: { lines: true, quotation: true },
      });
      if (!enquiry) {
        const err = new Error("Enquiry not found");
        err.statusCode = 404;
        throw err;
      }
      if (enquiry.status !== "FEASIBLE") {
        const err = new Error("Quotation can only be created from a feasible enquiry");
        err.statusCode = 400;
        throw err;
      }
      if (enquiry.quotation) {
        const err = new Error("Quotation already exists for this enquiry");
        err.statusCode = 400;
        throw err;
      }

      const { rows, subtotal, gstTotal, totalAmount } = await lineRowsFromPayload(tx, body.lines);

      /** Use createMany for lines (same as PUT) — avoids nested batch edge cases on MySQL. */
      const created = await tx.quotation.create({
        data: {
          enquiryId: enquiry.id,
          quotationNo: `tmp-${Date.now()}`,
          workflowStatus: "DRAFT",
          status: "PENDING",
          subtotal,
          gstTotal,
          totalAmount,
          terms: body.terms ?? null,
        },
      });

      await tx.quotationLine.createMany({
        data: rows.map((r) => ({ ...r, quotationId: created.id })),
      });

      const quotationNo = `QT-${String(created.id).padStart(6, "0")}`;
      const updated = await tx.quotation.update({
        where: { id: created.id },
        data: { quotationNo },
        include: includeQuotation,
      });

      await tx.enquiry.update({
        where: { id: enquiry.id },
        data: { status: "QUOTED" },
      });

      const companyState = await getCompanyState(tx);
      const customer = updated.enquiry?.customer ?? null;
      const cmp = resolveSalesIntraState({ company: companyState, customer });
      return withQuotationTaxBreakup(updated, { intraState: cmp.intraState, companyState });
    });

    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

quotationRouter.put("/:id/status", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      status: z.enum(["APPROVED", "REJECTED"]),
    });
    const { status } = schema.parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findUnique({ where: { id } });
      if (!existing) {
        const err = new Error("Quotation not found");
        err.statusCode = 404;
        throw err;
      }
      // Lock rule: once approved/rejected, do not allow casual reversal via dropdown/status endpoint.
      // However, approving the same quotation again should be idempotent and must still sync the enquiry status.
      if (existing.workflowStatus === "APPROVED") {
        if (status !== "APPROVED") {
          const err = new Error(
            "Approved quotation is locked. Only Admin can cancel approval with a reason, and only if no sales order exists.",
          );
          err.statusCode = 409;
          throw err;
        }
        const quotation = await tx.quotation.findUnique({
          where: { id },
          select: { enquiryId: true },
        });
        if (quotation?.enquiryId) {
          await tx.enquiry.update({
            where: { id: quotation.enquiryId },
            data: { status: "QUOTED" },
          });
          console.log("Enquiry updated to QUOTED:", quotation.enquiryId);
        }
        return tx.quotation.findUnique({ where: { id }, include: includeQuotation });
      }
      if (existing.workflowStatus === "REJECTED") {
        const err = new Error("Rejected quotation is locked.");
        err.statusCode = 409;
        throw err;
      }
      const row = await tx.quotation.update({
        where: { id },
        data: { workflowStatus: status },
        include: includeQuotation,
      });
      // Business flow: approving quotation closes the enquiry so it no longer appears as open/feasible.
      if (row.enquiryId != null) {
        if (status === "APPROVED") {
          const quotation = await tx.quotation.findUnique({
            where: { id },
            select: { enquiryId: true },
          });
          if (quotation?.enquiryId) {
            await tx.enquiry.update({
              where: { id: quotation.enquiryId },
              data: { status: "QUOTED" },
            });
            console.log("Enquiry updated to QUOTED:", quotation.enquiryId);
          }
        } else if (status === "REJECTED") {
          // Rejected quotation reopens enquiry to feasible state for re-quote.
          await tx.enquiry.update({ where: { id: row.enquiryId }, data: { status: "FEASIBLE" } });
        }
      }
      return row;
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

/**
 * Admin-only controlled exception: cancel approval on an approved quotation (requires reason).
 * Blocked if a Sales Order already exists for this quotation.
 */
quotationRouter.post(
  "/:id/cancel-approval",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const { reason } = z.object({ reason: z.string().min(1, "Reason is required.") }).parse(req.body);
      const reasonTrim = reason.trim();

      const updated = await prisma.$transaction(async (tx) => {
        const q = await tx.quotation.findUnique({ where: { id } });
        if (!q) {
          const err = new Error("Quotation not found");
          err.statusCode = 404;
          throw err;
        }
        if (q.workflowStatus !== "APPROVED") {
          const err = new Error("Only approved quotations can be cancelled.");
          err.statusCode = 409;
          throw err;
        }

        // Re-check linked Sales Order existence by foreign key (do not trust stale UI or cached relations).
        const so = await tx.salesOrder.findFirst({
          where: { quotationId: id },
          select: { id: true },
        });

        if (so) {
          const soId = so.id;
          const [rsCount, woCount, prodCount, qcCount, dispatchCount, billCount] = await Promise.all([
            tx.requirementSheet.count({ where: { salesOrderId: soId } }),
            tx.workOrder.count({ where: { salesOrderId: soId } }),
            tx.productionEntry.count({ where: { workOrderLine: { workOrder: { salesOrderId: soId } } } }),
            tx.qcEntry.count({ where: { production: { workOrderLine: { workOrder: { salesOrderId: soId } } } } }),
            tx.dispatch.count({ where: { soId } }),
            tx.salesBill.count({ where: { dispatch: { soId }, status: { in: ["DRAFT", "FINALIZED"] } } }),
          ]);

          if (rsCount > 0 || woCount > 0 || prodCount > 0 || qcCount > 0 || dispatchCount > 0 || billCount > 0) {
            const err = new Error(
              "Quotation cannot be changed because Sales Order has downstream transactions.",
            );
            err.statusCode = 409;
            err.details = {
              code: "QUOTATION_CANCEL_APPROVAL_BLOCKED",
              salesOrderId: soId,
              reasons: [
                rsCount > 0 ? "REQUIREMENT_SHEET_EXISTS" : null,
                woCount > 0 ? "WORK_ORDER_EXISTS" : null,
                prodCount > 0 ? "PRODUCTION_ENTRY_EXISTS" : null,
                qcCount > 0 ? "QC_ENTRY_EXISTS" : null,
                dispatchCount > 0 ? "DISPATCH_EXISTS" : null,
                billCount > 0 ? "SALES_BILL_EXISTS" : null,
              ].filter(Boolean),
            };
            throw err;
          }

          // Safe rollback path: Sales Order exists but has no downstream records.
          // Delete the SO so the quotation returns to "pending SO creation" state after approval cancel.
          await tx.salesOrderLine.deleteMany({ where: { soId } });
          await tx.salesOrderCycle.deleteMany({ where: { salesOrderId: soId } });
          const draftSheets = await tx.requirementSheet.findMany({
            where: { salesOrderId: soId, status: "DRAFT" },
            select: { id: true },
          });
          const draftIds = draftSheets.map((s) => s.id);
          if (draftIds.length) {
            await tx.requirementSheetLine.deleteMany({ where: { sheetId: { in: draftIds } } });
            await tx.requirementSheet.deleteMany({ where: { id: { in: draftIds } } });
          }
          await tx.salesOrder.delete({ where: { id: soId } });
        }

        const row = await tx.quotation.update({
          where: { id },
          data: {
            workflowStatus: "DRAFT",
            approvalCancelReason: reasonTrim,
            approvalCancelledAt: new Date(),
            approvalCancelledByUserId: req.user.userId,
          },
          include: includeQuotation,
        });

        // Re-open enquiry to feasible so it re-enters the funnel.
        if (row.enquiryId != null) {
          await tx.enquiry.update({ where: { id: row.enquiryId }, data: { status: "FEASIBLE" } });
        }

        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          // AuditEntityType enum does not include QUOTATION yet. Use SETTINGS namespace key.
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `QUOTATION:${String(id)}`,
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `Quotation #${id} approval cancelled`,
          payload: {
            reason: reasonTrim,
            changes: { workflowStatus: { from: "APPROVED", to: "DRAFT" } },
          },
          reason: reasonTrim,
        });

        return row;
      });

      return res.json(updated);
    } catch (e) {
      return next(e);
    }
  },
);

quotationRouter.put("/:id", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      lines: z.array(quoteLineSchema).min(1),
      terms: z.string().optional().nullable(),
      workflowStatus: z.enum(["DRAFT", "SENT", "APPROVED", "REJECTED"]).optional(),
    });
    const body = schema.parse(req.body);
    assertQuotationLinePricing(body.lines);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findUnique({ where: { id } });
      if (!existing) {
        const err = new Error("Quotation not found");
        err.statusCode = 404;
        throw err;
      }
      const linkedSo = await tx.salesOrder.findFirst({ where: { quotationId: id }, select: { id: true } });
      if (linkedSo) {
        const err = new Error("Cannot edit quotation because Sales Order exists.");
        err.statusCode = 409;
        throw err;
      }
      if (existing.workflowStatus === "APPROVED") {
        const err = new Error("Approved quotation cannot be edited.");
        err.statusCode = 409;
        throw err;
      }
      if (existing.workflowStatus === "REJECTED") {
        const err = new Error("Rejected quotation cannot be edited.");
        err.statusCode = 409;
        throw err;
      }
      if (body.workflowStatus === "APPROVED" || body.workflowStatus === "REJECTED") {
        const err = new Error("Use the approval decision control to approve or reject a quotation.");
        err.statusCode = 400;
        throw err;
      }

      const { rows, subtotal, gstTotal, totalAmount } = await lineRowsFromPayload(tx, body.lines);

      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      await tx.quotationLine.createMany({
        data: rows.map((r) => ({ ...r, quotationId: id })),
      });

      const saved = await tx.quotation.update({
        where: { id },
        data: {
          subtotal,
          gstTotal,
          totalAmount,
          terms: body.terms === undefined ? undefined : body.terms,
          workflowStatus: body.workflowStatus ?? undefined,
        },
        include: includeQuotation,
      });

      const companyState = await getCompanyState(tx);
      const customer = saved.enquiry?.customer ?? null;
      const cmp = resolveSalesIntraState({ company: companyState, customer });
      return withQuotationTaxBreakup(saved, { intraState: cmp.intraState, companyState });
    });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

quotationRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUnique({ where: { id } });
      if (!q) {
        const err = new Error("Quotation not found");
        err.statusCode = 404;
        throw err;
      }
      if (q.workflowStatus === "APPROVED") {
        const err = new Error("Approved quotation cannot be deleted.");
        err.statusCode = 409;
        throw err;
      }
      const linkedSo = await tx.salesOrder.findFirst({ where: { quotationId: id }, select: { id: true } });
      if (linkedSo) {
        const err = new Error("Cannot delete quotation linked to a sales order");
        err.statusCode = 400;
        throw err;
      }
      const enquiryId = q.enquiryId;
      await tx.quotation.delete({ where: { id } });
      await tx.enquiry.update({
        where: { id: enquiryId },
        data: { status: "FEASIBLE" },
      });
    });
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

module.exports = { quotationRouter };
